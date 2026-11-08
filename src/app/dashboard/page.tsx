import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  // Only the authenticated session chooses which user record to read.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { favoriteMovie: true },
  });

  if (!user?.favoriteMovie) {
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold">Dashboard (placeholder)</h1>
      <p>Email: {session.user.email}</p>
      <p>Favorite movie: {user.favoriteMovie}</p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 font-medium text-background"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
