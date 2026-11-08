import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import OnboardingForm from "./OnboardingForm";

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold">Welcome to Movie Memory</h1>
      <p>Choose your favorite movie to get started.</p>
      <OnboardingForm />
    </main>
  );
}
