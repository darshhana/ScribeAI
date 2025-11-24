// This file provides minimal TypeScript wiring for XState's `tsTypes` field.
// It is intentionally lightweight for this assignment and does not rely on
// the full XState typegen pipeline.

export interface Typegen0 {
  "@@xstate/typegen": true;
  internalEvents: Record<string, never>;
  invokeSrcNameMap: Record<string, never>;
  missingImplementations: {
    actions: never;
    delays: never;
    guards: never;
    services: never;
  };
  eventsCausingActions: {
    assignError: "ERROR";
    assignStart: "START";
    clearError: "RESET";
    setStatusCompleted: "COMPLETED";
    setStatusError: "ERROR";
    setStatusPaused: "PAUSE";
    setStatusProcessing: "PROCESSING";
    setStatusRecording: "RESUME" | "SOCKET_RECONNECTED" | "START";
    setStatusReconnecting: "SOCKET_DISCONNECTED";
  };
  eventsCausingDelays: Record<string, never>;
  eventsCausingGuards: Record<string, never>;
  eventsCausingServices: Record<string, never>;
  matchesStates:
    | "idle"
    | "recording"
    | "paused"
    | "reconnecting"
    | "processing"
    | "completed"
    | "error";
  tags: never;
}



