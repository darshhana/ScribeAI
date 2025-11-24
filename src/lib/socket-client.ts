"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Singleton Socket.io client used by the recorder UI.
 */
export function getSocket(): Socket {
  if (!socket) {
    const url =
      process.env.NEXT_PUBLIC_SCRIBEAI_SOCKET_URL ??
      "http://localhost:4001";

    socket = io(url, {
      transports: ["websocket"],
    });
  }

  return socket;
}



