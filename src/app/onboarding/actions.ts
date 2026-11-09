"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { movieSchema } from "@/lib/validation";

export type OnboardingState = { error?: string; value?: string };

export async function saveFavoriteMovie(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // Never trust the client: re-check the session inside the action.
  const session = await auth();
  if (!session?.user) redirect("/");

  const raw = String(formData.get("movie") ?? "");
  const parsed = movieSchema.safeParse(raw);
  if (!parsed.success) {
    // Return the typed text so the form can show it again.
    return { error: parsed.error.issues[0].message, value: raw };
  }

  // The user id comes from the session, never from the form,
  // so this can only ever update the signed-in user's own row.
  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { favoriteMovie: parsed.data },
    });
  } catch (err) {
    // Log the real error on the server, show the user a plain message.
    console.error("Saving favorite movie failed:", err);
    return {
      error: "We couldn't save your movie right now. Please try again.",
      value: raw,
    };
  }

  // redirect() works by throwing, so it must stay outside the try/catch above.
  redirect("/dashboard");
}
