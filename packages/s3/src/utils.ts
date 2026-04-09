export function normalizePrefix(prefix: string): string {
  if (!prefix) {
    return "";
  }

  const cleaned = prefix.replace(/^\/+/, "").replace(/\/+/g, "/");
  return cleaned.endsWith("/") ? cleaned : `${cleaned}/`;
}

export function normalizeKey(key: string): string {
  return key.replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function baseNameFromKey(key: string): string {
  const cleaned = key.endsWith("/") ? key.slice(0, -1) : key;
  const parts = cleaned.split("/").filter(Boolean);
  return parts.at(-1) ?? cleaned;
}

export function inferContentTypeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".log") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "text/plain";
  }
  if (lower.endsWith(".html")) {
    return "text/html";
  }
  if (lower.endsWith(".css")) {
    return "text/css";
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".ts")) {
    return "text/javascript";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lower.endsWith(".webm")) {
    return "video/webm";
  }
  if (lower.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lower.endsWith(".wav")) {
    return "audio/wav";
  }
  return "application/octet-stream";
}

export function inferPreviewType(contentType: string): "image" | "video" | "audio" | "text" | "pdf" | "download" {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  if (contentType === "application/pdf") {
    return "pdf";
  }
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("javascript")) {
    return "text";
  }
  return "download";
}

export async function mapWithConcurrency<T, R>(
  input: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const workers = Math.max(1, Math.min(concurrency, input.length || 1));
  const result: R[] = new Array(input.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: workers }).map(async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= input.length) {
          return;
        }
        const item = input[index];
        if (item === undefined) {
          continue;
        }
        result[index] = await mapper(item, index);
      }
    })
  );

  return result;
}
