import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = url.searchParams.get("q") ?? "";
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const offset = clampInt(url.searchParams.get("offset"), 0, 100000, 0);

  const { q, from, to, subject, after, before } = parseQuery(qRaw);

  if (!q.trim()) {
    return NextResponse.json({ hits: [] });
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("search_emails", {
    q,
    p_from: from,
    p_to: to,
    p_subject: subject,
    p_after: after,
    p_before: before,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    hits: (data ?? []).map((r: any) => ({
      id: r.id,
      from: r.from_text ?? null,
      subject: r.subject ?? null,
      date: r.sent_at ?? null,
      snippet: r.snippet ?? null,
    })),
  });
}

function parseQuery(input: string) {
  const tokens = input.split(/\s+/g).filter(Boolean);
  const kept: string[] = [];

  let from: string | null = null;
  let to: string | null = null;
  let subject: string | null = null;
  let after: string | null = null;
  let before: string | null = null;

  for (const t of tokens) {
    const m = /^([a-z]+):(.+)$/.exec(t);
    if (!m) {
      kept.push(t);
      continue;
    }
    const key = m[1];
    const value = m[2];
    if (key === "from") from = value;
    else if (key === "to") to = value;
    else if (key === "subject") subject = value;
    else if (key === "after") after = normalizeDate(value);
    else if (key === "before") before = normalizeDate(value);
    else kept.push(t);
  }

  return {
    q: kept.join(" "),
    from,
    to,
    subject,
    after,
    before,
  };
}

function normalizeDate(value: string) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;
  return iso;
}

function clampInt(v: string | null, min: number, max: number, fallback: number) {
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
