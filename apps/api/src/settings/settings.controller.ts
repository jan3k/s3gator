import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
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
  updateLdapConfig(@Body() body: unknown) {
    return this.settingsService.updateLdapConfig(body);
  }

  @Get("auth-mode")
  authMode() {
    return this.settingsService.getAuthMode();
  }

  @Patch("auth-mode")
  setAuthMode(@Body() body: unknown) {
    const parsed = authModeSchema.parse(body);
    return this.settingsService.setAuthMode(parsed.mode);
  }
}
