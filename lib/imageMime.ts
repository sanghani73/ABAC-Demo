/**
 * Detect an image's MIME type from its magic bytes — NOT its filename
 * extension. Demo media is often downloaded from sources that re-encode the
 * bytes (a `.jpg` file may actually contain WEBP), and providers like
 * Anthropic reject the upload when the declared media_type disagrees with
 * the real bytes.
 *
 * Returns null for unrecognised content so callers can fall back gracefully.
 */
import { readFileSync } from "node:fs";

export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export function detectImageMime(buf: Buffer): ImageMime | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return "image/gif";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Read a file and return its bytes plus the sniffed MIME. Returns null for
 * unrecognised image content so callers can skip the file.
 */
export function readImageWithMime(
  path: string,
): { buf: Buffer; mime: ImageMime } | null {
  const buf = readFileSync(path);
  const mime = detectImageMime(buf);
  if (!mime) return null;
  return { buf, mime };
}
