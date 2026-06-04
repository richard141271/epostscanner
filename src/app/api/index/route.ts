import { NextResponse } from "next/server";
import { z } from "zod";
import { Readable } from "node:stream";
import unzipper from "unzipper";

import { getSupabaseAdmin, getTempBucket } from "@/lib/supabaseAdmin";
import { parseEmlStream } from "@/lib/eml/parseEml";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  uploadId: z.string().uuid(),
});

export async function POST(req: Request) {
  const startedAt = Date.now();
  const body = BodySchema.parse(await req.json());

  const supabase = getSupabaseAdmin();
  const bucket = getTempBucket();

  const { data: uploadRow, error: uploadErr } = await supabase
    .from("uploads")
    .select("id, expected_total, processed, errors, status")
    .eq("id", body.uploadId)
    .maybeSingle();

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }
  if (!uploadRow) {
    return NextResponse.json({ error: "Ukjent uploadId" }, { status: 404 });
  }

  const { data: objects, error: listErr } = await supabase.storage
    .from(bucket)
    .list(`tmp/${body.uploadId}`, { limit: 200, sortBy: { column: "name", order: "asc" } });

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const candidates = (objects ?? [])
    .filter((o) => o.name && !o.name.endsWith("/"))
    .map((o) => `tmp/${body.uploadId}/${o.name}`);

  let batchProcessed = 0;
  let errors = uploadRow.errors ?? 0;
  let processed = uploadRow.processed ?? 0;

  const timeBudgetMs = 18_000;
  const maxEmailsPerCall = 25;

  for (const storageKey of candidates) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    if (batchProcessed >= maxEmailsPerCall) break;

    const lower = storageKey.toLowerCase();
    if (lower.endsWith(".zip")) {
      const result = await processZipObject({
        supabase,
        bucket,
        uploadId: body.uploadId,
        storageKey,
        startedAt,
        timeBudgetMs,
        maxEmailsLeft: maxEmailsPerCall - batchProcessed,
      });

      batchProcessed += result.processed;
      processed += result.processed;
      errors += result.errors;
      continue;
    }

    if (!lower.endsWith(".eml")) {
      await supabase.storage.from(bucket).remove([storageKey]);
      continue;
    }

    const res = await processSingleEml({ supabase, bucket, storageKey });
    batchProcessed += 1;
    processed += 1;
    if (!res.ok) errors += 1;
  }

  const { data: remaining } = await supabase.storage
    .from(bucket)
    .list(`tmp/${body.uploadId}`, { limit: 1 });
  const done = !remaining?.length;

  const { error: updateErr } = await supabase
    .from("uploads")
    .update({ processed, errors, status: done ? "done" : "processing" })
    .eq("id", body.uploadId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    uploadId: body.uploadId,
    processed,
    total: uploadRow.expected_total,
    batchProcessed,
    done,
    errors,
  });
}

async function processSingleEml({
  supabase,
  bucket,
  storageKey,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  bucket: string;
  storageKey: string;
}) {
  try {
    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storageKey, 60);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Kunne ikke lage download-URL");

    const downloadRes = await fetch(signed.signedUrl);
    if (!downloadRes.ok || !downloadRes.body) throw new Error(`Nedlasting feilet: ${downloadRes.status}`);

    const stream = Readable.fromWeb(downloadRes.body as unknown as never);
    const parsed = await parseEmlStream(stream, storageKey);

    const { error: upsertErr } = await supabase.from("emails").upsert(
      {
        id: parsed.id,
        message_id: parsed.messageId,
        from_text: parsed.from,
        to_text: parsed.to,
        cc_text: parsed.cc,
        bcc_text: parsed.bcc,
        subject: parsed.subject,
        sent_at: parsed.date,
        body_text: parsed.bodyText,
        body_html: parsed.bodyHtml,
        attachments: parsed.attachments,
      },
      { onConflict: "id" },
    );

    if (upsertErr) throw new Error(upsertErr.message);
    await supabase.storage.from(bucket).remove([storageKey]);
    return { ok: true };
  } catch {
    await supabase.storage.from(bucket).remove([storageKey]);
    return { ok: false };
  }
}

async function processZipObject({
  supabase,
  bucket,
  uploadId,
  storageKey,
  startedAt,
  timeBudgetMs,
  maxEmailsLeft,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  bucket: string;
  uploadId: string;
  storageKey: string;
  startedAt: number;
  timeBudgetMs: number;
  maxEmailsLeft: number;
}) {
  const { data: progressRow, error: progressErr } = await supabase
    .from("zip_progress")
    .select("processed_entries")
    .eq("upload_id", uploadId)
    .eq("storage_key", storageKey)
    .maybeSingle();

  if (progressErr) return { processed: 0, errors: 1 };
  const alreadyProcessed = progressRow?.processed_entries ?? 0;

  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storageKey, 60);
  if (signErr || !signed?.signedUrl) return { processed: 0, errors: 1 };

  const downloadRes = await fetch(signed.signedUrl);
  if (!downloadRes.ok || !downloadRes.body) return { processed: 0, errors: 1 };

  const zipStream = Readable.fromWeb(downloadRes.body as unknown as never);
  const parser = unzipper.Parse({ forceStream: true });
  zipStream.pipe(parser);

  let seenEntries = 0;
  let processed = 0;
  let errors = 0;
  let stoppedEarly = false;

  const stop = () => {
    zipStream.destroy();
    parser.destroy();
  };

  try {
    for await (const entry of parser) {
      if (Date.now() - startedAt > timeBudgetMs) {
        entry.autodrain();
        stop();
        stoppedEarly = true;
        break;
      }
      if (processed >= maxEmailsLeft) {
        entry.autodrain();
        stop();
        stoppedEarly = true;
        break;
      }

      seenEntries += 1;
      if (seenEntries <= alreadyProcessed) {
        entry.autodrain();
        continue;
      }

      const path = (entry as unknown as { path?: string }).path ?? "";
      if (!path.toLowerCase().endsWith(".eml")) {
        entry.autodrain();
        continue;
      }

      try {
        const parsed = await parseEmlStream(entry as unknown as NodeJS.ReadableStream, `${storageKey}:${path}`);

        const { error: upsertErr } = await supabase.from("emails").upsert(
          {
            id: parsed.id,
            message_id: parsed.messageId,
            from_text: parsed.from,
            to_text: parsed.to,
            cc_text: parsed.cc,
            bcc_text: parsed.bcc,
            subject: parsed.subject,
            sent_at: parsed.date,
            body_text: parsed.bodyText,
            body_html: parsed.bodyHtml,
            attachments: parsed.attachments,
          },
          { onConflict: "id" },
        );

        if (upsertErr) throw new Error(upsertErr.message);
      } catch {
        errors += 1;
      } finally {
        processed += 1;
      }
    }
  } catch {
    stop();
  }

  const newProcessedEntries = Math.max(alreadyProcessed, seenEntries);
  const { error: upsertProgressErr } = await supabase
    .from("zip_progress")
    .upsert({ upload_id: uploadId, storage_key: storageKey, processed_entries: newProcessedEntries });

  if (upsertProgressErr) errors += 1;

  if (!stoppedEarly) {
    await supabase.storage.from(bucket).remove([storageKey]);
    await supabase.from("zip_progress").delete().eq("upload_id", uploadId).eq("storage_key", storageKey);
  }

  return { processed, errors };
}
