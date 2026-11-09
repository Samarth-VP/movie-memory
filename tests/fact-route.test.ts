import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/fact/route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { generateFact } from "@/lib/openai";
import { createUser, resetDb } from "./helpers";

// The real auth module needs Google credentials and Next.js internals, and
// the real OpenAI client needs an API key. Tests swap both for fakes.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/openai", () => ({ generateFact: vi.fn() }));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGenerate = vi.mocked(generateFact);

// Pretend a user is signed in (or nobody is, with null).
function signInAs(userId: string | null) {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
  mockGenerate.mockReset();
});

describe("GET /api/fact", () => {
  it("returns 401 when nobody is signed in", async () => {
    signInAs(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(await db.fact.count()).toBe(0);
  });

  it("only ever returns the signed-in user's own facts, even for the same movie", async () => {
    const alice = await createUser("alice@test.com", "Inception");
    const bob = await createUser("bob@test.com", "Inception");
    // Alice already has a fresh fact. createdAt is set explicitly so the
    // test doesn't depend on the database clock matching this machine's.
    await db.fact.create({
      data: {
        userId: alice.id,
        movieTitle: "Inception",
        content: "Alice's private fact",
        createdAt: new Date(),
      },
    });
    mockGenerate.mockResolvedValue("Bob's fact");

    // Bob asks: he must not see Alice's fact.
    signInAs(bob.id);
    const bobRes = await GET();
    const bobBody = await bobRes.json();
    expect(bobRes.status).toBe(200);
    expect(bobBody.content).toBe("Bob's fact");
    expect(JSON.stringify(bobBody)).not.toContain("Alice");

    // Alice asks: she gets her own cached fact, with no new generation.
    signInAs(alice.id);
    const aliceBody = await (await GET()).json();
    expect(aliceBody.content).toBe("Alice's private fact");
    expect(mockGenerate).toHaveBeenCalledTimes(1); // only Bob's request
  });

  it("returns a friendly 502 and leaks no internals when OpenAI fails and nothing is cached", async () => {
    const user = await createUser("a@test.com", "Inception");
    signInAs(user.id);
    mockGenerate.mockRejectedValue(new Error("internal detail sk-secret-123"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/couldn't generate a fact/i);
    expect(JSON.stringify(body)).not.toContain("sk-secret-123");

    errorSpy.mockRestore();
  });
});
