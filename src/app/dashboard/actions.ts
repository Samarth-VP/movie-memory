"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { movieSchema } from "@/lib/validation";

export type UpdateMovieResult = { error?: string };

// There is deliberately no userId parameter: the user comes from the
// session, so this can only ever change the signed-in user's own row.
export async function updateFavoriteMovie(
  rawMovie: string,
): Promise<UpdateMovieResult> {
  const session = await auth();
  if (!session?.user) return { error: "Please sign in again." };

  // Same rules as onboarding. Arguments from the browser are untrusted,
  // exactly like form data, so we validate here no matter what the UI did.
  const parsed = movieSchema.safeParse(rawMovie);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db.user.update({
    where: { id: session.user.id },
    data: { favoriteMovie: parsed.data },
  });

  // Re-render the dashboard with the new movie.
  revalidatePath("/dashboard");
  return {};
}
