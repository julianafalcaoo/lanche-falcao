import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const buildMarker = new URL(".next/.homologacao-local", rootUrl);
const project = "lanche-falcao-homologacao";
const role = "lanche_homologacao";
const database = "lanche_falcao_homologacao";
const host = "127.0.0.1";
const port = "5543";
const checkoutPort = "3106";
const databaseUrl = `postgresql://${role}@${host}:${port}/${database}`;
const composeArgs = ["compose", "--file", "compose.homologacao.yaml", "--env-file", ".env.homologacao.example", "--project-name", project];
const bridgeOptions = {
  "com.docker.network.bridge.enable_ip_masquerade": "false",
  "com.docker.network.bridge.enable_icc": "false",
};
const mercadoPago = ["MERCADO_PAGO_AMBIENTE", "MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_WEBHOOK_SECRET", "MERCADO_PAGO_CREDENTIAL_PAIR_SHA256"];
const otp = ["INFOBIP_API_BASE_URL", "INFOBIP_API_KEY", "INFOBIP_2FA_APPLICATION_ID", "INFOBIP_2FA_MESSAGE_ID", "INFOBIP_ALLOWED_PHONES", "OTP_RATE_LIMIT_SECRET"];

function readEnv(name) {
  try { return parse(readFileSync(new URL(name, rootUrl))); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Não foi possível ler ${name}.`);
  }
}

function run(program, args, { env, capture = false } = {}) {
  const result = spawnSync(program, args, { cwd: root, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`Comando local falhou (${program === process.execPath ? "Node" : program}).`);
  return result.stdout?.trim();
}

function docker(args, capture = false) {
  return run("docker", ["--context", "desktop-linux", ...args], { capture });
}

function checkCompose() {
  const endpoint = docker(["context", "inspect", "desktop-linux", "--format", "{{ .Endpoints.docker.Host }}"], true);
  if (endpoint !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("O contexto Docker não é o Docker Desktop Linux local previsto.");

  const config = JSON.parse(docker([...composeArgs, "config", "--format", "json"], true));
  const postgres = config.services?.postgres;
  const published = postgres?.ports?.[0];
  const volume = postgres?.volumes?.[0];
  const network = config.networks?.banco;
  if (config.name !== project || Object.keys(config.services ?? {}).length !== 1 ||
      postgres?.image !== "postgres:17" || postgres.environment.POSTGRES_DB !== database ||
      postgres.environment.POSTGRES_USER !== role || postgres.environment.POSTGRES_HOST_AUTH_METHOD !== "trust" ||
      postgres.ports.length !== 1 || published.host_ip !== host || String(published.published) !== port || published.target !== 5432 ||
      postgres.volumes.length !== 1 || volume.type !== "volume" || volume.source !== "postgres_homologacao" || volume.target !== "/var/lib/postgresql/data" ||
      config.volumes?.postgres_homologacao?.name !== `${project}_postgres_homologacao` || config.volumes.postgres_homologacao.external ||
      network?.driver !== "bridge" || network.external || network.enable_ipv6 ||
      !Object.entries(bridgeOptions).every(([key, value]) => network.driver_opts?.[key] === value) ||
      Object.keys(postgres.networks ?? {}).join() !== "banco") {
    throw new Error("O Compose não corresponde ao banco, à porta, ao volume e à rede isolados.");
  }
}

async function checkDatabase() {
  const id = docker([...composeArgs, "ps", "-q", "postgres"], true);
  if (!id) throw new Error("O banco dedicado está parado. Execute up primeiro.");
  const [container] = JSON.parse(docker(["inspect", id], true));
  const mapping = container.NetworkSettings?.Ports?.["5432/tcp"];
  const networks = Object.keys(container.NetworkSettings?.Networks ?? {});
  const [network] = JSON.parse(docker(["network", "inspect", `${project}_banco`], true));
  if (container.Config?.Labels?.["com.docker.compose.project"] !== project ||
      mapping?.length !== 1 || mapping[0].HostIp !== host || mapping[0].HostPort !== port ||
      !container.Mounts?.some(mount => mount.Type === "volume" && mount.Name === `${project}_postgres_homologacao` && mount.Destination === "/var/lib/postgresql/data") ||
      networks.join() !== `${project}_banco` || network.Driver !== "bridge" || network.EnableIPv6 ||
      !Object.entries(bridgeOptions).every(([key, value]) => network.Options?.[key] === value) ||
      Object.keys(network.Containers ?? {}).join() !== container.Id) {
    throw new Error("A publicação, o volume ou a rede do contêiner não correspondem à homologação.");
  }

  const sql = "SELECT current_database(), current_user, current_setting('server_version_num'), system_identifier::text FROM pg_catalog.pg_control_system()";
  const internal = docker([...composeArgs, "exec", "-T", "postgres", "psql", "-X", "-qAt", "-U", role, "-d", database, "-c", sql], true);
  // Usa o mesmo driver PostgreSQL do adaptador Prisma, com destino e usuário explícitos.
  const { Client } = createRequire(import.meta.resolve("@prisma/adapter-pg"))("pg");
  const client = new Client({ host, port: Number(port), database, user: role, ssl: false, options: "", connectionTimeoutMillis: 4000 });
  try {
    await client.connect();
    const result = await client.query({ text: sql, rowMode: "array" });
    const row = result.rows[0];
    if (!row || row[0] !== database || row[1] !== role || Math.floor(Number(row[2]) / 10000) !== 17 || row.join("|") !== internal) {
      throw new Error("Identidade divergente.");
    }
  } catch {
    throw new Error("A conexão TCP não pôde ser vinculada ao mesmo PostgreSQL do contêiner. Operação interrompida.");
  } finally { await client.end(); }
  console.log(`Banco confirmado no Docker local e por TCP em ${host}:${port}/${database} (PostgreSQL 17).`);
}

function childEnv(settings, services) {
  const env = {};
  // Oculta os valores dos arquivos que Next.js e Prisma carregam automaticamente.
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"]) {
    for (const key of Object.keys(readEnv(file))) env[key] = "";
  }
  for (const key of ["Path", "PATHEXT", "SystemRoot", "SystemDrive", "windir", "ComSpec", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const key of [...mercadoPago, ...otp, "CRON_SECRET", "MERCADO_PAGO_RECONCILIACAO_SECRET", "MERCADO_PAGO_PRODUCTION_CHARGES_ENABLED", "VERCEL", "VERCEL_ENV"]) env[key] = "";
  Object.assign(env, {
    DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, DATABASE_POOL_MAX: "3",
    MERCADO_PAGO_AMBIENTE: "test", NEXT_TELEMETRY_DISABLED: "1", CHECKPOINT_DISABLE: "1",
    HOMOLOGACAO_CHECKOUT_ORIGIN: `http://${host}:${checkoutPort}`,
    NODE_OPTIONS: "", NODE_ENV: "production",
  });
  if (services) {
    if (settings.MERCADO_PAGO_AMBIENTE !== "test" || !mercadoPago.every(key => settings[key]?.trim())) {
      throw new Error("O perfil de serviços exige a configuração completa do Mercado Pago de teste no arquivo dedicado.");
    }
    const pair = ["test", settings.MERCADO_PAGO_ACCESS_TOKEN.trim(), settings.MERCADO_PAGO_PUBLIC_KEY.trim()];
    const digest = createHash("sha256").update(JSON.stringify(pair)).digest("hex");
    if (settings.MERCADO_PAGO_CREDENTIAL_PAIR_SHA256.trim().toLowerCase() !== digest) {
      throw new Error("O par do Mercado Pago não corresponde à impressão digital aprovada para teste.");
    }
    if (otp.some(key => settings[key]?.trim()) && (!otp.every(key => settings[key]?.trim()) || settings.OTP_RATE_LIMIT_SECRET.trim().length < 32)) {
      throw new Error("Para ativar OTP, configure todos os campos do perfil, incluindo a lista de números autorizados.");
    }
    for (const key of [...mercadoPago, ...otp]) env[key] = settings[key]?.trim() ?? "";
  } else {
    Object.assign(env, { NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: "localhost,127.0.0.1" });
  }
  return env;
}

async function main() {
  const [action, flag, ...rest] = process.argv.slice(2);
  if (process.versions.node.split(".")[0] !== "24") throw new Error("Use Node.js 24.x neste terminal.");
  const actions = ["up", "check", "migrate", "build", "start", "test"];
  const services = action === "start" && flag === "--servicos-de-teste";
  if (!actions.includes(action) || rest.length || (flag && !services)) {
    throw new Error("Use: node scripts/homologacao.mjs <up|check|migrate|build|start|test>. Opção de start: --servicos-de-teste.");
  }
  const settings = readEnv(".env.homologacao.local");
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    if ((process.env[name] && process.env[name] !== databaseUrl) || (settings[name] !== undefined && settings[name] !== databaseUrl)) {
      throw new Error(`${name} não corresponde ao banco dedicado. Remova a variável herdada no terminal e confira o arquivo de homologação.`);
    }
  }
  const env = childEnv(settings, services);
  const node = (...args) => run(process.execPath, args, { env });
  if (action === "test") {
    for (const suite of ["otp", "payment-production", "webhook", "deploy"]) {
      node("--conditions=react-server", "--test", "--test-isolation=none", `tests/${suite}.test.mjs`);
    }
    return;
  }
  checkCompose();
  if (action === "up") docker([...composeArgs, "up", "-d", "--wait", "--pull", "never", "postgres"]);
  await checkDatabase();
  const prisma = (...args) => node("node_modules/prisma/build/index.js", ...args);
  if (action === "migrate") {
    prisma("migrate", "deploy");
    prisma("migrate", "status");
    prisma("migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code");
  }
  if (action === "build") {
    prisma("migrate", "status");
    prisma("generate");
    node("node_modules/next/dist/bin/next", "build");
    writeFileSync(buildMarker, "Build local de homologação.\n");
  }
  if (action === "start") {
    if (!existsSync(buildMarker)) throw new Error("Execute build pelo launcher de homologação antes de iniciar.");
    prisma("migrate", "status");
    node("node_modules/next/dist/bin/next", "start", "--hostname", host, "--port", checkoutPort);
  }
}

try { await main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
