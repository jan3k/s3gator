import type { SessionUser } from "@s3gator/shared";
import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
  csrfToken?: string;
}
