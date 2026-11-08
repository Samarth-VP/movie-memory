import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    // Keep the default profile fields and add the database user's id.
    user: { id: string } & DefaultSession["user"];
  }
}
