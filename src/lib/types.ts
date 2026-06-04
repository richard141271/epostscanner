export type AttachmentMeta = {
  filename: string;
  size: number;
  mimeType: string;
};

export type EmailRecord = {
  id: string;
  from: string | null;
  to: string[] | null;
  date: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: AttachmentMeta[] | null;
};

export type SearchHit = {
  id: string;
  from: string | null;
  subject: string | null;
  date: string | null;
  snippet: string | null;
};

export type UploadInitResponse = {
  uploadId: string;
  uploads: Array<{
    name: string;
    storageKey: string;
    signedUrl: string;
    token: string;
  }>;
};
