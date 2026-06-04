import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin, getTempBucket } from "@/lib/supabaseAdmin";

const BodySchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1),
        size: z.number().int().nonnegative(),
        type: z.string().optional().default("application/octet-stream"),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const uploadId = crypto.randomUUID();

  const supabase = getSupabaseAdmin();
  const bucket = getTempBucket();

  const uploads: Array<{ name: string; storageKey: string; signedUrl: string; token: string }> = [];

  for (let i = 0; i < body.files.length; i += 1) {
    const f = body.files[i];
    const safeName = normalizeFilename(f.name) || `file-${i + 1}`;
    const storageKey = `tmp/${uploadId}/${i.toString().padStart(5, "0")}-${safeName}`;

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(storageKey);
    if (error || !data?.signedUrl || !data?.token) {
      return NextResponse.json(
        { error: error?.message ?? "Kunne ikke lage signert opplastings-URL" },
        { status: 500 },
      );
    }

    uploads.push({
      name: f.name,
      storageKey,
      signedUrl: data.signedUrl,
      token: data.token,
    });
  }

  const { error: insertError } = await supabase
    .from("uploads")
    .insert({ id: uploadId, expected_total: body.files.length, processed: 0, errors: 0, status: "pending" });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ uploadId, uploads });
}

function normalizeFilename(name: string) {
  const base = name.split(/[/\\\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);
  return cleaned;
}
