import type {
  AdminClientConfig,
  GarageBucketInfo,
  GarageBucketSummary,
  GarageClusterHealth
} from "./types.js";

export class GarageAdminApiV2Client {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: AdminClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 10_000;
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

    try {
      return await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
