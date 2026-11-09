import { vi } from "vitest";
import { db } from "@/lib/db";

// Start every test from an empty database.
// Deleting users also removes their accounts and sessions (cascade).
export async function resetDb() {
  await db.fact.deleteMany();
  await db.user.deleteMany();
}

export function createUser(email: string, favoriteMovie: string | null = "Inception") {
  return db.user.create({
    data: { email, name: email.split("@")[0], favoriteMovie },
  });
}

// Fake OpenAI: counts how often it's called and returns a different fact each time.
export function makeGenerator() {
  let calls = 0;
  return vi.fn(async (movieTitle: string) => `Fact #${++calls} about ${movieTitle}`);
}

// Fake clock: we move time forward by hand instead of waiting 60 real seconds.
export function makeClock(start = new Date("2026-01-01T12:00:00Z")) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}
