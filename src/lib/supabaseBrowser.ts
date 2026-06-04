import { createClient } from "@supabase/supabase-js";

export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL mangler");
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY mangler");
  return createClient(url, key);
}

export function getTempBucketBrowser() {
  return process.env.NEXT_PUBLIC_SUPABASE_TEMP_BUCKET ?? "email-temp";
}
