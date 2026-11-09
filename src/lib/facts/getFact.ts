import { db } from "@/lib/db";

export type FactResult = { content: string; createdAt: Date; stale: boolean };

// The generator and the clock are passed in so tests can control both.
export type FactGenerator = (movieTitle: string) => Promise<string>;
export type Clock = () => Date;

// A fact younger than this is reused instead of generating a new one.
// "Younger" is strict (<): a fact exactly 60s old is expired.
export const CACHE_WINDOW_MS = 60_000;

// Soft limit on NEW facts per user, counted across all movies. Without it,
// switching movies over and over would bypass the per-movie cache and cost
// an OpenAI call each time. "Soft": the lock below is per user+movie, so
// simultaneous requests for different movies could overshoot slightly.
export const RATE_LIMIT_MAX_FACTS = 10;
export const RATE_LIMIT_WINDOW_MS = 10 * 60_000;

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

// Thrown when the user asked for too many new facts recently.
export class RateLimitedError extends Error {
  constructor() {
    super("Too many new facts requested recently.");
    this.name = "RateLimitedError";
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

        // 3. Rate limit: cache hits above create no rows, so they never
        //    count. Only requests that would call OpenAI get here.
        const recentCount = await tx.fact.count({
          where: {
            userId,
            createdAt: { gt: new Date(now().getTime() - RATE_LIMIT_WINDOW_MS) },
          },
        });
        if (recentCount >= RATE_LIMIT_MAX_FACTS) throw new RateLimitedError();

        // 4. Cache miss: generate, store, return. createdAt comes from the
        //    same clock used for the checks above, so they all agree.
        const content = await generate(movieTitle);
        const fact = await tx.fact.create({
          data: { userId, movieTitle, content, createdAt: now() },
        });
        return toResult(fact, false);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (err) {
    // 5. Failure: OpenAI error or timeout, rate limit, lock wait too long,
    //    DB hiccup. Prefer an old fact over an error page; flag it as stale.
    //    Hitting the rate limit is expected behavior, so don't log it.
    if (!(err instanceof RateLimitedError)) {
      console.error("Fact generation failed, looking for a cached fact:", err);
    }

    const fallback = await db.fact.findFirst({
      where: { userId, movieTitle },
      orderBy: { createdAt: "desc" },
    });
    if (fallback) return toResult(fallback, true);

    // Nothing cached: let the route tell the user why.
    if (err instanceof RateLimitedError) throw err;
    throw new FactUnavailableError();
  }
}
