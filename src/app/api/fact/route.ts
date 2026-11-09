import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getFact } from "@/lib/facts/getFact";
import { generateFact } from "@/lib/openai";

export async function GET() {
  // 1. Who is asking? The session is the only source of identity.
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Which movie? Read it from the DB, never from the request, so there
  //    is no parameter a user could change to reach someone else's data.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, favoriteMovie: true },
  });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.favoriteMovie) {
    return Response.json(
      { error: "Set your favorite movie first." },
      { status: 409 },
    );
  }

  // 3. Generate, store and return. Log the real error on the server,
  //    send the user a friendly message without internal details.
  try {
    const fact = await getFact(user.id, user.favoriteMovie, generateFact);
    return Response.json(fact);
  } catch (err) {
    console.error("Fact generation failed:", err);
    return Response.json(
      { error: "We couldn't generate a fact right now. Please try again in a moment." },
      { status: 502 },
    );
  }
}
