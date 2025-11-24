import { GoogleGenerativeAI } from "@google/generative-ai";

// Use a model that is available on the default v1beta API used by this
// version of @google/generative-ai.
const GEMINI_MODEL_TRANSCRIBE = "gemini-3-pro-preview";
const GEMINI_MODEL_SUMMARY = "gemini-3-pro-preview";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  // In development we prefer a loud failure so the developer sees the misconfig.
  // The Socket.io server and any API routes importing this module will throw
  // early if the key is missing.
  throw new Error(
    "GEMINI_API_KEY is not set. Please configure it in your environment.",
  );
}

const genAI = new GoogleGenerativeAI(apiKey);
const transcribeModel = genAI.getGenerativeModel({
  model: GEMINI_MODEL_TRANSCRIBE,
});
const summaryModel = genAI.getGenerativeModel({
  model: GEMINI_MODEL_SUMMARY,
});

export interface TranscribeChunkParams {
  sessionId: string;
  /**
   * Raw audio bytes for this chunk.
   */
  audioBytes: Uint8Array;
  /**
   * MIME type of the audio (e.g. "audio/webm;codecs=opus").
   */
  mimeType: string;
  /**
   * Sequential index of this chunk within the session.
   */
  index: number;
}

export interface TranscribeChunkResult {
  text: string;
}

/**
 * Transcribe a single audio chunk with Gemini.
 *
 * This function is intentionally stateless: each chunk is transcribed
 * independently and higher-level aggregation is handled in the DB and caller.
 */
export async function transcribeChunk(
  params: TranscribeChunkParams,
): Promise<TranscribeChunkResult> {
  const { audioBytes, mimeType } = params;

  const base64Audio = Buffer.from(audioBytes).toString("base64");

  const result = await transcribeModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "You are a real-time meeting transcription engine. " +
              "Transcribe the following short audio segment as accurately as possible. " +
              "Do not add any explanations, timestamps, or speaker labels here — " +
              "return only the plain text utterances from this segment.",
          },
          {
            inlineData: {
              data: base64Audio,
              mimeType,
            },
          },
        ],
      },
    ],
  });

  const text = result.response.text().trim();

  return { text };
}

export interface SummarizeTranscriptParams {
  /**
   * Full concatenated transcript for a session.
   */
  transcript: string;
}

export interface SummarizeTranscriptResult {
  content: string;
  keyPoints: string[] | null;
  actionItems: string[] | null;
  decisions: string[] | null;
}

/**
 * Summarize a completed meeting transcript into key points, action items,
 * and decisions. The output is designed to map directly onto the Prisma
 * `Summary` model fields.
 */
export async function summarizeTranscript(
  params: SummarizeTranscriptParams,
): Promise<SummarizeTranscriptResult> {
  const { transcript } = params;

  const prompt =
    "You are an expert meeting assistant. You will be given the full transcript " +
    "of a meeting. Produce a concise but information-dense summary with:\n" +
    "1) A 3–6 sentence overview.\n" +
    "2) A bullet list of key points.\n" +
    "3) A bullet list of concrete action items with owners if mentioned.\n" +
    "4) A bullet list of explicit decisions.\n\n" +
    "Return JSON with the shape:\n" +
    '{\n  "summary": string,\n' +
    '  "keyPoints": string[],\n' +
    '  "actionItems": string[],\n' +
    '  "decisions": string[]\n}\n' +
    "Do not include any extra keys or commentary. Here is the transcript:\n\n" +
    transcript;

  const result = await summaryModel.generateContent(prompt);
  const raw = result.response.text().trim();

  let parsed:
    | {
        summary?: string;
        keyPoints?: string[];
        actionItems?: string[];
        decisions?: string[];
      }
    | null = null;

  try {
    // Gemini sometimes wraps JSON in markdown fences; strip them if present.
    const normalized = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(normalized);
  } catch {
    // Fallback: use the raw text as the summary if JSON parsing fails.
    return {
      content: raw,
      keyPoints: null,
      actionItems: null,
      decisions: null,
    };
  }

  const safe = parsed ?? {};

  return {
    content: safe.summary ?? raw,
    keyPoints: safe.keyPoints ?? null,
    actionItems: safe.actionItems ?? null,
    decisions: safe.decisions ?? null,
  };
}



