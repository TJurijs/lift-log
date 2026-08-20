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

for (const key of ["VITE_SITE_URL", "VITE_SUPABASE_URL"]) {
  let parsed;
  try {
    parsed = new URL(environment[key]);
  } catch {
    process.stderr.write(`${key} must be a valid absolute URL.\n`);
    process.exit(1);
  }
  if (parsed.protocol !== "https:") {
    process.stderr.write(`${key} must use HTTPS for a hosted build.\n`);
    process.exit(1);
  }
}
