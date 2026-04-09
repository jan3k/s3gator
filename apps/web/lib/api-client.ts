export interface ApiErrorPayload {
  message?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
let csrfToken: string | null = null;

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) {
    return csrfToken;
  }

  const response = await fetch(`${API_BASE}/auth/csrf`, {
    credentials: "include"
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { csrfToken?: string | null };
  csrfToken = payload.csrfToken ?? null;
  return csrfToken;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? {});

  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const token = await ensureCsrfToken();
    if (token) {
      headers.set("x-csrf-token", token);
    }
  }

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!response.ok) {
    const text = await response.text();
    const fallback = `Request failed: ${response.status}`;

    try {
      const payload = JSON.parse(text) as ApiErrorPayload;
      throw new Error(payload.message ?? fallback);
    } catch {
      throw new Error(text || fallback);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function clearClientState() {
  csrfToken = null;
}
