import { basename, extname } from "node:path";

export interface ImageData {
  base64: string;
  mimeType: string;
}

const imageMimeTypes: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function isImageFile(path: string): boolean {
  return extname(path).toLowerCase() in imageMimeTypes;
}

export function imageMIMEType(path: string): string {
  return imageMimeTypes[extname(path).toLowerCase()] ?? "image/png";
}

export function imageDataFromBytes(path: string, data: Uint8Array): ImageData {
  return {
    base64: Buffer.from(data).toString("base64"),
    mimeType: imageMIMEType(path),
  };
}

export function safeFilename(name: string): string {
  return basename(name);
}
