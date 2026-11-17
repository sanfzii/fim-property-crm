// Lokasi: src/modules/shared/storage/storage.validator.ts
// Level Topologis: L0 (Shared Pure File Validator & Magic Bytes Inspector)

export const STORAGE_BUCKET_NAME = 'fim-private-documents' as const;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB (5.242.880 bytes)
export const SIGNED_URL_EXPIRES_IN_SECONDS = 300; // 300 detik (5 menit)

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const ALLOWED_FILE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
export type AllowedFileExtension = (typeof ALLOWED_FILE_EXTENSIONS)[number];

const MIME_TO_EXTENSIONS: Record<AllowedMimeType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

export interface ValidatedFileMetadata {
  originalFileName: string;
  sanitizedFileName: string;
  extension: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  buffer: Uint8Array;
}

/**
 * Membersihkan nama file untuk metadata DB & Content-Disposition download
 * tanpa path separator, '..', karakter kontrol (CR/LF), atau titik berulang.
 */
export function sanitizeFileName(rawName: string): string {
  const fileNameOnly = rawName.split(/[\\/]/).pop() ?? '';
  const cleaned = fileNameOnly
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'document';
}

export function extractFileExtension(fileName: string): string {
  const cleanName = fileName.trim();
  const parts = cleanName.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }
  return parts[parts.length - 1] ?? '';
}

/**
 * Memeriksa tanda tangan biner (Magic Bytes) dari isi file.
 */
export function verifyFileMagicBytes(
  bytes: Uint8Array,
  expectedMime: AllowedMimeType
): boolean {
  if (bytes.byteLength < 12) {
    return false;
  }

  switch (expectedMime) {
    case 'application/pdf':
      // '%PDF-' -> 0x25 0x50 0x44 0x46 0x2D
      return (
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46 &&
        bytes[4] === 0x2d
      );

    case 'image/jpeg':
      // JPEG SOI -> 0xFF 0xD8 0xFF
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

    case 'image/png':
      // PNG 8-byte header -> 89 50 4E 47 0D 0A 1A 0A
      return (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );

    case 'image/webp':
      // 'RIFF' (0..3) & 'WEBP' (8..11)
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );

    default:
      return false;
  }
}

export async function validateUploadedFileServer(
  file: File | null | undefined,
  options?: { pdfOnly?: boolean }
): Promise<ValidatedFileMetadata> {
  if (
    !file ||
    typeof file.arrayBuffer !== 'function' ||
    typeof file.size !== 'number' ||
    typeof file.name !== 'string'
  ) {
    throw new Error('FILE_REQUIRED: File dokumen wajib dipilih untuk diunggah.');
  }

  if (file.size <= 0) {
    throw new Error('EMPTY_FILE: File yang diunggah kosong (0 bytes) atau rusak.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `FILE_TOO_LARGE: Ukuran file (${sizeMb} MB) melebihi batas maksimal 5 MB.`
    );
  }

  const rawMime = (file.type ?? '').trim().toLowerCase() as AllowedMimeType;
  if (!ALLOWED_MIME_TYPES.includes(rawMime)) {
    throw new Error(
      `INVALID_MIME_TYPE: Tipe file "${file.type || 'unknown'}" tidak diizinkan. Gunakan JPG, PNG, WEBP, atau PDF.`
    );
  }

  if (options?.pdfOnly && rawMime !== 'application/pdf') {
    throw new Error(
      'PDF_REQUIRED: Dokumen kontrak perjanjian (PPJB/Akta) wajib berformat PDF.'
    );
  }

  const extension = extractFileExtension(file.name);
  const allowedExtensions = MIME_TO_EXTENSIONS[rawMime];

  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error(
      `EXTENSION_MISMATCH: Ekstensi file ".${extension}" tidak sesuai dengan tipe konten "${rawMime}".`
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  if (uint8Array.byteLength === 0 || uint8Array.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      'INVALID_FILE_PAYLOAD: Ukuran biner file tidak valid atau melebihi batas maksimal 5 MB.'
    );
  }

  if (!verifyFileMagicBytes(uint8Array, rawMime)) {
    throw new Error(
      'CORRUPTED_OR_SPOOFED_FILE: Struktur biner file tidak valid atau tidak sesuai dengan format yang diklaim.'
    );
  }

  return {
    originalFileName: file.name,
    sanitizedFileName: sanitizeFileName(file.name),
    extension,
    mimeType: rawMime,
    sizeBytes: uint8Array.byteLength,
    buffer: uint8Array,
  };
}
