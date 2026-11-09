import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateFavoriteMovie } from "@/app/dashboard/actions";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createUser, resetDb } from "./helpers";

// Same idea as the route tests: fake the session, and stub Next.js's
// cache refresh because there is no running Next.js server here.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

function signInAs(userId: string | null) {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

const movieOf = async (userId: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: userId } })).favoriteMovie;

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});

describe("updateFavoriteMovie", () => {
  it("saves the trimmed title for the signed-in user", async () => {
    const user = await createUser("a@test.com", "Inception");
    signInAs(user.id);

    const result = await updateFavoriteMovie("  The Matrix  ");

    expect(result).toEqual({});
    expect(await movieOf(user.id)).toBe("The Matrix");
  });

  it("rejects empty, whitespace-only and too-long titles and keeps the old movie", async () => {
    const user = await createUser("a@test.com", "Inception");
    signInAs(user.id);

    for (const bad of ["", "   ", "x".repeat(101)]) {
      const result = await updateFavoriteMovie(bad);
      expect(result.error).toBeTruthy();
    }
    expect(await movieOf(user.id)).toBe("Inception");

    // Boundary: exactly 100 characters is allowed.
    expect(await updateFavoriteMovie("x".repeat(100))).toEqual({});
  });

  it("changes nothing when nobody is signed in", async () => {
    const user = await createUser("a@test.com", "Inception");
    signInAs(null);

    const result = await updateFavoriteMovie("The Matrix");

    expect(result.error).toBeTruthy();
    expect(await movieOf(user.id)).toBe("Inception");
  });

  it("only changes the signed-in user's own row", async () => {
    const alice = await createUser("alice@test.com", "Inception");
    const bob = await createUser("bob@test.com", "Jaws");
    signInAs(alice.id);

    await updateFavoriteMovie("The Matrix");

    expect(await movieOf(alice.id)).toBe("The Matrix");
    expect(await movieOf(bob.id)).toBe("Jaws"); // untouched
  });
});
