import { db } from "@/lib/db";

export type FactResult = { content: string; createdAt: Date; stale: boolean };

// The generator and the clock are passed in so tests can control both.
export type FactGenerator = (movieTitle: string) => Promise<string>;
export type Clock = () => Date;

// A fact younger than this is reused instead of generating a new one.
// "Younger" is strict (<): a fact exactly 60s old is expired.
export const CACHE_WINDOW_MS = 60_000;

// The transaction stays open while we wait for OpenAI (10s timeout in
// openai.ts), and a second tab waiting on the lock counts against this too.
// Prisma's 5s default would cancel a normal request, so we raise it.
const TRANSACTION_TIMEOUT_MS = 15_000;

// Thrown when OpenAI failed AND we have nothing cached to show.
export class FactUnavailableError extends Error {
  constructor() {
    super("No fact could be generated and none is cached.");
    this.name = "FactUnavailableError";
  }
}

function toResult(
  fact: { content: string; createdAt: Date },
  stale: boolean,
): FactResult {
  return { content: fact.content, createdAt: fact.createdAt, stale };
}

export async function getFact(
  userId: string,
  movieTitle: string,
  generate: FactGenerator,
  now: Clock = () => new Date(),
): Promise<FactResult> {
  try {
    return await db.$transaction(
      async (tx) => {
        // 1. Lock: only one request per user+movie gets past this line at a
        //    time; others wait here. The lock is released automatically when
        //    the transaction commits or rolls back. (The function returns
        //    void, so we use $executeRaw, which ignores the result.)
        const lockKey = `${userId}:${movieTitle}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;

        // 2. Cache check, done AFTER taking the lock. A request that waited
        //    sees the fact the previous request just committed (Postgres'
        //    default READ COMMITTED isolation reads fresh data per query).
        const latest = await tx.fact.findFirst({
          where: { userId, movieTitle },
          orderBy: { createdAt: "desc" },
        });
        if (latest && now().getTime() - latest.createdAt.getTime() < CACHE_WINDOW_MS) {
          return toResult(latest, false);
        }

        // 3. Cache miss: generate, store, return. createdAt comes from the
        //    same clock used for the check above, so both sides agree.
        const content = await generate(movieTitle);
        const fact = await tx.fact.create({
          data: { userId, movieTitle, content, createdAt: now() },
        });
        return toResult(fact, false);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (err) {
    // 4. Failure: OpenAI error or timeout, lock wait too long, DB hiccup.
    //    Prefer an old fact over an error page; flag it as stale.
    console.error("Fact generation failed, looking for a cached fact:", err);

    const fallback = await db.fact.findFirst({
      where: { userId, movieTitle },
      orderBy: { createdAt: "desc" },
    });
    if (fallback) return toResult(fallback, true);

    throw new FactUnavailableError();
  }
}
