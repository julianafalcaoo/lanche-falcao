import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // A aplicação usa DATABASE_URL (pooler). A CLI pode usar uma conexão direta separada.
  datasource: { url: process.env.DIRECT_URL?.trim() || env("DATABASE_URL") },
});
