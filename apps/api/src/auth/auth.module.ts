import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";
import { LdapAuthService } from "./ldap-auth.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, LoginRateLimiterService, LdapAuthService],
  exports: [SessionService]
})
export class AuthModule {}
