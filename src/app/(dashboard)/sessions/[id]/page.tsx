import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { getSessionWithDetails } from "@/lib/db/sessions";

interface GetSessionResponse {
  user?: {
    id: string;
  };
}

async function getAuthUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

  const response = await fetch(`${baseUrl}/api/auth/get-session`, {
    method: "GET",
    headers: {
      cookie: cookieHeader,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json().catch(() => null)) as
    | GetSessionResponse
    | null;

  return data?.user?.id ?? null;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getAuthUserId();

  if (!userId) {
    notFound();
  }

  const session = await getSessionWithDetails({
    sessionId: id,
    userId,
  });

  if (!session) {
    notFound();
  }

  const transcript = session.transcriptChunks
    .map((chunk) => chunk.text)
    .join(" ");

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Session
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.title || "Untitled session"}
          </h1>
        </div>
        <p className="text-xs text-zinc-500">
          {session.sourceType === "MIC" ? "Microphone" : "Tab audio"} •{" "}
          {new Date(session.startedAt).toLocaleString()}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-400">
              Transcript
            </h2>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <a
                href={`/api/sessions/${session.id}/export?format=text`}
                className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-900 hover:bg-white"
              >
                Download .txt
              </a>
              <a
                href={`/api/sessions/${session.id}/export?format=json`}
                className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Download JSON
              </a>
            </div>
          </div>
          <div className="h-80 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-sm leading-relaxed text-zinc-200">
            {transcript || (
              <span className="text-zinc-500">
                No transcript chunks were recorded for this session.
              </span>
            )}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-400">
            AI summary
          </h2>
          <div className="space-y-3 text-sm text-zinc-200">
            {session.summary?.content ? (
              <p className="whitespace-pre-wrap">
                {session.summary.content}
              </p>
            ) : (
              <span className="text-zinc-500">
                No summary is stored for this session yet.
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}


