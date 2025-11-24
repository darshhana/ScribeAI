## ScribeAI – Real‑Time AI Meeting Scribing (AttackCapital Assignment)

ScribeAI is a full‑stack, **real‑time meeting transcription and summarization tool** built for the AttackCapital assignment.  
It captures audio from either your **microphone** or a **shared meeting/tab (Google Meet, Zoom in browser, YouTube, etc.)**, streams chunks to **Google Gemini**, and persists the transcript and AI summary in **Postgres**.

Core flow: **Authenticate → Start session (mic/tab) → Live transcript via Socket.io → Pause/Resume → Stop & summarize → Browse/export history.**

---

## Tech Stack

- **Frontend + Backend**: Next.js 16 (App Router, TypeScript, React Server Components), Tailwind CSS (dark‑mode friendly).
- **Realtime**: Dedicated Node.js **Socket.io** server (TypeScript) for audio streaming and status updates.
- **Database**: Postgres 16 (via Docker), modeled with **Prisma ORM**.
- **Authentication**: **Better Auth** (email + password) integrated with Next.js app routes.
- **AI**: **Google Gemini** (`@google/generative-ai`) for:
  - Chunk‑level **transcription**.
  - Full‑session **meeting summaries** (key points, action items, decisions).
- **Validation & Types**: Zod for payload validation, TypeScript everywhere.
- **Tooling**: ESLint, Prettier, npm scripts, typed Prisma client.

---

## Quick Start

### 1. Start Postgres (Docker)

From the `scribeai` directory:

```bash
docker compose up -d
```

This starts Postgres on `localhost:5434` with default credentials `scribeai` / `scribeai`.

### 2. Environment Variables

Copy the example env file and fill in your values:

```bash
cp env.example .env
```

Minimum required:

- `DATABASE_URL=postgresql://scribeai:scribeai@localhost:5434/scribeai?schema=public`
- `GEMINI_API_KEY=your-google-gemini-api-key`
- `BETTER_AUTH_SECRET=some-long-random-string`
- `BETTER_AUTH_URL=http://localhost:3000`

### 3. Install Dependencies & Run Migrations

```bash
npm install
npx prisma migrate dev
npx prisma generate
```

### 4. Run Next.js + Socket.io Together

```bash
npm run dev:all
```

This starts:

- Next.js on `http://localhost:3000`
- Socket.io server on `http://localhost:4001`

Open `http://localhost:3000` in Chrome.

---

## User Flow (What Reviewers Will See)

1. **Sign up & log in**
   - Visit `/sign-up` to create an account with email + password (Better Auth).
   - Log in via `/login` to access the dashboard.

2. **Record a meeting**
   - Go to `/sessions` (Live Sessions dashboard).
   - Choose **Microphone** to capture mic audio, or **Tab audio** to capture a specific tab (Meet, Zoom web, YouTube, etc.).
   - Click **Start session**, grant permissions, and speak or play audio.
   - Watch the **Live transcript** panel update in near real time as Gemini transcribes chunks.

3. **Pause, resume, and stop**
   - Use **Pause** / **Stop & summarize**:
     - While recording: **Pause** stops streaming chunks but keeps the session active.
     - **Stop & summarize** emits `session:stop`, aggregates transcript, and triggers the Gemini summarization pipeline.
   - Status indicator moves through **Recording → Processing summary… → Completed**.

4. **Review history & export**
   - In **History**, each row shows title, source (Mic/Tab), created time, and status.
   - Click a session to open `/sessions/[id]`:
     - Full transcript (chronological).
     - AI summary (overview, key points, action items, decisions).
     - Export controls for `.txt` and `.json`.

These steps map 1‑to‑1 with the required 3–5 minute Loom/YouTube walkthrough.

---

## Architecture Overview

### Architecture in Simple Words

- **Next.js app (frontend + API)**
  - Renders the UI: `/sessions` (recorder + history) and `/sessions/[id]` (details).
  - Uses Better Auth for login and Prisma to read/write data in Postgres.

- **Socket.io server (Node)**
  - Lives in `server/index.ts`.
  - Listens for events from the browser: `session:start`, `session:audioChunk`, `session:pause`, `session:resume`, `session:stop`.
  - Talks to Gemini for transcription/summary and to Postgres for saving data.

- **Postgres database (via Prisma)**
  - `Session` stores high‑level info (user, source, status, timestamps).
  - `TranscriptChunk` stores all small pieces of text for each session.
  - `Summary` stores the final AI summary for a session.

- **Flow of a recording**
  1. Browser calls `session:start` → server creates a `Session` row and sets status to `RECORDING`.
  2. Every few seconds, the browser sends `session:audioChunk` → server calls Gemini to get text, saves a `TranscriptChunk`, and pushes live text back to the browser.
  3. When you click **Stop & summarize**, the browser sends `session:stop` → server loads all chunks, asks Gemini for a summary, saves a `Summary`, marks the session `COMPLETED`, and notifies the UI.
  4. Later, the Next.js pages just read data from Postgres and display transcript + summary.

### High-Level Components

- **Next.js App Router**
  - `app/(auth)/login`, `app/(auth)/sign-up` – Better Auth forms.
  - `app/(dashboard)/sessions/page.tsx` – recorder UI + session history.
  - `app/(dashboard)/sessions/[id]/page.tsx` – full transcript and summary detail view.
  - `app/api/sessions/[id]/export/route.ts` – text/JSON export endpoint.

- **Database (Prisma / Postgres)**
  - `User` – mapped from Better Auth user.
  - `Session` – one row per recording session (status, source type, timestamps).
  - `TranscriptChunk` – ordered, time‑stamped text chunks for each session.
  - `Summary` – structured AI meeting summary (stored as JSON strings).

- **Realtime Socket.io Server** (`server/index.ts`)
  - Receives audio chunks over WebSockets.
  - Sends chunks to Gemini for transcription.
  - Persists `TranscriptChunk`s and summary.
  - Emits status + partial transcripts back to the client.

- **Gemini Integration** (`src/lib/gemini.ts`)
  - `transcribeChunk` – stateless per‑chunk transcription with inline audio.
  - `summarizeTranscript` – prompt‑engineered JSON summary mapped to `Summary`.

- **State Management** (`src/lib/state/recorderMachine.ts`)
  - XState machine for recorder lifecycle:
    - `idle → recording → paused → processing → completed` (+ `reconnecting`, `error`).
  - Drives status pill (“Idle”, “Recording”, “Processing summary…”, etc.) and button states.

---

## Audio Stream Pipeline (Mermaid)

```mermaid
sequenceDiagram
  participant B as Browser (Recorder)
  participant WS as Socket.io Server
  participant G as Gemini
  participant DB as Postgres (Prisma)
  participant N as Next.js App

  B->>WS: session:start (userId, sessionId, sourceType)
  WS->>DB: create Session (status=RECORDING)

  loop Every N seconds (chunk)
    B->>WS: session:audioChunk (base64 audio, index, startMs, endMs)
    WS->>G: generateContent(audio chunk)
    G-->>WS: transcript text
    WS->>DB: create TranscriptChunk
    WS-->>B: session:partialTranscript (index, text)
  end

  B->>WS: session:stop
  WS->>DB: update Session (status=PROCESSING)
  WS->>DB: read TranscriptChunks (ordered)
  WS->>G: summarizeTranscript(full transcript)
  G-->>WS: structured JSON summary
  WS->>DB: upsert Summary + update Session (status=COMPLETED)
  WS-->>B: session:completed (session + summary)

  B->>N: navigate /sessions, /sessions/[id]
  N->>DB: listUserSessions / getSessionWithDetails
  DB-->>N: data
  N-->>B: render history + details
```

---

## Streaming vs Upload – Architecture Comparison

| Dimension                | Streaming (Socket.io + chunks)                                              | Batched Upload (single file at end)                                 |
|--------------------------|-----------------------------------------------------------------------------|---------------------------------------------------------------------|
| **User latency**         | Very low – partial transcript appears during the meeting.                  | High – no feedback until the upload + processing completes.         |
| **Failure visibility**   | Early – network/API errors surface while the call is ongoing.              | Late – issues only visible once the final upload fails.             |
| **Memory footprint**     | Bounded – only the current chunk in memory; history lives in Postgres.     | Large – browser must keep full recording until upload.              |
| **Server load pattern**  | Smooth – work amortized over call duration.                                | Spiky – big upload + heavy processing on stop.                      |
| **UX for long sessions** | Great – users can scroll transcript and see progress continuously.         | Risky – 60+ minutes may fail late, risking loss of the meeting.     |
| **Implementation effort**| Higher – WebSockets, chunking, backpressure, reconnection.                 | Lower – single HTTPS upload + one transcription call.               |
| **Scalability**          | Better for many concurrent sessions; easy to apply per‑session limits.     | Simpler but harder to smooth load and enforce fair sharing.         |

**ScribeAI deliberately chooses streaming** to maximize real‑time feedback and robustness for long meetings.

---

## Long-Session Scalability (≈200 words)

ScribeAI is designed to handle **hour‑long meetings** without exhausting memory on either the client or server. The browser uses the `MediaRecorder` API to capture audio and emits **fixed‑size chunks** (roughly every 10 seconds) over a persistent Socket.io connection. Each chunk is encoded to base64 and sent immediately, then released from memory. The Node.js server treats chunks as **stateless work units**: it forwards them to Gemini for transcription, persists each `TranscriptChunk` via Prisma, and broadcasts partial text back to the correct Socket.io room. At any time, the server holds only the current chunk and light metadata in memory per session; all history is in Postgres.

On stop, the server reads all chunks for that `sessionId`, concatenates the text, and calls `summarizeTranscript` to generate a structured JSON summary. Because the transcript is chunked and ordered, this aggregation can also be implemented as a streaming read for extremely long meetings. Failures are contained: if a few Gemini calls fail or the network drops temporarily, already‑stored chunks remain safe and can be re‑processed. The XState machine surfaces these states in the UI (`reconnecting`, `error`), and Socket.io rooms make it straightforward to introduce **backpressure** or scale horizontally with a Redis adapter and sticky sessions. The net result is a pipeline that is both real‑time and resilient for long, concurrent sessions.

---

## WebRTC vs MediaRecorder – Design Decision

The assignment mentions considering **WebRTC** versus raw **MediaRecorder**:

- **Chosen approach: MediaRecorder + Socket.io**
  - Simpler to implement and reason about in a single‑page Next.js app.
  - Works well for unidirectional “record → transcribe” flows where we don’t need full peer‑to‑peer media negotiation.
  - Chunked `MediaRecorder` output maps naturally to Gemini’s content API and Postgres `TranscriptChunk`s.

- **Why not full WebRTC SFU for this prototype?**
  - WebRTC shines for multi‑party, low‑latency video/audio routing and selective forwarding; it adds significant complexity (ICE, STUN/TURN, SDP).
  - For this assignment, all audio streams terminate at our own backend; there’s no need to fan out live media to other peers.
  - Using MediaRecorder preserves focus on the **AI scribing pipeline** rather than transport plumbing, while still being architecturally compatible with an SFU in the future.

This trade‑off is discussed in comments and the architecture section to demonstrate media‑handling depth.

---

## Resilience & Edge Cases

- **Network drops / Socket disconnects**
  - XState transitions to `reconnecting` when the socket disconnects and back to `recording` on reconnect.
  - In a reconnect scenario, the UI can rejoin the session room by `sessionId` and continue to receive updates.

- **Device/tab stops providing audio**
  - Streams are closed and the session transitions to `processing` when the recorder is stopped or the tab share ends.
  - The final transcript and summary still run using all chunks recorded so far.

- **Gemini overloads / 503s**
  - Errors from Gemini (e.g., model overloaded) are surfaced via `session:error` events and marked with status `ERROR` in the UI.
  - Already‑stored transcript chunks remain intact; sessions can be re‑summarized later if desired.

- **Old/broken sessions**
  - Defensive DB helpers (e.g., `updateSessionStatus` using `updateMany`) avoid throwing for legacy session ids without rows.

---

## Key Files & Modules

- `prisma/schema.prisma` – models for `User`, `Session`, `TranscriptChunk`, `Summary`.
- `src/lib/prisma.ts` – Prisma client singleton.
- `src/lib/db/sessions.ts` – data access helpers (`createSession`, `appendTranscriptChunk`, `completeSessionWithSummary`, `listUserSessions`, etc.).
- `src/lib/gemini.ts` – `transcribeChunk` + `summarizeTranscript` wrappers around Google Gemini.
- `src/lib/auth.ts` & `app/api/auth/[...betterAuth]/route.ts` – Better Auth configuration and Next.js binding.
- `server/index.ts` – Socket.io server and main streaming pipeline.
- `src/lib/state/recorderMachine.ts` – XState definition for the recorder UI.
- `app/(dashboard)/sessions/page.tsx` – main dashboard: recorder + history.
- `app/(dashboard)/sessions/[id]/page.tsx` – detail view: full transcript and AI summary.
- `app/api/sessions/[id]/export/route.ts` – text/JSON export for transcripts and summaries.

---

## Notes for Reviewers

- The codebase is organized to be **incrementally scalable**:
  - Socket.io server is separate from Next.js and can be horizontally scaled with a Redis adapter.
  - Prisma models are normalized for efficient querying of long transcripts.
- The recorder UI is intentionally minimal but designed for **clarity during long sessions**:
  - Dark mode.
  - Clear status changes.
  - Immediate feedback via Live transcript.

The goal of ScribeAI is to demonstrate not just a working prototype, but **thoughtful architecture for long, concurrent AI‑powered audio sessions**, aligned with the AttackCapital problem statement.

