import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let browserClient: SupabaseClient | null = null;

export interface AppViewer {
  id: string;
  email: string;
  name: string;
  initials: string;
  avatarUrl?: string;
  isDemo: boolean;
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey || typeof window === "undefined") return null;
  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}

export function viewerFromSupabaseUser(user: User): AppViewer {
  const email = user.email ?? "Signed-in athlete";
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  const name = typeof metadataName === "string" && metadataName.trim() ? metadataName.trim() : email.split("@")[0];
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "LL";
  const avatarUrl = typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined;

  return { id: user.id, email, name, initials, avatarUrl, isDemo: false };
}

export const demoViewer: AppViewer = {
  id: "demo-alex",
  email: "alex@example.com",
  name: "Alex Morgan",
  initials: "AM",
  isDemo: true,
};
