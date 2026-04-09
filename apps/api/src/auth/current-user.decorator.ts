import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { SessionUser } from "@s3gator/shared";
import type { AuthenticatedRequest } from "@/common/request-context.js";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser | undefined => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user;
});
