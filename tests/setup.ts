import { afterAll } from "vitest";
import { db } from "@/lib/db";

// Safety net: these tests delete every row in the tables they use.
// Refuse to run unless the database name ends in "_test".
const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/").pathname;
if (!dbName.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests against "${dbName}". Use a database whose name ends in _test.`,
  );
}

afterAll(async () => {
  await db.$disconnect();
});
