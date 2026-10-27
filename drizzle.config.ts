import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  ...(url ? { dbCredentials: { url } } : { driver: "pglite", dbCredentials: { url: ".data/blockc" } }),
});
