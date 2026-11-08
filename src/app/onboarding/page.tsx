import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export default async function Onboarding() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  // Read only the field needed to decide whether onboarding is necessary.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { favoriteMovie: true },
  });

  if (user?.favoriteMovie) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold">Onboarding (placeholder)</h1>
    </main>
  );
}
