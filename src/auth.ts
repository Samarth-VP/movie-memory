import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  // Auth.js reads AUTH_SECRET and the AUTH_GOOGLE_* credentials automatically.
  providers: [Google],
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      // Database sessions supply the user record; expose its id to server pages.
      session.user.id = user.id;
      return session;
    },
  },
});
