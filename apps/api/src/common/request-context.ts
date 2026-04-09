import type { SessionUser } from "@s3gator/shared";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
  csrfToken?: string;
  requestId?: string;
  correlationId?: string;
}

export interface RequestRuntimeContext {
  requestId: string;
  correlationId: string;
  source: "http" | "worker" | "script";
  userId?: string;
  jobId?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestRuntimeContext>();

export function runWithRequestContext<T>(
  context: RequestRuntimeContext,
  callback: () => T
): T {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestRuntimeContext | undefined {
  return requestContextStorage.getStore();
}

export function getCorrelationId(): string | null {
  return requestContextStorage.getStore()?.correlationId ?? null;
}
