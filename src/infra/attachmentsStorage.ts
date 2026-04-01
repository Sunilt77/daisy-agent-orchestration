import { Storage } from '@google-cloud/storage';

export type StoredAttachment = {
  provider: 'gcs';
  storageKey: string;
  fileUrl: string;
};

function slugifySegment(input: string) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function attachmentBucketConfig() {
  const bucket = String(process.env.GCS_ATTACHMENTS_BUCKET || '').trim();
  const prefix = String(process.env.GCS_ATTACHMENTS_PREFIX || 'attachments')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const signedUrlHours = Math.max(1, Number(process.env.GCS_ATTACHMENTS_SIGNED_URL_HOURS || 24 * 7));
  return { bucket, prefix, signedUrlHours };
}

export function isAttachmentStorageConfigured() {
  return Boolean(attachmentBucketConfig().bucket);
}

export async function uploadAttachmentBuffer(params: {
  buffer: Buffer;
  originalName: string;
  mimeType?: string | null;
  attachmentId: string;
}) : Promise<StoredAttachment> {
  const { bucket, prefix, signedUrlHours } = attachmentBucketConfig();
  if (!bucket) {
    throw new Error('Attachment storage bucket is not configured. Set GCS_ATTACHMENTS_BUCKET.');
  }

  const storage = new Storage();
  const cleanName = slugifySegment(params.originalName || 'upload.bin') || 'upload.bin';
  const remoteName = `${prefix}/${new Date().toISOString().slice(0, 10)}/${params.attachmentId}-${cleanName}`;
  const file = storage.bucket(bucket).file(remoteName);

  await file.save(params.buffer, {
    resumable: false,
    metadata: params.mimeType ? { contentType: params.mimeType } : undefined,
  });

  const [fileUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + (signedUrlHours * 60 * 60 * 1000),
  });

  return {
    provider: 'gcs',
    storageKey: remoteName,
    fileUrl,
  };
}
