import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("emails")
    .select("id, from_text, to_text, subject, sent_at, body_text, body_html, attachments")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Fant ikke e-post" }, { status: 404 });
  }

  return NextResponse.json({
    email: {
      id: data.id,
      from: data.from_text ?? null,
      to: data.to_text ?? null,
      date: data.sent_at ?? null,
      subject: data.subject ?? null,
      bodyText: data.body_text ?? null,
      bodyHtml: data.body_html ?? null,
      attachments: Array.isArray(data.attachments) ? data.attachments : data.attachments ?? null,
    },
  });
}
