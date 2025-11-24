import { createServer } from "http";
import { Server } from "socket.io";
import { z } from "zod";

import {
  appendTranscriptChunk,
  completeSessionWithSummary,
  createSession,
  updateSessionStatus,
} from "../src/lib/db/sessions";
import { prisma } from "../src/lib/prisma";
import {
  summarizeTranscript,
  transcribeChunk,
} from "../src/lib/gemini";

const SOCKET_PORT = Number(process.env.SCRIBEAI_SOCKET_PORT ?? 4001);

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: process.env.SCRIBEAI_SOCKET_ORIGIN ?? "*",
    methods: ["GET", "POST"],
  },
});

const SessionStartSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string(),
  title: z.string().optional(),
  sourceType: z.enum(["MIC", "TAB"]),
});

const AudioChunkSchema = z.object({
  sessionId: z.string().uuid(),
  /**
   * Sequential index of the chunk in the session.
   */
  index: z.number().int().nonnegative(),
  /**
   * Base64-encoded audio data (binary WebM/Opus, etc.).
   */
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

const SessionControlSchema = z.object({
  sessionId: z.string().uuid(),
});

io.on("connection", (socket) => {
  // eslint-disable-next-line no-console
  console.log("[socket] client connected:", socket.id);

  socket.on("disconnect", (reason) => {
    // eslint-disable-next-line no-console
    console.log("[socket] client disconnected:", socket.id, reason);
  });

  socket.on("session:start", async (payload) => {
    const parseResult = SessionStartSchema.safeParse(payload);
    if (!parseResult.success) {
      socket.emit("session:error", {
        message: "Invalid session:start payload",
      });
      return;
    }

    const { sessionId, userId, title, sourceType } = parseResult.data;
    // eslint-disable-next-line no-console
    console.log("[socket] session:start", { sessionId, userId, sourceType });

    try {
      await createSession({
        id: sessionId,
        userId,
        title,
        sourceType,
      });

      socket.join(sessionId);
      io.to(sessionId).emit("session:status", {
        sessionId,
        status: "RECORDING",
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[socket] failed to create session", error);
      socket.emit("session:error", {
        message: "Failed to create session",
      });
    }
  });

  socket.on("session:audioChunk", async (payload) => {
    const parseResult = AudioChunkSchema.safeParse(payload);
    if (!parseResult.success) {
      socket.emit("session:error", {
        message: "Invalid session:audioChunk payload",
      });
      return;
    }

    const { sessionId, index, audioBase64, mimeType, startMs, endMs } =
      parseResult.data;

    try {
      const audioBytes = Uint8Array.from(
        Buffer.from(audioBase64, "base64"),
      );
      // eslint-disable-next-line no-console
      console.log("[socket] audioChunk", {
        sessionId,
        index,
        byteLength: audioBytes.byteLength,
      });

      const { text } = await transcribeChunk({
        sessionId,
        audioBytes,
        mimeType,
        index,
      });

      if (!text) {
        return;
      }

      await appendTranscriptChunk({
        sessionId,
        index,
        text,
        startMs,
        endMs,
      });

      io.to(sessionId).emit("session:partialTranscript", {
        sessionId,
        index,
        text,
        startMs,
        endMs,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[socket] failed to process audio chunk", error);
      socket.emit("session:error", {
        message: "Failed to process audio chunk",
      });
    }
  });

  socket.on("session:pause", async (payload) => {
    const parseResult = SessionControlSchema.safeParse(payload);
    if (!parseResult.success) {
      socket.emit("session:error", {
        message: "Invalid session:pause payload",
      });
      return;
    }

    const { sessionId } = parseResult.data;

    try {
      await updateSessionStatus({
        sessionId,
        status: "PAUSED",
      });

      io.to(sessionId).emit("session:status", {
        sessionId,
        status: "PAUSED",
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[socket] failed to pause session", error);
      socket.emit("session:error", {
        message: "Failed to pause session",
      });
    }
  });

  socket.on("session:resume", async (payload) => {
    const parseResult = SessionControlSchema.safeParse(payload);
    if (!parseResult.success) {
      socket.emit("session:error", {
        message: "Invalid session:resume payload",
      });
      return;
    }

    const { sessionId } = parseResult.data;

    try {
      await updateSessionStatus({
        sessionId,
        status: "RECORDING",
      });

      io.to(sessionId).emit("session:status", {
        sessionId,
        status: "RECORDING",
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[socket] failed to resume session", error);
      socket.emit("session:error", {
        message: "Failed to resume session",
      });
    }
  });

  socket.on("session:stop", async (payload) => {
    const parseResult = SessionControlSchema.safeParse(payload);
    if (!parseResult.success) {
      socket.emit("session:error", {
        message: "Invalid session:stop payload",
      });
      return;
    }

    const { sessionId } = parseResult.data;
    // eslint-disable-next-line no-console
    console.log("[socket] session:stop received", { sessionId });

    try {
      await updateSessionStatus({
        sessionId,
        status: "PROCESSING",
      });
      // eslint-disable-next-line no-console
      console.log("[socket] status -> PROCESSING", { sessionId });

      io.to(sessionId).emit("session:status", {
        sessionId,
        status: "PROCESSING",
      });

      const chunks = await prisma.transcriptChunk.findMany({
        where: { sessionId },
        orderBy: { index: "asc" },
      });
      // eslint-disable-next-line no-console
      console.log("[socket] stop: chunks", {
        sessionId,
        count: chunks.length,
      });

      const fullTranscript = chunks
        .map((chunk: { text: string }) => chunk.text)
        .join(" ");
      // eslint-disable-next-line no-console
      console.log("[socket] stop: transcriptLength", {
        sessionId,
        length: fullTranscript.length,
      });

      const summary = await summarizeTranscript({
        transcript: fullTranscript,
      });
      // eslint-disable-next-line no-console
      console.log("[socket] stop: summary", {
        sessionId,
        hasContent: !!summary.content,
        keyPoints: summary.keyPoints?.length ?? 0,
      });

      const completedSession = await completeSessionWithSummary({
        sessionId,
        summaryContent: summary.content,
        keyPoints: summary.keyPoints,
        actionItems: summary.actionItems,
        decisions: summary.decisions,
        status: "COMPLETED",
      });
      // eslint-disable-next-line no-console
      console.log("[socket] status -> COMPLETED", { sessionId });

      io.to(sessionId).emit("session:completed", {
        sessionId,
        session: completedSession,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[socket] failed to finalize session", error);
      await updateSessionStatus({
        sessionId,
        status: "ERROR",
      }).catch(() => {});

      io.to(sessionId).emit("session:status", {
        sessionId,
        status: "ERROR",
      });

      socket.emit("session:error", {
        message: "Failed to finalize session",
      });
    }
  });
});

httpServer.listen(SOCKET_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[socket] server listening on port ${SOCKET_PORT}`);
});


