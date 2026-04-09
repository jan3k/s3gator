import { describe, expect, it } from "vitest";
import { inferPreviewType, normalizeKey, normalizePrefix } from "./utils.js";

describe("normalizePrefix", () => {
  it("adds trailing slash", () => {
    expect(normalizePrefix("foo/bar")).toBe("foo/bar/");
  });

  it("removes duplicate slashes", () => {
    expect(normalizePrefix("/foo//bar/")).toBe("foo/bar/");
  });
});

describe("normalizeKey", () => {
  it("normalizes slash placement", () => {
    expect(normalizeKey("//foo///bar.txt")).toBe("foo/bar.txt");
  });
});

describe("inferPreviewType", () => {
  it("returns image for image types", () => {
    expect(inferPreviewType("image/png")).toBe("image");
  });

  it("returns pdf for pdf type", () => {
    expect(inferPreviewType("application/pdf")).toBe("pdf");
  });

  it("falls back to download", () => {
    expect(inferPreviewType("application/octet-stream")).toBe("download");
  });
});
