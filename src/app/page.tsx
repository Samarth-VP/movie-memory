import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function Home() {
  const session = await auth();

  // The dashboard decides whether a signed-in user still needs onboarding.
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold">Movie Memory</h1>
      <p>Remember something new about your favorite movie.</p>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/dashboard" });
        }}
      >
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 font-medium text-background"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
