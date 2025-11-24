import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

async function requireSession() {
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
    redirect("/login");
  }

  const data = (await response.json().catch(() => null)) as
    | { session?: unknown; user?: unknown }
    | null;

  if (!data?.user || !data.session) {
    redirect("/login");
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireSession();

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-50">
      <aside className="hidden w-64 border-r border-zinc-800 bg-zinc-950/60 px-6 py-6 md:flex md:flex-col">
        <div className="mb-8 text-lg font-semibold tracking-tight">
          ScribeAI
        </div>
        <nav className="space-y-2 text-sm text-zinc-300">
          <a href="/sessions" className="block rounded-md bg-zinc-800 px-3 py-2">
            Sessions
          </a>
        </nav>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}


