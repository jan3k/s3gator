import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parse } from "cookie";
import { ConfigService } from "@nestjs/config";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { IS_PUBLIC_ROUTE } from "@/common/public.decorator.js";
import { SessionService } from "./session.service.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName = this.configService.get<string>("SESSION_COOKIE_NAME", "s3gator_sid");
    const rawCookie = request.headers.cookie ?? "";
    const parsed = parse(rawCookie);
    const token = parsed[cookieName];

    if (!token) {
      throw new UnauthorizedException("Not authenticated");
    }

    const resolved = await this.sessionService.getSessionUser(token);
    if (!resolved) {
      throw new UnauthorizedException("Session expired or invalid");
    }

    request.user = resolved.user;
    request.sessionId = resolved.sessionId;
    request.csrfToken = resolved.csrfToken;

    return true;
  }
}
