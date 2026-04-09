import { Body, Controller, Get, Ip, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { SettingsService } from "./settings.service.js";

const authModeSchema = z.object({
  mode: z.enum(["local", "ldap", "hybrid"])
});

@Controller("admin/settings")
@UseGuards(RoleGuard)
@RequireRoles("SUPER_ADMIN")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("ldap")
  ldapConfig() {
    return this.settingsService.getLdapConfig();
  }

  @Patch("ldap")
  updateLdapConfig(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }
    return this.settingsService.updateLdapConfig(actor, body, ipAddress);
  }

  @Get("auth-mode")
  authMode() {
    return this.settingsService.getAuthMode();
  }

  @Patch("auth-mode")
  setAuthMode(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }
    const parsed = authModeSchema.parse(body);
    return this.settingsService.setAuthMode(actor, parsed.mode, ipAddress);
  }
}
