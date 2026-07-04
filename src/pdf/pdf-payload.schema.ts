export const PDF_PAYLOAD_ENCODING = "base64" as const;

// 10 MB - generous for an A4 invoice/report PDF, small enough to keep a
// misbehaving caller from filling the temp folder or blocking the event
// loop on decode.
export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

const PDF_HEADER_BYTES = Buffer.from("%PDF", "ascii");

// Node's `Buffer.from(str, "base64")` never throws on malformed input - it
// silently decodes whatever it can and drops invalid characters. That means
// garbage input (e.g. a stray invoice JSON string) would otherwise "decode"
// into meaningless bytes instead of failing loudly. This charset/padding
// check runs first so obviously-invalid base64 is rejected as
// PDF_DECODE_FAILED before ever reaching the PDF header check.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function isLikelyBase64(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length % 4 === 0 && BASE64_PATTERN.test(trimmed);
}

export function decodeBase64Pdf(value: string): Buffer {
  return Buffer.from(value, "base64");
}

export function hasPdfHeader(buffer: Buffer): boolean {
  return buffer.length >= PDF_HEADER_BYTES.length && buffer.subarray(0, PDF_HEADER_BYTES.length).equals(PDF_HEADER_BYTES);
}
