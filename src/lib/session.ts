import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// The one place that answers "who is the signed-in user?".
// Redirects to the landing page if nobody is signed in.
export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/");

  return user;
}
