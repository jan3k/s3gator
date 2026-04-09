import type {
  AdminClientConfig,
  GarageBucketInfo,
  GarageBucketSummary,
  GarageClusterHealth
} from "./types.js";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";

export class GarageAdminApiV2Client {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly tracer = trace.getTracer("s3gator.s3.admin-client");

  constructor(config: AdminClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  async listBuckets(): Promise<GarageBucketSummary[]> {
    return this.request<GarageBucketSummary[]>("GET", "/v2/ListBuckets");
  }

  async getBucketInfo(id: string): Promise<GarageBucketInfo> {
    return this.request<GarageBucketInfo>("GET", "/v2/GetBucketInfo", undefined, { id });
  }

  async getClusterHealth(): Promise<GarageClusterHealth> {
    return this.request<GarageClusterHealth>("GET", "/v2/GetClusterHealth");
  }

  async healthCheck(): Promise<boolean> {
    const response = await this.fetchRaw("GET", "/health");
    return response.ok;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<T> {
    const response = await this.fetchRaw(method, path, body, query);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Garage admin API ${response.status}: ${message || response.statusText}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async fetchRaw(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const span = this.tracer.startSpan(`garage.admin.${method.toLowerCase()} ${path}`, {
      attributes: {
        "http.method": method,
        "http.url": url.toString(),
        "net.peer.name": url.hostname,
        "net.peer.port": Number(url.port || (url.protocol === "https:" ? 443 : 80))
      }
    });

    try {
      return await context.with(trace.setSpan(context.active(), span), async () => {
        const response = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            ...this.defaultHeaders
          },
          body: body ? JSON.stringify(body) : undefined
        });

        span.setAttribute("http.status_code", response.status);
        if (!response.ok) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `Garage admin HTTP ${response.status}`
          });
        }

        return response;
      });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      span.end();
    }
  }
}
