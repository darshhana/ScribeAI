import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Next.js App Router integration for Better Auth.
 *
 * This mounts all Better Auth HTTP endpoints under `/api/auth/*`.
 * Examples:
 * - POST `/api/auth/sign-up/email`
 * - POST `/api/auth/sign-in/email`
 * - GET  `/api/auth/get-session`
 */
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);



