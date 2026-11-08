import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const user = await requireUser();
  // Onboarding is first-time only: anyone with a movie goes to the dashboard.
  if (user.favoriteMovie) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Welcome to Movie Memory</h1>
      <p className="text-gray-400">
        Tell us your favorite movie and we&apos;ll show you a fun fact about it.
      </p>
      <OnboardingForm />
    </main>
  );
}
