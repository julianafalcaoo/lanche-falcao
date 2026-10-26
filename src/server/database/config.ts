import "server-only";

export function databaseOptions() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");
  if (process.env.VERCEL === "1") {
    // Nenhum endereço/senha é incluído no diagnóstico.
    try {
      const url = new URL(connectionString);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
          !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) throw new Error();
    } catch { throw new Error("Configure uma conexão PostgreSQL remota com TLS na Vercel."); }
  }
  const max = Number(process.env.DATABASE_POOL_MAX || (process.env.NODE_ENV === "production" ? "3" : "10"));
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("DATABASE_POOL_MAX deve estar entre 1 e 20.");
  return { connectionString, max, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, maxLifetimeSeconds: 300, allowExitOnIdle: true };
}
