"use client";

import { useCallback, useMemo, useState } from "react";

type Props = {
  onFiles: (files: File[]) => Promise<void> | void;
  disabled?: boolean;
  statusMessage?: string | null;
};

export function UploadDropzone({ onFiles, disabled, statusMessage }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptHint = useMemo(
    () => "EML-filer (.eml) eller ZIP (.zip).",
    [],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      if (!files.length) {
        setError(
          `Fikk ingen filer fra nettleseren. Prøv «Velg mappe» eller lag en ZIP. ${acceptHint}`,
        );
        return;
      }
      const filtered = files.filter((f) => {
        const n = f.name.toLowerCase();
        return n.endsWith(".eml") || n.endsWith(".zip");
      });
      if (!filtered.length) {
        const summary = summarizeExtensions(files);
        setError(
          `Fant ingen støttede filer blant ${files.length} valgte. Støtter .eml og .zip. ${summary ? `Fant: ${summary}. ` : ""}${acceptHint}`,
        );
        return;
      }
      try {
        await onFiles(filtered);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Opplasting feilet");
      }
    },
    [acceptHint, onFiles],
  );

  const onPickedFiles = useCallback(
    async (input: HTMLInputElement) => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      if (!files.length) {
        await handleFiles([]);
        return;
      }
      await handleFiles(files);
    },
    [handleFiles],
  );

  const onChangeFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await onPickedFiles(e.currentTarget);
    },
    [onPickedFiles],
  );

  const onInputFiles = useCallback(
    async (e: React.FormEvent<HTMLInputElement>) => {
      await onPickedFiles(e.currentTarget);
    },
    [onPickedFiles],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;
      setDragging(false);
      setError(null);

      const items = e.dataTransfer.items;
      if (items?.length) {
        const collected = await collectFilesFromDataTransferItems(items);
        await handleFiles(collected);
        return;
      }

      const files = e.dataTransfer.files;
      if (files?.length) {
        await handleFiles(Array.from(files));
      }
    },
    [disabled, handleFiles],
  );

  return (
    <div style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (disabled) return;
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (disabled) return;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (disabled) return;
          setDragging(false);
        }}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? "#111827" : "#d1d5db"}`,
          borderRadius: 12,
          padding: 18,
          background: disabled ? "#f3f4f6" : dragging ? "#f9fafb" : "white",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Opplasting</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
              Dra og slipp ZIP, mapper med EML, eller enkeltfiler.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label
              style={{
                position: "relative",
                overflow: "hidden",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "white",
                cursor: disabled ? "not-allowed" : "pointer",
                minWidth: 102,
              }}
            >
              Velg filer
              <input
                type="file"
                multiple
                accept=".eml,.zip"
                onChange={onChangeFiles}
                onInput={onInputFiles}
                onClick={(e) => {
                  e.currentTarget.value = "";
                }}
                disabled={disabled}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              />
            </label>
            <label
              style={{
                position: "relative",
                overflow: "hidden",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "white",
                cursor: disabled ? "not-allowed" : "pointer",
                minWidth: 120,
              }}
            >
              Velg mappe
              <input
                type="file"
                multiple
                accept=".eml"
                onChange={onChangeFiles}
                onInput={onInputFiles}
                onClick={(e) => {
                  e.currentTarget.value = "";
                }}
                disabled={disabled}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
                {...({ webkitdirectory: "true" } as unknown as Record<string, string>)}
              />
            </label>
          </div>
        </div>

        {error ? <p style={{ marginTop: 12, color: "#b91c1c" }}>{error}</p> : null}
        {!error && statusMessage ? (
          <p style={{ marginTop: 12, fontSize: 12, color: "#111827", opacity: 0.85 }}>
            {statusMessage}
          </p>
        ) : null}
        {!error && !statusMessage ? (
          <p style={{ marginTop: 12, opacity: 0.75, fontSize: 12 }}>{acceptHint}</p>
        ) : null}
      </div>
    </div>
  );
}

function summarizeExtensions(files: File[]) {
  const counts = new Map<string, number>();
  for (const f of files) {
    const name = f.name || "";
    const base = name.split(/[/\\\\]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "(uten endelse)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ext, n]) => `${ext}×${n}`)
    .join(", ");
}

async function collectFilesFromDataTransferItems(items: DataTransferItemList) {
  const files: File[] = [];
  const pending: Array<Promise<void>> = [];

  for (const item of Array.from(items)) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
    if (entry) {
      pending.push(collectFromEntry(entry, files));
      continue;
    }

    const file = item.getAsFile();
    if (file) files.push(file);
  }

  await Promise.all(pending);
  return files;
}

async function collectFromEntry(entry: FileSystemEntry, out: File[]) {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    out.push(file);
    return;
  }

  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry;
    const reader = dir.createReader();

    while (true) {
      const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!entries.length) break;
      for (const child of entries) {
        await collectFromEntry(child, out);
      }
    }
  }
}
