import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/fact/route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  RATE_LIMIT_MAX_FACTS,
  RATE_LIMIT_WINDOW_MS,
  RateLimitedError,
  getFact,
} from "@/lib/facts/getFact";
import type { FactGenerator } from "@/lib/facts/getFact";
import { generateFact } from "@/lib/openai";
import { createUser, makeClock, makeGenerator, resetDb } from "./helpers";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/openai", () => ({ generateFact: vi.fn() }));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGenerate = vi.mocked(generateFact);

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
  mockGenerate.mockReset();
});

// Generates one fact for each of MAX different movies, all at the clock's
// current time, which uses up the user's allowance.
async function useUpTheLimit(
  userId: string,
  generate: FactGenerator,
  clock: ReturnType<typeof makeClock>,
) {
  for (let i = 1; i <= RATE_LIMIT_MAX_FACTS; i++) {
    await getFact(userId, `Movie ${i}`, generate, clock.now);
  }
}

describe("rate limit on new facts", () => {
  it("blocks a new fact once the user has hit the limit", async () => {
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();
    await useUpTheLimit(user.id, generate, clock);

    await expect(
      getFact(user.id, "One Too Many", generate, clock.now),
    ).rejects.toBeInstanceOf(RateLimitedError);

    expect(generate).toHaveBeenCalledTimes(RATE_LIMIT_MAX_FACTS);
    expect(await db.fact.count({ where: { userId: user.id } })).toBe(
      RATE_LIMIT_MAX_FACTS,
    );
  });

  it("allows new facts again once the window has passed", async () => {
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();
    await useUpTheLimit(user.id, generate, clock);

    clock.advance(RATE_LIMIT_WINDOW_MS);
    const result = await getFact(user.id, "One Too Many", generate, clock.now);

    expect(result.stale).toBe(false);
    expect(generate).toHaveBeenCalledTimes(RATE_LIMIT_MAX_FACTS + 1);
  });

  it("does not count another user's facts", async () => {
    const alice = await createUser("alice@test.com");
    const bob = await createUser("bob@test.com");
    const generate = makeGenerator();
    const clock = makeClock();
    await useUpTheLimit(alice.id, generate, clock);

    const result = await getFact(bob.id, "Movie 1", generate, clock.now);

    expect(result.stale).toBe(false);
  });

  it("serves an older fact for the same movie instead of an error when limited", async () => {
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();
    await useUpTheLimit(user.id, generate, clock);
    const original = await db.fact.findFirstOrThrow({
      where: { userId: user.id, movieTitle: "Movie 1" },
    });

    // 61s later: the 60s cache for Movie 1 has expired, but the user is
    // still inside the rate-limit window.
    clock.advance(61_000);
    const result = await getFact(user.id, "Movie 1", generate, clock.now);

    expect(result.stale).toBe(true);
    expect(result.content).toBe(original.content);
    expect(generate).toHaveBeenCalledTimes(RATE_LIMIT_MAX_FACTS); // no new call
  });
});

describe("GET /api/fact when rate limited", () => {
  it("returns 429 with a friendly message and does not call OpenAI", async () => {
    const user = await createUser("a@test.com", "Inception");
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    // The user already generated MAX facts (for other movies) just now.
    await db.fact.createMany({
      data: Array.from({ length: RATE_LIMIT_MAX_FACTS }, (_, i) => ({
        userId: user.id,
        movieTitle: `Movie ${i + 1}`,
        content: "An earlier fact",
        createdAt: new Date(),
      })),
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toMatch(/too quickly/i);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
