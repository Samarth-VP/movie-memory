import { db } from "@/lib/db";

export type FactResult = { content: string; createdAt: Date; stale: boolean };

// The generator is passed in so tests can supply a fake one later.
export type FactGenerator = (movieTitle: string) => Promise<string>;

// BASE VERSION: generate a new fact on every call and store it.
// Step 6 replaces this body with the 60-second cache, a lock against
// simultaneous requests, and a fallback when OpenAI fails.
export async function getFact(
  userId: string,
  movieTitle: string,
  generate: FactGenerator,
): Promise<FactResult> {
  const content = await generate(movieTitle);

  const fact = await db.fact.create({
    data: { userId, movieTitle, content },
  });

  return { content: fact.content, createdAt: fact.createdAt, stale: false };
}
