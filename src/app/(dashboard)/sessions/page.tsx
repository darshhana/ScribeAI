import { cookies } from "next/headers";

import { ensureUserFromAuth } from "@/lib/users";
import { listUserSessions } from "@/lib/db/sessions";
import Recorder from "./Recorder";

interface GetSessionResponse {
  user?: {
    id: string;
    email: string;
    name?: string | null;
  };
}

async function getAuthUser(): Promise<GetSessionResponse["user"]> {
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
    return undefined;
  }

  const data = (await response.json().catch(() => null)) as
    | GetSessionResponse
    | null;

  return data?.user;
}

export default async function SessionsPage() {
  const user = await getAuthUser();

  if (!user) {
    // Layout guard should normally prevent this, but we keep a defensive
    // fallback here.
    return null;
  }

  await ensureUserFromAuth({
    id: user.id,
    email: user.email,
    name: user.name,
  });

  const sessions = await listUserSessions({
    userId: user.id,
  });

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Live Sessions
        </h1>
        <p className="text-sm text-zinc-400">
          Capture meetings from your microphone or a shared tab and watch the
          transcript build in real time.
        </p>
      </header>

      <Recorder userId={user.id} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-400">
            History
          </h2>
        </div>

        <SessionList sessions={sessions} />
      </section>
    </div>
  );
}

function SessionList({ sessions }: { sessions: Array<{ id: string; title: string | null; sourceType: string; startedAt: Date; status: string }> }) {
  if (!sessions.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
        No sessions yet. Record a meeting and it will appear here.
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 text-sm">
      {sessions.map((session) => (
        <a
          key={session.id}
          href={`/sessions/${session.id}`}
          className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-zinc-900/70"
        >
          <div className="min-w-0 space-y-1">
            <p className="truncate font-medium text-zinc-100">
              {session.title || "Untitled session"}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {session.sourceType === "MIC" ? "Microphone" : "Tab audio"} •{" "}
              {new Date(session.startedAt).toLocaleString()}
            </p>
          </div>
          <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            {session.status}
          </span>
        </a>
      ))}
    </div>
  );
}



