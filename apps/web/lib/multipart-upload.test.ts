import { describe, expect, it, vi } from "vitest";
import { isAbortUploadError, uploadPartWithRetry, uploadPartsWithConcurrency } from "./multipart-upload";

function makeFile(size: number): File {
  return new File([new Uint8Array(size)], "payload.bin", {
    type: "application/octet-stream"
  });
}

describe("multipart upload helpers", () => {
  it("retries part upload and eventually succeeds", async () => {
    const file = makeFile(10);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            etag: '"etag-1"'
          }
        })
      );

    const completed = await uploadPartWithRetry({
      file,
      part: {
        partNumber: 1,
        url: "https://upload.example.local/part/1"
      },
      partSize: 10,
      maxRetries: 1,
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(completed).toEqual({ partNumber: 1, eTag: "etag-1" });
  });

  it("returns AbortError when aborted", async () => {
    const file = makeFile(10);
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadPartWithRetry({
        file,
        part: {
          partNumber: 1,
          url: "https://upload.example.local/part/1"
        },
        partSize: 10,
        signal: controller.signal,
        fetchImpl: vi.fn()
      })
    ).rejects.toSatisfy((error: unknown) => isAbortUploadError(error));
  });

  it("uploads multiple parts with bounded concurrency and progress callback", async () => {
    const file = makeFile(30);
    const progressEvents: Array<{ loaded: number; total: number }> = [];

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const partNumber = Number(url.split("/").pop());
      return new Response("", {
        status: 200,
        headers: {
          etag: `"etag-${partNumber}"`
        }
      });
    });

    const completed = await uploadPartsWithConcurrency({
      file,
      parts: [
        { partNumber: 3, url: "https://upload.example.local/part/3" },
        { partNumber: 1, url: "https://upload.example.local/part/1" },
        { partNumber: 2, url: "https://upload.example.local/part/2" }
      ],
      partSize: 10,
      fetchImpl,
      concurrency: 2,
      onProgress: (loaded, total) => {
        progressEvents.push({ loaded, total });
      }
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(completed.map((part) => part.partNumber)).toEqual([1, 2, 3]);
    expect(progressEvents.at(-1)).toEqual({ loaded: 30, total: 30 });
  });
});
