/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_ENABLE_TEST_PERSONAS?: string;
  readonly VITE_RELEASE_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __LIFTLOG_RELEASE_SHA__: string;

declare module "virtual:liftlog-test-personas" {
  const personas: Array<{
    key: string;
    name: string;
    email: string;
    scenario: string;
  }>;
  export default personas;
}
