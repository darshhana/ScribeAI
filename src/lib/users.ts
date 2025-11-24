import { prisma } from "./prisma";

export interface AuthUserSnapshot {
  id: string;
  email: string;
  name?: string | null;
}

/**
 * Ensure there is a Prisma `User` row corresponding to the authenticated
 * Better Auth user. This keeps our application data (sessions, transcripts)
 * linked to auth identities without coupling directly to Better Auth's
 * internal storage.
 */
export async function ensureUserFromAuth(
  authUser: AuthUserSnapshot,
) {
  const { id, email, name } = authUser;

  return prisma.user.upsert({
    // Use the unique email field for upsert, and keep the primary key `id`
    // aligned with the Better Auth user id.
    where: { email },
    update: {
      id,
      email,
      name: name ?? undefined,
    },
    create: {
      id,
      email,
      name: name ?? undefined,
      // Placeholder hash – passwords are managed by Better Auth, not Prisma.
      passwordHash: "managed-by-better-auth",
    },
  });
}



