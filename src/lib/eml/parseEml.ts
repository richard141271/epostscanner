import { simpleParser } from "mailparser";
import type { AddressObject } from "mailparser";
import { Writable } from "node:stream";

import { uuidFromHash } from "@/lib/uuidFromHash";

export type ParsedEmail = {
  id: string;
  messageId: string | null;
  from: string | null;
  to: string[] | null;
  cc: string[] | null;
  bcc: string[] | null;
  subject: string | null;
  date: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{ filename: string; size: number; mimeType: string }> | null;
};

export async function parseEmlStream(
  stream: NodeJS.ReadableStream,
  fallbackKeyForId: string,
): Promise<ParsedEmail> {
  const mail = (await simpleParser(
    stream as unknown as never,
    {
      streamAttachments: true,
      skipTextToHtml: true,
      skipHtmlToText: true,
    } as unknown as never,
  )) as unknown as {
    attachments?: Array<{
      filename?: string;
      contentType?: string;
      size?: number;
      content?: unknown;
    }>;
    subject?: string;
    messageId?: string;
    date?: Date;
    from?: AddressObject | string;
    to?: AddressObject | string;
    cc?: AddressObject | string;
    bcc?: AddressObject | string;
    text?: string;
    html?: string | Buffer;
  };

  const attachments =
    mail.attachments && mail.attachments.length
      ? await collectAttachmentMetadata({ attachments: mail.attachments })
      : null;

  const subject = mail.subject ?? null;
  const messageId = mail.messageId ?? null;
  const date = mail.date ? mail.date.toISOString() : null;
  const from = normalizeSingleAddress(mail.from) ?? null;
  const to = normalizeAddressList(mail.to);
  const cc = normalizeAddressList(mail.cc);
  const bcc = normalizeAddressList(mail.bcc);

  const bodyText = normalizeBodyText(mail.text ?? null, mail.html ?? null);
  const bodyHtml = typeof mail.html === "string" ? mail.html : mail.html?.toString("utf8") ?? null;

  const idInput = [messageId ?? "", date ?? "", from ?? "", subject ?? "", fallbackKeyForId].join("|");
  const id = uuidFromHash(idInput);

  return {
    id,
    messageId,
    from,
    to,
    cc,
    bcc,
    subject,
    date,
    bodyText,
    bodyHtml,
    attachments,
  };
}

function normalizeSingleAddress(addr: AddressObject | string | undefined | null) {
  if (!addr) return null;
  if (typeof addr === "string") return addr;
  return addr.text ?? null;
}

function normalizeAddressList(addr: AddressObject | string | undefined | null) {
  if (!addr) return null;
  if (typeof addr === "string") return [addr];
  const list = addr.value
    ?.map((v: { address?: string; name?: string }) => v.address || v.name)
    .filter(Boolean) as string[] | undefined;
  if (!list?.length) return addr.text ? [addr.text] : null;
  return list;
}

async function collectAttachmentMetadata(mail: {
  attachments: Array<{
    filename?: string;
    contentType?: string;
    size?: number;
    content?: unknown;
  }>;
}) {
  const metas: Array<{ filename: string; size: number; mimeType: string }> = [];

  for (const a of mail.attachments) {
    const filename = a.filename ?? "(uten filnavn)";
    const mimeType = a.contentType ?? "application/octet-stream";

    let size = typeof a.size === "number" ? a.size : 0;
    if (a.content && typeof (a.content as unknown as { pipe?: unknown }).pipe === "function") {
      const { size: drainedSize } = await drainToNull(a.content as unknown as NodeJS.ReadableStream);
      if (!size) size = drainedSize;
    }

    metas.push({ filename, size, mimeType });
  }

  return metas;
}

function drainToNull(stream: NodeJS.ReadableStream) {
  return new Promise<{ size: number }>((resolve, reject) => {
    let size = 0;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        size += chunk.length;
        cb();
      },
    });

    stream.on("error", reject);
    sink.on("error", reject);
    sink.on("finish", () => resolve({ size }));
    stream.pipe(sink);
  });
}

function normalizeBodyText(text: string | null, html: string | Buffer | null) {
  if (text && text.trim()) return text;
  if (!html) return null;
  const raw = typeof html === "string" ? html : html.toString("utf8");
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
}
