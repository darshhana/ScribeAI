import { prisma } from "../prisma";

type SessionSourceType = "MIC" | "TAB";
type SessionStatus = "RECORDING" | "PAUSED" | "PROCESSING" | "COMPLETED" | "ERROR";

interface Session {
  id: string;
  userId: string;
  title: string | null;
  sourceType: SessionSourceType;
  status: SessionStatus;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TranscriptChunk {
  id: string;
  sessionId: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  createdAt: Date;
}

interface Summary {
  id: string;
  sessionId: string;
  content: string;
  keyPoints: string | null;
  actionItems: string | null;
  decisions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionWithRelations = Session & {
  transcriptChunks: TranscriptChunk[];
  summary: Summary | null;
};

export interface CreateSessionInput {
  id?: string;
  userId: string;
  title?: string;
  sourceType: SessionSourceType;
}

/**
 * Create a new recording session for a user.
 */
export async function createSession(
  input: CreateSessionInput,
): Promise<Session> {
  const { id, userId, title, sourceType } = input;

  return prisma.session.create({
    data: {
      ...(id ? { id } : {}),
      userId,
      title,
      sourceType,
      status: "RECORDING",
    },
  });
}

export interface UpdateSessionStatusInput {
  sessionId: string;
  status: SessionStatus;
}

/**
 * Update the high-level status of a session (e.g. RECORDING, PAUSED,
 * PROCESSING, COMPLETED, ERROR).
 */
export async function updateSessionStatus(
  input: UpdateSessionStatusInput,
): Promise<void> {
  const { sessionId, status } = input;

  // Use updateMany so we don't throw if the session row is missing
  // (e.g. very old sessions created before recent fixes).
  await prisma.session.updateMany({
    where: { id: sessionId },
    data: { status },
  });
}

export interface AppendTranscriptChunkInput {
  sessionId: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Append a transcript chunk to a session.
 */
export async function appendTranscriptChunk(
  input: AppendTranscriptChunkInput,
): Promise<TranscriptChunk> {
  const { sessionId, index, text, startMs, endMs } = input;

  return prisma.transcriptChunk.create({
    data: {
      sessionId,
      index,
      text,
      startMs,
      endMs,
    },
  });
}

export interface CompleteSessionWithSummaryInput {
  sessionId: string;
  summaryContent: string;
  keyPoints?: string[] | null;
  actionItems?: string[] | null;
  decisions?: string[] | null;
  status?: SessionStatus;
}

/**
 * Mark a session as completed (or errored) and persist the AI summary.
 */
export async function completeSessionWithSummary(
  input: CompleteSessionWithSummaryInput,
): Promise<SessionWithRelations> {
  const {
    sessionId,
    summaryContent,
    keyPoints,
    actionItems,
    decisions,
    status = "COMPLETED",
  } = input;

  await prisma.$transaction([
    prisma.session.update({
      where: { id: sessionId },
      data: {
        status,
        completedAt: new Date(),
      },
    }),
    prisma.summary.upsert({
      where: { sessionId },
      update: {
        content: summaryContent,
        keyPoints: keyPoints ? JSON.stringify(keyPoints) : null,
        actionItems: actionItems ? JSON.stringify(actionItems) : null,
        decisions: decisions ? JSON.stringify(decisions) : null,
      },
      create: {
        sessionId,
        content: summaryContent,
        keyPoints: keyPoints ? JSON.stringify(keyPoints) : null,
        actionItems: actionItems ? JSON.stringify(actionItems) : null,
        decisions: decisions ? JSON.stringify(decisions) : null,
      },
    }),
  ]);

  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      transcriptChunks: {
        orderBy: { index: "asc" },
      },
      summary: true,
    },
  });

  return session;
}

export interface ListUserSessionsInput {
  userId: string;
}

/**
 * Fetch all sessions for a user, newest first.
 */
export async function listUserSessions(
  input: ListUserSessionsInput,
): Promise<Session[]> {
  const { userId } = input;

  return prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export interface GetSessionWithDetailsInput {
  sessionId: string;
  userId: string;
}

/**
 * Fetch a single session for a user with full transcript and summary.
 */
export async function getSessionWithDetails(
  input: GetSessionWithDetailsInput,
): Promise<SessionWithRelations | null> {
  const { sessionId, userId } = input;

  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
    include: {
      transcriptChunks: {
        orderBy: { index: "asc" },
      },
      summary: true,
    },
  });

  return session;
}


