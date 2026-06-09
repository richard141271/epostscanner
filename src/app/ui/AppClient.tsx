"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DOMPurify from "isomorphic-dompurify";

import { UploadDropzone } from "./UploadDropzone";
import type { EmailRecord, SearchHit, UploadInitResponse } from "@/lib/types";

type IndexState =
  | { kind: "idle" }
  | {
      kind: "uploading";
      uploadId: string;
      uploaded: number;
      total: number;
      bytesUploaded: number;
      bytesTotal: number;
      currentFile: string | null;
    }
  | {
      kind: "indexing";
      uploadId: string;
      processed: number;
      total: number | null;
      lastBatch: number;
      done: boolean;
      errors: number;
    }
  | { kind: "ready" };

export default function AppClient() {
  const [indexState, setIndexState] = useState<IndexState>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [emailCountError, setEmailCountError] = useState<string | null>(null);

  const canSearch = useMemo(() => query.trim().length > 0, [query]);

  const refreshEmailCount = useCallback(async () => {
    try {
      setEmailCountError(null);
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { emailCount: number };
      setEmailCount(json.emailCount ?? 0);
    } catch (e) {
      setEmailCountError(e instanceof Error ? e.message : "Kunne ikke hente antall e-poster");
      setEmailCount(null);
    }
  }, []);

  const startUpload = useCallback(async (files: File[]) => {
    setHits([]);
    setSelectedEmailId(null);
    setSelectedEmail(null);
    setSearchError(null);
    setEmailError(null);

    const initRes = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });

    if (!initRes.ok) {
      throw new Error(await initRes.text());
    }

    const initJson = (await initRes.json()) as UploadInitResponse;
    localStorage.setItem("epostscanner:lastUploadId", initJson.uploadId);
    const bytesTotal = files.reduce((sum, f) => sum + (f.size || 0), 0);

    setIndexState({
      kind: "uploading",
      uploadId: initJson.uploadId,
      uploaded: 0,
      total: files.length,
      bytesUploaded: 0,
      bytesTotal,
      currentFile: null,
    });

    let completedBytes = 0;

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const upload = initJson.uploads[i];

      setIndexState((s) =>
        s.kind === "uploading" ? { ...s, currentFile: file.name } : s,
      );

      await uploadFileWithProgress(
        upload.signedUrl,
        file,
        file.type || "application/octet-stream",
        (loaded) => {
          setIndexState((s) =>
            s.kind === "uploading"
              ? {
                  ...s,
                  bytesUploaded: Math.min(s.bytesTotal, completedBytes + loaded),
                }
              : s,
          );
        },
      );

      completedBytes += file.size || 0;

      setIndexState((s) =>
        s.kind === "uploading"
          ? {
              ...s,
              uploaded: Math.min(s.uploaded + 1, s.total),
              bytesUploaded: Math.min(s.bytesTotal, completedBytes),
              currentFile: null,
            }
          : s,
      );
    }

    setIndexState((s) =>
      s.kind === "uploading" ? { kind: "indexing", uploadId: s.uploadId, processed: 0, total: null, lastBatch: 0, done: false, errors: 0 } : s,
    );
  }, []);

  const runIndexBatch = useCallback(async (uploadId: string) => {
    const res = await fetch("/api/index", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const json = (await res.json()) as {
      uploadId: string;
      processed: number;
      total: number | null;
      batchProcessed: number;
      done: boolean;
      errors: number;
    };

    setIndexState({
      kind: json.done ? "ready" : "indexing",
      uploadId: json.uploadId,
      processed: json.processed,
      total: json.total,
      lastBatch: json.batchProcessed,
      done: json.done,
      errors: json.errors,
    });
    if (json.done) localStorage.removeItem("epostscanner:lastUploadId");
    if (json.done) refreshEmailCount().catch(() => undefined);
  }, [refreshEmailCount]);

  useEffect(() => {
    const uploadId = localStorage.getItem("epostscanner:lastUploadId");
    if (!uploadId) return;
    setIndexState({ kind: "indexing", uploadId, processed: 0, total: null, lastBatch: 0, done: false, errors: 0 });
    runIndexBatch(uploadId).catch(() => undefined);
  }, [runIndexBatch]);

  useEffect(() => {
    refreshEmailCount().catch(() => undefined);
  }, [refreshEmailCount]);

  useEffect(() => {
    if (indexState.kind !== "indexing") return;
    if (indexState.done) return;

    let cancelled = false;

    const tick = async () => {
      try {
        await runIndexBatch(indexState.uploadId);
      } catch {
        if (cancelled) return;
        setTimeout(tick, 1500);
      }
    };

    const id = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [indexState, runIndexBatch]);

  const runSearch = useCallback(async () => {
    setSearchError(null);
    const q = query.trim();
    if (!q) return;

    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setSearchError(await res.text());
      return;
    }

    const json = (await res.json()) as { hits: SearchHit[] };
    setHits(json.hits);
  }, [query]);

  useEffect(() => {
    setSelectedEmail(null);
    setEmailError(null);
    if (!selectedEmailId) return;

    let cancelled = false;
    const run = async () => {
      const res = await fetch(`/api/email/${encodeURIComponent(selectedEmailId)}`);
      if (!res.ok) {
        const t = await res.text();
        if (!cancelled) setEmailError(t);
        return;
      }
      const json = (await res.json()) as { email: EmailRecord };
      if (!cancelled) setSelectedEmail(json.email);
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedEmailId]);

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Epostscanner</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Last opp EML/ZIP, indekser, og søk i fulltekst.
      </p>
      <div style={{ marginTop: 12, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 13 }}>
            {emailCountError ? (
              <span style={{ color: "#b91c1c" }}>Kunne ikke hente antall e-poster</span>
            ) : emailCount === null ? (
              <span style={{ opacity: 0.8 }}>Henter antall e-poster…</span>
            ) : (
              <span>
                <span style={{ fontWeight: 700 }}>{formatNumber(emailCount)}</span> e-poster tilgjengelig i databasen
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => refreshEmailCount().catch(() => undefined)}
            disabled={indexState.kind === "uploading"}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              background: "white",
              cursor: indexState.kind === "uploading" ? "not-allowed" : "pointer",
            }}
          >
            Oppdater
          </button>
        </div>
      </div>

      <section style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr", marginTop: 16 }}>
        <UploadDropzone onFiles={startUpload} disabled={indexState.kind === "uploading" || indexState.kind === "indexing"} />

        <div style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk (ord, fraser, avsender, mottaker, emne, dato)..."
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db" }}
            />
            <button
              onClick={runSearch}
              disabled={!canSearch}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: canSearch ? "#111827" : "#9ca3af",
                color: "white",
              }}
            >
              Søk
            </button>
          </div>

          {searchError ? (
            <p style={{ color: "#b91c1c", marginTop: 10 }}>{searchError}</p>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, marginTop: 16 }}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", fontWeight: 600 }}>
                Treff ({hits.length})
              </div>
              <div style={{ maxHeight: 520, overflow: "auto" }}>
                {hits.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setSelectedEmailId(h.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      borderBottom: "1px solid #f3f4f6",
                      background: selectedEmailId === h.id ? "#f9fafb" : "white",
                      padding: 12,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {h.subject || "(uten emne)"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {h.from ?? "(ukjent)"} · {h.date ? new Date(h.date).toLocaleString("no-NO") : ""}
                    </div>
                    {h.snippet ? (
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                        {h.snippet}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", fontWeight: 600 }}>
                E-post
              </div>
              <div style={{ padding: 12 }}>
                {emailError ? <p style={{ color: "#b91c1c" }}>{emailError}</p> : null}
                {selectedEmail ? (
                  <EmailView email={selectedEmail} />
                ) : (
                  <p style={{ opacity: 0.8 }}>Velg et treff for å se innhold.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer style={{ marginTop: 16, opacity: 0.7, fontSize: 12 }}>
        {indexState.kind === "idle" ? "Klar." : null}
        {indexState.kind === "uploading" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              Laster opp… {indexState.uploaded}/{indexState.total} ·{" "}
              {formatBytes(indexState.bytesUploaded)} / {formatBytes(indexState.bytesTotal)} (
              {indexState.bytesTotal ? Math.round((indexState.bytesUploaded / indexState.bytesTotal) * 100) : 0}
              %) · gjenstår {formatBytes(Math.max(0, indexState.bytesTotal - indexState.bytesUploaded))}
              {indexState.currentFile ? ` · ${indexState.currentFile}` : ""}
            </div>
            <div style={{ height: 8, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${indexState.bytesTotal ? Math.min(100, (indexState.bytesUploaded / indexState.bytesTotal) * 100) : 0}%`,
                  background: "#111827",
                }}
              />
            </div>
          </div>
        ) : null}
        {indexState.kind === "indexing"
          ? `Indekserer… ${indexState.processed}${indexState.total ? `/${indexState.total}` : ""} (siste batch: ${indexState.lastBatch}, feil: ${indexState.errors})`
          : null}
        {indexState.kind === "ready" ? "Indeksering ferdig." : null}
      </footer>
    </main>
  );
}

function EmailView({ email }: { email: EmailRecord }) {
  const [showRawHtml, setShowRawHtml] = useState(false);

  const sanitizedHtml = useMemo(() => {
    if (!email.bodyHtml) return null;
    return DOMPurify.sanitize(email.bodyHtml, {
      USE_PROFILES: { html: true },
    });
  }, [email.bodyHtml]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Fra</div>
        <div style={{ fontSize: 13 }}>{email.from || "(ukjent)"}</div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Til</div>
        <div style={{ fontSize: 13 }}>{email.to?.join(", ") || "(ukjent)"}</div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Dato</div>
        <div style={{ fontSize: 13 }}>
          {email.date ? new Date(email.date).toLocaleString("no-NO") : "(ukjent)"}
        </div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Emne</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{email.subject || "(uten emne)"}</div>
      </div>

      {email.attachments?.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Vedlegg</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {email.attachments.map((a) => (
              <li key={`${a.filename}-${a.size}`}>
                <span style={{ fontSize: 13 }}>
                  {a.filename} ({formatBytes(a.size)}) · {a.mimeType}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {email.bodyText ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Tekst</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{email.bodyText}</pre>
        </div>
      ) : null}

      {sanitizedHtml ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>HTML</div>
            <button
              onClick={() => setShowRawHtml((s) => !s)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "white",
              }}
            >
              {showRawHtml ? "Skjul original HTML" : "Åpne original HTML"}
            </button>
          </div>

          <div
            style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}
          >
            <div
              style={{ padding: 12 }}
              dangerouslySetInnerHTML={{ __html: showRawHtml ? email.bodyHtml ?? "" : sanitizedHtml }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatNumber(n: number) {
  try {
    return new Intl.NumberFormat("no-NO").format(n);
  } catch {
    return String(n);
  }
}

function uploadFileWithProgress(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (loadedBytes: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (e) => {
      if (typeof e.loaded === "number") onProgress(e.loaded);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload feilet (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload feilet (nettverksfeil)"));
    xhr.onabort = () => reject(new Error("Upload avbrutt"));

    xhr.send(file);
  });
}
