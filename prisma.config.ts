import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma CLI reads the connection URL here, rather than in the schema.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
