import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { db } from "@/lib/db";
import { FactUnavailableError, getFact } from "@/lib/facts/getFact";
import { createUser, makeClock, makeGenerator, resetDb } from "./helpers";

beforeEach(resetDb);

const factCount = (userId: string) => db.fact.count({ where: { userId } });

describe("60-second cache window", () => {
  it("generates and stores a fact on a cache miss", async () => {
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();

    const result = await getFact(user.id, "Inception", generate, clock.now);

    expect(result.stale).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await factCount(user.id)).toBe(1);
  });

  it("returns the cached fact when it is 59 seconds old", async () => {
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();

    const first = await getFact(user.id, "Inception", generate, clock.now);
    clock.advance(59_000);
    const second = await getFact(user.id, "Inception", generate, clock.now);

    expect(second.content).toBe(first.content);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await factCount(user.id)).toBe(1);
  });

  it("generates a new fact once the cached one is 60 seconds old", async () => {
    // The window is strict (< 60s), so exactly 60s counts as expired.
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();

    const first = await getFact(user.id, "Inception", generate, clock.now);
    clock.advance(60_000);
    const second = await getFact(user.id, "Inception", generate, clock.now);

    expect(second.content).not.toBe(first.content);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await factCount(user.id)).toBe(2);
  });

  it("keeps a separate cache per movie", async () => {
    const user = await createUser("a@test.com");
    const generate = makeGenerator();
    const clock = makeClock();

    await getFact(user.id, "Inception", generate, clock.now);
    await getFact(user.id, "The Matrix", generate, clock.now);

    // Same user, same moment, different movie: no cache hit.
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe("when OpenAI fails", () => {
  // getFact logs the error on purpose; keep the test output clean.
  let errorSpy: MockInstance;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("returns the most recent cached fact, marked stale", async () => {
    const user = await createUser("a@test.com");
    const clock = makeClock();
    const failing = vi.fn().mockRejectedValue(new Error("OpenAI is down"));

    const first = await getFact(user.id, "Inception", makeGenerator(), clock.now);
    clock.advance(120_000); // cache expired, so a new fact is needed
    const result = await getFact(user.id, "Inception", failing, clock.now);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(result.stale).toBe(true);
    expect(result.content).toBe(first.content);
    expect(await factCount(user.id)).toBe(1); // nothing new was stored
  });

  it("throws FactUnavailableError when nothing is cached", async () => {
    const user = await createUser("a@test.com");
    const failing = vi.fn().mockRejectedValue(new Error("OpenAI is down"));

    await expect(
      getFact(user.id, "Inception", failing, makeClock().now),
    ).rejects.toBeInstanceOf(FactUnavailableError);
    expect(await factCount(user.id)).toBe(0);
  });
});

describe("simultaneous requests", () => {
  it("generates only one fact when several requests arrive at once", async () => {
    const user = await createUser("a@test.com");

    // Slow generator: keeps the first request busy while the others queue
    // up behind the advisory lock. Real clock, because the requests really
    // do overlap in time.
    const slowGenerate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return "A fun fact";
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getFact(user.id, "Inception", slowGenerate)),
    );

    expect(slowGenerate).toHaveBeenCalledTimes(1);
    expect(await factCount(user.id)).toBe(1);
    expect(new Set(results.map((r) => r.content)).size).toBe(1);
  });
});

describe("authorization between users", () => {
  it("never serves one user's cached fact to another user, even for the same movie", async () => {
    const alice = await createUser("alice@test.com");
    const bob = await createUser("bob@test.com");
    const clock = makeClock();

    await getFact(alice.id, "Inception", async () => "Alice's fact", clock.now);
    // Same movie, same moment: a shared cache would hand Bob Alice's fact.
    const bobResult = await getFact(bob.id, "Inception", async () => "Bob's fact", clock.now);

    expect(bobResult.content).toBe("Bob's fact");
    expect(await factCount(alice.id)).toBe(1);
    expect(await factCount(bob.id)).toBe(1);
  });

  it("does not use another user's fact as the failure fallback", async () => {
    const alice = await createUser("alice@test.com");
    const bob = await createUser("bob@test.com");
    const clock = makeClock();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await getFact(alice.id, "Inception", async () => "Alice's fact", clock.now);
    clock.advance(120_000);
    const failing = vi.fn().mockRejectedValue(new Error("OpenAI is down"));

    // Bob has no facts of his own, so he gets an error, not Alice's fact.
    await expect(
      getFact(bob.id, "Inception", failing, clock.now),
    ).rejects.toBeInstanceOf(FactUnavailableError);

    errorSpy.mockRestore();
  });
});
