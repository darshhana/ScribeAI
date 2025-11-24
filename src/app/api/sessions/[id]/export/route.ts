import { NextResponse } from "next/server";

import { getSessionWithDetails } from "@/lib/db/sessions";

interface GetSessionResponse {
  user?: {
    id: string;
  };
}

async function getAuthUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";

  const response = await fetch("http://localhost:3000/api/auth/get-session", {
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

export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const session = await getSessionWithDetails({
    sessionId: context.params.id,
    userId,
  });

  if (!session) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";

  const transcript = session.transcriptChunks
    .map((chunk: { text: string }) => chunk.text)
    .join(" ");

  if (format === "text") {
    const lines = [
      `Title: ${session.title || "Untitled session"}`,
      `Source: ${session.sourceType}`,
      "",
      "=== Summary ===",
      session.summary?.content ?? "No summary available.",
      "",
      "=== Transcript ===",
      transcript || "No transcript available.",
    ];

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="session-${session.id}.txt"`,
      },
    });
  }

  return NextResponse.json(
    {
      id: session.id,
      title: session.title,
      sourceType: session.sourceType,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      summary: session.summary,
      transcript,
    },
    {
      status: 200,
      headers: {
        "content-disposition": `attachment; filename="session-${session.id}.json"`,
      },
    },
  );
}


