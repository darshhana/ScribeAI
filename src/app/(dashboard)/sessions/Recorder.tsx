"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import { v4 as uuidv4 } from "uuid";

import { getSocket } from "@/lib/socket-client";
import {
  RecorderSourceType,
  recorderMachine,
} from "@/lib/state/recorderMachine";

interface RecorderProps {
  userId: string;
}

interface PartialTranscriptChunk {
  index: number;
  text: string;
}

export default function Recorder({ userId }: RecorderProps) {
  const [currentSource, setCurrentSource] =
    useState<RecorderSourceType>("MIC");
  const [transcriptChunks, setTranscriptChunks] = useState<
    PartialTranscriptChunk[]
  >([]);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const chunkIndexRef = useRef(0);
  const timerIntervalRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  const [state, send] = useMachine(recorderMachine);

  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    function handleStatus(payload: {
      sessionId: string;
      status: string;
    }) {
      // Debug: see status flow per session in the browser console.
      // eslint-disable-next-line no-console
      console.log("[client] session:status", payload);
      if (payload.status === "PROCESSING") {
        send({ type: "PROCESSING" });
      }
      if (payload.status === "COMPLETED") {
        send({ type: "COMPLETED" });
      }
      if (payload.status === "ERROR") {
        send({
          type: "ERROR",
          message: "Session failed while processing on the server.",
        });
      }
    }

    function handlePartialTranscript(payload: {
      index: number;
      text: string;
    }) {
      setTranscriptChunks((prev) => {
        const next = [...prev];
        next[payload.index] = {
          index: payload.index,
          text: payload.text,
        };
        return next;
      });
    }

    function handleCompleted(payload: {
      sessionId: string;
      session: {
        summary?: {
          content: string;
        } | null;
      };
    }) {
      const content = payload.session.summary?.content ?? null;
      setSummaryText(content);
    }

    function handleError(payload: { message?: string }) {
      send({
        type: "ERROR",
        message: payload.message ?? "An unknown error occurred.",
      });
    }

    function handleDisconnect() {
      send({ type: "SOCKET_DISCONNECTED" });
    }

    function handleConnect() {
      send({ type: "SOCKET_RECONNECTED" });
    }

    socket.on("session:status", handleStatus);
    socket.on("session:partialTranscript", handlePartialTranscript);
    socket.on("session:completed", handleCompleted);
    socket.on("session:error", handleError);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleConnect);

    return () => {
      socket.off("session:status", handleStatus);
      socket.off("session:partialTranscript", handlePartialTranscript);
      socket.off("session:completed", handleCompleted);
      socket.off("session:error", handleError);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleConnect);
    };
  }, [send, socket]);

  useEffect(() => {
    if (state.matches("recording")) {
      if (timerIntervalRef.current != null) {
        window.clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = window.setInterval(() => {
        if (sessionStartTimeRef.current != null) {
          setElapsedMs(Date.now() - sessionStartTimeRef.current);
        }
      }, 500);
    } else if (state.matches("completed") || state.matches("error")) {
      if (timerIntervalRef.current != null) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  }, [state]);

  async function acquireStream(source: RecorderSourceType) {
    if (source === "MIC") {
      return navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }

    // For tab/system audio, most browsers require video to be captured as well.
    // We request both and simply ignore the video track on the backend.
    return navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  }

  async function startRecording() {
    if (!userId) return;

    const sessionId = uuidv4();
    activeSessionIdRef.current = sessionId;

    try {
      const stream = await acquireStream(currentSource);

      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      sessionStartTimeRef.current = Date.now();
      chunkIndexRef.current = 0;
      setTranscriptChunks([]);
      setSummaryText(null);
      setElapsedMs(0);

      // Debug: mark start of recording in console.
      // eslint-disable-next-line no-console
      console.log("[client] startRecording", {
        sessionId,
        source: currentSource,
      });

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0) return;
        if (!sessionStartTimeRef.current) return;

        const arrayBuffer = await event.data.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        const audioBase64 = Buffer.from(bytes).toString("base64");

        const index = chunkIndexRef.current++;
        const now = Date.now();
        const startMs = now - sessionStartTimeRef.current;
        const endMs = startMs + event.timecode;

        // Debug: see each chunk sent.
        // eslint-disable-next-line no-console
        console.log("[client] send chunk", {
          sessionId,
          index,
          byteLength: bytes.byteLength,
        });

        socket.emit("session:audioChunk", {
          sessionId,
          index,
          audioBase64,
          mimeType: event.data.type || "audio/webm;codecs=opus",
          startMs,
          endMs,
        });
      };

      recorder.onerror = (event) => {
        send({
          type: "ERROR",
          message:
            (event.error && event.error.message) ||
            "MediaRecorder error occurred.",
        });
      };

      mediaRecorderRef.current = recorder;
      recorder.start(10_000);

      socket.emit("session:start", {
        sessionId,
        userId,
        title: undefined,
        sourceType: currentSource,
      });

      send({
        type: "START",
        sessionId,
        sourceType: currentSource,
      });
    } catch (error) {
      send({
        type: "ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to start recording.",
      });
    }
  }

  function pauseRecording() {
    const sessionId = activeSessionIdRef.current;

    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== "recording") return;
    mediaRecorderRef.current.pause();
    send({ type: "PAUSE" });
    if (!sessionId) return;
    socket.emit("session:pause", {
      sessionId,
    });
  }

  function resumeRecording() {
    const sessionId = activeSessionIdRef.current;

    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== "paused") return;
    mediaRecorderRef.current.resume();
    send({ type: "RESUME" });
    if (!sessionId) return;
    socket.emit("session:resume", {
      sessionId,
    });
  }

  function stopRecording() {
    const sessionId = activeSessionIdRef.current;

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    send({ type: "STOP" });

    if (sessionId) {
      // eslint-disable-next-line no-console
      console.log("[client] stopRecording", { sessionId });
      socket.emit("session:stop", {
        sessionId,
      });
    }
  }

  // Drive UI from both the state machine *and* the actual MediaRecorder state,
  // so that the Stop button is available even if the machine and recorder get
  // briefly out of sync.
  const isRecording =
    state.matches("recording") || mediaRecorderRef.current !== null;
  const isPaused = state.matches("paused");
  const isProcessing = state.matches("processing");

  const formattedElapsed = useMemo(() => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (value: number) => value.toString().padStart(2, "0");
    return `${pad(minutes)}:${pad(seconds)}`;
  }, [elapsedMs]);

  const transcriptText = useMemo(
    () => transcriptChunks.map((chunk) => chunk?.text ?? "").join(" "),
    [transcriptChunks],
  );

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-400">
              Recorder
            </h2>
            <p className="text-xs text-zinc-500">
              Choose an input, then start recording. Audio is chunked and
              streamed to Gemini in real time.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span
              className={`h-2 w-2 rounded-full ${
                isRecording
                  ? "bg-red-500 shadow-[0_0_0_4px_rgba(248,113,113,0.45)]"
                  : "bg-zinc-600"
              }`}
            />
            <span>{state.context.statusMessage}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-900/70 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
              SOURCE
            </span>
            <button
              type="button"
              onClick={() => setCurrentSource("MIC")}
              disabled={isRecording}
              className={`rounded-full px-3 py-1 text-xs ${
                currentSource === "MIC"
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              } disabled:opacity-60`}
            >
              Microphone
            </button>
            <button
              type="button"
              onClick={() => setCurrentSource("TAB")}
              disabled={isRecording}
              className={`rounded-full px-3 py-1 text-xs ${
                currentSource === "TAB"
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              } disabled:opacity-60`}
            >
              Tab audio
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            <span className="rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[11px]">
              {formattedElapsed}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isRecording && !isProcessing && (
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center justify-center rounded-full bg-red-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-red-400"
            >
              Start session
            </button>
          )}

          {isRecording && (
            <>
              <button
                type="button"
                onClick={pauseRecording}
                className="inline-flex items-center justify-center rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center justify-center rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
              >
                Stop &amp; summarize
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                type="button"
                onClick={resumeRecording}
                className="inline-flex items-center justify-center rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center justify-center rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
              >
                Stop &amp; summarize
              </button>
            </>
          )}
        </div>

        {state.context.errorMessage && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {state.context.errorMessage}
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-400">
              Live transcript
            </h2>
            <p className="text-xs text-zinc-500">
              Partial transcripts arrive chunk-by-chunk from the Socket.io
              server as Gemini processes audio.
            </p>
          </div>
        </div>

        <div className="h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-sm leading-relaxed text-zinc-200">
          {transcriptText || (
            <span className="text-zinc-500">
              Start a session to see live transcription here.
            </span>
          )}
        </div>

        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
            AI summary
          </h3>
          <div className="min-h-[3rem] rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-sm text-zinc-200">
            {isProcessing && (
              <span className="text-zinc-500">
                Generating summary from full transcript…
              </span>
            )}
            {!isProcessing && summaryText && (
              <p className="whitespace-pre-wrap">{summaryText}</p>
            )}
            {!isProcessing && !summaryText && (
              <span className="text-zinc-500">
                Stop a recording to see an AI-generated summary here.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}


