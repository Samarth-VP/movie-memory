import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import Avatar from "./Avatar";
import FactCard from "./FactCard";

export default async function DashboardPage() {
  const user = await requireUser();
  // No movie yet means onboarding hasn't happened.
  if (!user.favoriteMovie) redirect("/onboarding");

  // Google can omit the name, so fall back to the part of the email before "@".
  const displayName = user.name?.trim() || user.email.split("@")[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <header className="flex items-center gap-4">
        <Avatar image={user.image} name={displayName} />
        <div>
          <h1 className="text-2xl font-bold">{displayName}</h1>
          <p className="text-gray-400">{user.email}</p>
        </div>
      </header>

      <section className="rounded-lg border border-gray-500/40 p-5">
        <h2 className="text-sm uppercase tracking-wide text-gray-400">
          Favorite movie
        </h2>
        <p className="mt-1 text-xl font-semibold">{user.favoriteMovie}</p>
      </section>

      <FactCard />

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded border border-gray-500/40 px-4 py-2"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
