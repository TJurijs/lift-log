import { loadEnv } from "vite";
import { validateEnvironmentBinding } from "./lib/environment-bindings.mjs";

const mode = process.argv[2];
if (!mode) {
  process.stderr.write("Usage: node scripts/validate-build-env.mjs <mode>\n");
  process.exit(1);
}

const environment = loadEnv(mode, process.cwd(), "VITE_");
// Keep the production persona guard visible at the CLI boundary as well as in the shared validator.
if (mode === "production" && environment.VITE_ENABLE_TEST_PERSONAS === "true") {
  process.stderr.write("Test personas must be disabled for production builds.\n");
  process.exit(1);
}
if (environment.VITE_ENABLE_TEST_PERSONAS === "true") {
  const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
  let parsed;
  try {
    parsed = new URL(environment.VITE_SUPABASE_URL);
  } catch {
    process.stderr.write("VITE_SUPABASE_URL must be a valid absolute URL.\n");
    process.exit(1);
  }
  if (mode === "localdev" && (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname))) {
    process.stderr.write("Local test personas require a loopback HTTP Supabase URL.\n");
    process.exit(1);
  }
  const hostedDevelopment = mode === "nonprod" && parsed.origin === "https://ofyeejyfroblunbspgve.supabase.co";
  const isolatedLocal = mode === "localdev" && parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname);
  if (!hostedDevelopment && !isolatedLocal) {
    process.stderr.write("Test personas may target only isolated local Supabase or the exact liftlog-dev project.\n");
    process.exit(1);
  }
}
try {
  validateEnvironmentBinding(mode, environment);
  process.stdout.write(`Validated exact ${mode} environment binding.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`Create .env.${mode} from .env.example and retry.\n`);
  process.exit(1);
}
