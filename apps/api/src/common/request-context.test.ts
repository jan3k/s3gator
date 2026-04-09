import { describe, expect, it } from "vitest";
import { getCorrelationId, runWithRequestContext } from "./request-context.js";

describe("request context", () => {
  it("propagates correlation id inside async flow", async () => {
    const value = await runWithRequestContext(
      {
        requestId: "req-1",
        correlationId: "corr-1",
        source: "http"
      },
      async () => {
        await Promise.resolve();
        return getCorrelationId();
      }
    );

    expect(value).toBe("corr-1");
  });

  it("returns null outside request context", () => {
    expect(getCorrelationId()).toBeNull();
  });
});
