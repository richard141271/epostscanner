"use client";

import { useCallback, useMemo, useRef, useState } from "react";

type Props = {
  onFiles: (files: File[]) => Promise<void> | void;
};

export function UploadDropzone({ onFiles }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const pickFiles = useCallback(() => fileInputRef.current?.click(), []);
  const pickFolder = useCallback(() => folderInputRef.current?.click(), []);

  const acceptHint = useMemo(
    () => "EML-filer (.eml) eller ZIP (.zip).",
    [],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const filtered = files.filter((f) => {
        const n = f.name.toLowerCase();
        return n.endsWith(".eml") || n.endsWith(".zip");
      });
      if (!filtered.length) {
        setError(`Fant ingen støttede filer. ${acceptHint}`);
        return;
      }
      await onFiles(filtered);
    },
    [acceptHint, onFiles],
  );

  const onChangeFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.currentTarget.files;
      e.currentTarget.value = "";
      if (!list) return;
      await handleFiles(Array.from(list));
    },
    [handleFiles],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
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
    [handleFiles],
  );

  return (
    <div style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? "#111827" : "#d1d5db"}`,
          borderRadius: 12,
          padding: 18,
          background: dragging ? "#f9fafb" : "white",
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
            <button
              type="button"
              onClick={pickFiles}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "white",
              }}
            >
              Velg filer
            </button>
            <button
              type="button"
              onClick={pickFolder}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "white",
              }}
            >
              Velg mappe
            </button>
          </div>
        </div>

        {error ? (
          <p style={{ marginTop: 12, color: "#b91c1c" }}>{error}</p>
        ) : (
          <p style={{ marginTop: 12, opacity: 0.75, fontSize: 12 }}>{acceptHint}</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".eml,.zip"
        style={{ display: "none" }}
        onChange={onChangeFiles}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept=".eml"
        style={{ display: "none" }}
        onChange={onChangeFiles}
        {...({ webkitdirectory: "true" } as unknown as Record<string, string>)}
      />
    </div>
  );
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
