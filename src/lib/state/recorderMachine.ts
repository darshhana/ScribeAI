import { createMachine } from "xstate";

export type RecorderSourceType = "MIC" | "TAB";

export interface RecorderContext {
  sessionId?: string;
  sourceType: RecorderSourceType;
  statusMessage: string;
  errorMessage?: string;
}

export type RecorderEvent =
  | { type: "START"; sessionId: string; sourceType: RecorderSourceType }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "PROCESSING" }
  | { type: "COMPLETED" }
  | { type: "SOCKET_DISCONNECTED" }
  | { type: "SOCKET_RECONNECTED" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

/**
 * XState machine describing the recorder lifecycle for a single session.
 */
export const recorderMachine = createMachine(
  {
    id: "recorder",
    tsTypes: {} as import("./recorderMachine.typegen").Typegen0,
    schema: {
      context: {} as RecorderContext,
      events: {} as RecorderEvent,
    },
    context: {
      sessionId: undefined,
      sourceType: "MIC",
      statusMessage: "Idle",
      errorMessage: undefined,
    },
    initial: "idle",
    states: {
      idle: {
        on: {
          START: {
            target: "recording",
            actions: ["assignStart"],
          },
        },
      },
      recording: {
        on: {
          PAUSE: {
            target: "paused",
            actions: "setStatusPaused",
          },
          STOP: "processing",
          SOCKET_DISCONNECTED: {
            target: "reconnecting",
            actions: "setStatusReconnecting",
          },
          ERROR: {
            target: "error",
            actions: "assignError",
          },
        },
      },
      paused: {
        on: {
          RESUME: {
            target: "recording",
            actions: "setStatusRecording",
          },
          STOP: "processing",
        },
      },
      reconnecting: {
        on: {
          SOCKET_RECONNECTED: {
            target: "recording",
            actions: "setStatusRecording",
          },
          STOP: "processing",
        },
      },
      processing: {
        entry: "setStatusProcessing",
        on: {
          COMPLETED: "completed",
          ERROR: {
            target: "error",
            actions: "assignError",
          },
        },
      },
      completed: {
        entry: "setStatusCompleted",
        on: {
          START: {
            target: "recording",
            actions: ["assignStart"],
          },
          RESET: "idle",
        },
      },
      error: {
        entry: "setStatusError",
        on: {
          RESET: {
            target: "idle",
            actions: "clearError",
          },
        },
      },
    },
  },
  {
    actions: {
      assignStart: (context, event) => {
        if (!event || event.type !== "START") return;
        context.sessionId = event.sessionId;
        context.sourceType = event.sourceType;
        context.statusMessage = "Recording";
        context.errorMessage = undefined;
      },
      assignError: (context, event) => {
        if (!event || event.type !== "ERROR") return;
        context.errorMessage = event.message;
        context.statusMessage = "Error";
      },
      clearError: (context) => {
        context.errorMessage = undefined;
        context.statusMessage = "Idle";
      },
      setStatusRecording: (context) => {
        context.statusMessage = "Recording";
      },
      setStatusPaused: (context) => {
        context.statusMessage = "Paused";
      },
      setStatusProcessing: (context) => {
        context.statusMessage = "Processing summary…";
      },
      setStatusCompleted: (context) => {
        context.statusMessage = "Completed";
      },
      setStatusReconnecting: (context) => {
        context.statusMessage = "Reconnecting…";
      },
      setStatusError: (context) => {
        if (!context.errorMessage) {
          context.errorMessage = "Unexpected error";
        }
      },
    },
  },
);



