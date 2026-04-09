import {
  Body,
  Controller,
  Get,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { loginSchema } from "@s3gator/shared";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { Public } from "@/common/public.decorator.js";
import { AuthService } from "./auth.service.js";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";
import { SessionService } from "./session.service.js";
import { CurrentUser } from "./current-user.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly limiter: LoginRateLimiterService,
    private readonly configService: ConfigService
  ) {}

  @Public()
  @Post("login")
  async login(
    @Body() body: unknown,
    @Ip() ip: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const parsed = loginSchema.parse(body);
    const key = `${ip}:${parsed.username.toLowerCase()}`;

    this.limiter.check(key);

    try {
      const user = await this.authService.login(parsed);
      const session = await this.sessionService.createSession(user.id, ip, req.headers["user-agent"]);

      this.limiter.clear(key);

      const cookieName = this.configService.get<string>("SESSION_COOKIE_NAME", "s3gator_sid");
      const secure = this.configService.get<string>("NODE_ENV") === "production";

      res.cookie(cookieName, session.token, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: this.configService.get<number>("SESSION_TTL_HOURS", 24) * 60 * 60 * 1000
      });

      return {
        user,
        csrfToken: session.csrfToken
      };
    } catch (error) {
      this.limiter.registerFailure(key);
      throw error;
    }
  }

  @Post("logout")
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.sessionId) {
      throw new UnauthorizedException("Not authenticated");
    }

    await this.sessionService.revokeSession(req.sessionId);

    const cookieName = this.configService.get<string>("SESSION_COOKIE_NAME", "s3gator_sid");
    res.clearCookie(cookieName, { path: "/" });

    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedRequest["user"]) {
    return { user: user ?? null };
  }

  @Get("csrf")
  csrf(@Req() req: AuthenticatedRequest) {
    return { csrfToken: req.csrfToken ?? null };
  }
}
