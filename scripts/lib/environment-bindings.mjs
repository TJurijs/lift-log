export const ENVIRONMENT_BINDINGS = Object.freeze({
  nonprod: Object.freeze({ siteOrigin: "https://dev.liftlog.cc", supabaseOrigin: "https://ofyeejyfroblunbspgve.supabase.co" }),
  production: Object.freeze({ siteOrigin: "https://app.liftlog.cc", supabaseOrigin: "https://awdgjgziyrqdkybmlime.supabase.co" }),
});

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function rootUrl(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid absolute URL.`); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw new Error(`${name} must be an origin URL without credentials, path, query, or fragment.`);
  }
  return parsed;
}

function keyRole(key) {
  if (/sb_secret_|service[_-]?role/iu.test(key)) return "service_role";
  const pieces = key.split(".");
  if (pieces.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(pieces[1], "base64url").toString("utf8"));
    return json.role ?? null;
  } catch { return null; }
}

export function validateEnvironmentBinding(mode, environment) {
  if (!new Set(["localdev", "nonprod", "production"]).has(mode)) throw new Error(`Unsupported build mode: ${mode}.`);
  for (const key of ["VITE_SITE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
    if (!environment[key]?.trim()) throw new Error(`Missing ${mode} environment configuration: ${key}.`);
  }
  const site = rootUrl(environment.VITE_SITE_URL, "VITE_SITE_URL");
  const supabase = rootUrl(environment.VITE_SUPABASE_URL, "VITE_SUPABASE_URL");
  const publicKeyRole = keyRole(environment.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (publicKeyRole === "service_role") {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must never contain a secret or service-role credential.");
  }
  if (!environment.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_") && publicKeyRole !== "anon") {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable or legacy anon key.");
  }
  if (mode === "localdev") {
    for (const [name, parsed] of [["VITE_SITE_URL", site], ["VITE_SUPABASE_URL", supabase]]) {
      if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error(`${name} must be a loopback HTTP origin in localdev mode.`);
    }
    if (site.origin === supabase.origin) throw new Error("Local app and Supabase origins must use distinct ports.");
  } else {
    const binding = ENVIRONMENT_BINDINGS[mode];
    if (site.origin !== binding.siteOrigin) throw new Error(`VITE_SITE_URL must equal ${binding.siteOrigin} in ${mode} mode.`);
    if (supabase.origin !== binding.supabaseOrigin) throw new Error(`VITE_SUPABASE_URL must equal ${binding.supabaseOrigin} in ${mode} mode.`);
  }
  if (mode === "production" && environment.VITE_ENABLE_TEST_PERSONAS === "true") throw new Error("Test personas must be disabled for production builds.");
  if (environment.VITE_RELEASE_SHA && !/^(?:[0-9a-f]{7,40}|local|development|test)$/u.test(environment.VITE_RELEASE_SHA)) {
    throw new Error("VITE_RELEASE_SHA must be a 7-40 character lowercase Git SHA or an approved local marker.");
  }
  return { mode, siteOrigin: site.origin, supabaseOrigin: supabase.origin };
}
