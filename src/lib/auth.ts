import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";

/**
 * Better Auth server instance.
 *
 * We use the minimal initializer (no Kysely) and let Better Auth manage
 * its own persistence. Our application data (sessions, transcripts, etc.)
 * is stored separately via Prisma.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  /**
   * Enable email + password authentication.
   *
   * In a production app you would likely add email verification and
   * rate limiting; for this assignment we keep the config minimal.
   */
  emailAndPassword: {
    enabled: true,
  },
  /**
   * Ensure Better Auth can read/write cookies via Next.js' `cookies()`
   * helper in the App Router.
   */
  plugins: [nextCookies()],
});



