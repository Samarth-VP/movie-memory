import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateFavoriteMovie } from "@/app/dashboard/actions";
import { saveFavoriteMovie } from "@/app/onboarding/actions";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createUser, resetDb } from "./helpers";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});

// A session can outlive its user row. Updating that row then fails with a
// real database error, which lets us test the failure path without mocking Prisma.
async function signedInAsDeletedUser() {
  const user = await createUser("a@test.com", "Inception");
  mockAuth.mockResolvedValue({ user: { id: user.id } });
  await db.user.delete({ where: { id: user.id } });
}

describe("database failures in actions", () => {
  it("updateFavoriteMovie returns a friendly error instead of throwing", async () => {
    await signedInAsDeletedUser();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await updateFavoriteMovie("The Matrix");

    expect(result.error).toMatch(/couldn't save/i);
    errorSpy.mockRestore();
  });

  it("saveFavoriteMovie returns a friendly error and keeps the typed text", async () => {
    await signedInAsDeletedUser();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const formData = new FormData();
    formData.set("movie", "The Matrix");

    const result = await saveFavoriteMovie({}, formData);

    expect(result.error).toMatch(/couldn't save/i);
    expect(result.value).toBe("The Matrix");
    errorSpy.mockRestore();
  });
});
