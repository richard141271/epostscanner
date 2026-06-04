import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL mangler");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY mangler");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getTempBucket() {
  return process.env.SUPABASE_TEMP_BUCKET ?? "email-temp";
}
