// Ported from src/lib/storage/imageCompress.ts @ 7a29f3a (Q-Tech CRM v1). Moved to src/lib/; behaviour unchanged.
// Client-side compression for scanned/photographed receipts before upload.
// A phone photo of a paper document is routinely 3-8MB; a challan only needs
// to stay legible, not print-quality, so we resize + re-encode hard before it
// ever touches Supabase Storage. This is what keeps a 1GB free-tier bucket
// good for thousands of receipts instead of a few hundred.

const MAX_DIMENSION = 1800; // px, longest side
const JPEG_QUALITY = 0.75;

/** Resize + re-encode an image file as JPEG. Non-image files (PDFs) pass through untouched. */
export async function compressIfImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file; // canvas unsupported — fall back to the original file
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file; // compression didn't help — keep the original

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}
