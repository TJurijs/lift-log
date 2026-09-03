import manifest from "../../test-population/manifest.json" with { type: "json" };

function personaForName(personaName) {
  const persona = manifest.personas.find(
    (candidate) => candidate.name.localeCompare(personaName, undefined, { sensitivity: "accent" }) === 0,
  );
  if (!persona) throw new Error(`Unknown disposable test persona: ${personaName}`);
  return persona;
}

function storageKeyForSupabaseUrl(supabaseUrl) {
  const hostname = new URL(supabaseUrl).hostname;
  return `sb-${hostname.split(".")[0]}-auth-token`;
}

/**
 * Creates a browser session for a seeded, loopback-only test persona without
 * rendering a test-account control in the product UI.
 */
export async function signInSeededPersona(
  page,
  { personaName, password, supabaseUrl, publishableKey, appUrl },
) {
  if (!password || !supabaseUrl || !publishableKey || !appUrl) {
    throw new Error("Seeded persona sign-in requires an app URL, password, and local Supabase bindings.");
  }

  const persona = personaForName(personaName);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const session = await page.evaluate(
    async ({ email, secret, apiUrl, apiKey }) => {
      const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password: secret }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.msg ?? payload?.message ?? "Seeded persona authentication failed.");
      return payload;
    },
    {
      email: persona.email,
      secret: password,
      apiUrl: supabaseUrl,
      apiKey: publishableKey,
    },
  );

  await page.evaluate(
    ({ storageKey, authenticatedSession }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(authenticatedSession));
    },
    {
      storageKey: storageKeyForSupabaseUrl(supabaseUrl),
      authenticatedSession: session,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
}
