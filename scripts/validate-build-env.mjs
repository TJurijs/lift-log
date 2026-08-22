import { loadEnv } from "vite";

const mode = process.argv[2];
if (!mode) {
  process.stderr.write("Usage: node scripts/validate-build-env.mjs <mode>\n");
  process.exit(1);
}

const environment = loadEnv(mode, process.cwd(), "VITE_");
const required = ["VITE_SITE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const missing = required.filter((key) => !environment[key]?.trim());

if (missing.length > 0) {
  process.stderr.write(`Missing ${mode} environment configuration: ${missing.join(", ")}\n`);
  process.stderr.write(`Create .env.${mode} from .env.example and retry.\n`);
  process.exit(1);
}

if (mode === "production" && environment.VITE_ENABLE_TEST_PERSONAS === "true") {
  process.stderr.write("Test personas must be disabled for production builds.\n");
  process.exit(1);
}

const parsedUrls = new Map();
for (const key of ["VITE_SITE_URL", "VITE_SUPABASE_URL"]) {
  let parsed;
  try {
    parsed = new URL(environment[key]);
  } catch {
    process.stderr.write(`${key} must be a valid absolute URL.\n`);
    process.exit(1);
  }
  parsedUrls.set(key, parsed);
}

const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
if (mode === "localdev") {
  for (const [key, parsed] of parsedUrls) {
    if (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname)) {
      process.stderr.write(`${key} must be a loopback HTTP URL in localdev mode.\n`);
      process.exit(1);
    }
  }
} else {
  for (const [key, parsed] of parsedUrls) {
    if (parsed.protocol !== "https:") {
      process.stderr.write(`${key} must use HTTPS for a hosted build.\n`);
      process.exit(1);
    }
  }
}

if (environment.VITE_ENABLE_TEST_PERSONAS === "true") {
  const supabaseUrl = parsedUrls.get("VITE_SUPABASE_URL");
  const hostedDevelopment = mode === "nonprod" && supabaseUrl.hostname === "ofyeejyfroblunbspgve.supabase.co";
  const isolatedLocal = mode === "localdev" && supabaseUrl.protocol === "http:" && loopbackHosts.has(supabaseUrl.hostname);
  if (!hostedDevelopment && !isolatedLocal) {
    process.stderr.write("Test personas may target only isolated local Supabase or the exact liftlog-dev project.\n");
    process.exit(1);
  }
}
