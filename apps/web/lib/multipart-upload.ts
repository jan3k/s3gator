export interface SignedPart {
  partNumber: number;
  url: string;
}

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

export interface UploadPartsOptions {
  file: File;
  parts: SignedPart[];
  partSize: number;
  contentType?: string;
  concurrency?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  onPartComplete?: (part: CompletedPart) => Promise<void> | void;
  fetchImpl?: typeof fetch;
}

export interface UploadPartWithRetryOptions {
  file: File;
  part: SignedPart;
  partSize: number;
  contentType?: string;
  signal?: AbortSignal;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 4;

export async function uploadPartsWithConcurrency(input: UploadPartsOptions): Promise<CompletedPart[]> {
  const orderedParts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
  const total = input.file.size;
  const completed: CompletedPart[] = new Array(orderedParts.length);
  const workers = Math.max(1, Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, orderedParts.length || 1));

  let cursor = 0;
  let uploadedBytes = 0;

  input.onProgress?.(0, total);

  await Promise.all(
    Array.from({ length: workers }).map(async () => {
      while (true) {
        const current = cursor;
        cursor += 1;

        if (current >= orderedParts.length) {
          return;
        }

        const part = orderedParts[current];
        if (!part) {
          continue;
        }

        const result = await uploadPartWithRetry({
          file: input.file,
          part,
          partSize: input.partSize,
          contentType: input.contentType,
          signal: input.signal,
          maxRetries: input.maxRetries,
          fetchImpl: input.fetchImpl
        });

        completed[current] = result;
        await input.onPartComplete?.(result);

        const start = (part.partNumber - 1) * input.partSize;
        const end = Math.min(start + input.partSize, total);
        uploadedBytes += end - start;
        input.onProgress?.(Math.min(uploadedBytes, total), total);
      }
    })
  );

  return completed.filter((part): part is CompletedPart => Boolean(part));
}

export async function uploadPartWithRetry(input: UploadPartWithRetryOptions): Promise<CompletedPart> {
  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = input.fetchImpl ?? fetch;

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      if (input.signal?.aborted) {
        throw makeAbortError();
      }

      const chunk = getChunk(input.file, input.part.partNumber, input.partSize);
      const response = await fetchImpl(input.part.url, {
        method: "PUT",
        headers: input.contentType ? { "content-type": input.contentType } : undefined,
        body: chunk,
        signal: input.signal
      });

      if (!response.ok) {
        throw new Error(`Part upload failed (${response.status})`);
      }

      const eTag = (response.headers.get("etag") ?? "").replaceAll('"', "");
      if (!eTag) {
        throw new Error("Missing ETag in multipart response");
      }

      return {
        partNumber: input.part.partNumber,
        eTag
      };
    } catch (error) {
      if (isAbortUploadError(error)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      await sleep(250 * 2 ** attempt);
      attempt += 1;
    }
  }

  throw new Error("Multipart retry loop failed unexpectedly");
}

function getChunk(file: File, partNumber: number, partSize: number): Blob {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, file.size);
  return file.slice(start, end);
}

export function isAbortUploadError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  return false;
}

function makeAbortError(): Error {
  const error = new Error("Upload aborted");
  error.name = "AbortError";
  return error;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
