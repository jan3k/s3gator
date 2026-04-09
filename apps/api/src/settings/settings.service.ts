import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { roleSchema } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";
import { CryptoService } from "@/common/crypto.service.js";

const ldapUpdateSchema = z.object({
  enabled: z.boolean(),
  url: z.string().url().nullable().optional(),
  bindDn: z.string().nullable().optional(),
  bindPassword: z.string().min(1).nullable().optional(),
  searchBase: z.string().nullable().optional(),
  searchFilter: z.string().default("(uid={{username}})"),
  usernameAttribute: z.string().default("uid"),
  emailAttribute: z.string().default("mail"),
  displayNameAttribute: z.string().default("cn"),
  groupAttribute: z.string().default("memberOf"),
  groupRoleMapping: z.record(z.string(), roleSchema).default({}),
  tlsRejectUnauthorized: z.boolean().default(true)
});

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService
  ) {}

  async getLdapConfig() {
    const config = await this.prisma.ldapConfig.findUnique({ where: { id: "default" } });
    return {
      enabled: config?.enabled ?? false,
      url: config?.url ?? null,
      bindDn: config?.bindDn ?? null,
      hasBindPassword: Boolean(config?.bindPasswordEncrypted),
      searchBase: config?.searchBase ?? null,
      searchFilter: config?.searchFilter ?? "(uid={{username}})",
      usernameAttribute: config?.usernameAttribute ?? "uid",
      emailAttribute: config?.emailAttribute ?? "mail",
      displayNameAttribute: config?.displayNameAttribute ?? "cn",
      groupAttribute: config?.groupAttribute ?? "memberOf",
      groupRoleMapping: (config?.groupRoleMapping ?? {}) as Record<string, string>,
      tlsRejectUnauthorized: config?.tlsRejectUnauthorized ?? true
    };
  }

  async updateLdapConfig(input: unknown) {
    const parsed = ldapUpdateSchema.parse(input);

    await this.prisma.ldapConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        enabled: parsed.enabled,
        url: parsed.url,
        bindDn: parsed.bindDn,
        bindPasswordEncrypted: parsed.bindPassword ? this.cryptoService.encrypt(parsed.bindPassword) : null,
        searchBase: parsed.searchBase,
        searchFilter: parsed.searchFilter,
        usernameAttribute: parsed.usernameAttribute,
        emailAttribute: parsed.emailAttribute,
        displayNameAttribute: parsed.displayNameAttribute,
        groupAttribute: parsed.groupAttribute,
        groupRoleMapping: parsed.groupRoleMapping,
        tlsRejectUnauthorized: parsed.tlsRejectUnauthorized
      },
      update: {
        enabled: parsed.enabled,
        url: parsed.url,
        bindDn: parsed.bindDn,
        bindPasswordEncrypted:
          parsed.bindPassword === undefined
            ? undefined
            : parsed.bindPassword === null
              ? null
              : this.cryptoService.encrypt(parsed.bindPassword),
        searchBase: parsed.searchBase,
        searchFilter: parsed.searchFilter,
        usernameAttribute: parsed.usernameAttribute,
        emailAttribute: parsed.emailAttribute,
        displayNameAttribute: parsed.displayNameAttribute,
        groupAttribute: parsed.groupAttribute,
        groupRoleMapping: parsed.groupRoleMapping,
        tlsRejectUnauthorized: parsed.tlsRejectUnauthorized
      }
    });

    return this.getLdapConfig();
  }

  async getAuthMode() {
    const item = await this.prisma.appSetting.findUnique({ where: { key: "auth_mode" } });
    return (item?.value as string | undefined) ?? "local";
  }

  async setAuthMode(mode: "local" | "ldap" | "hybrid") {
    await this.prisma.appSetting.upsert({
      where: { key: "auth_mode" },
      create: {
        key: "auth_mode",
        value: mode
      },
      update: {
        value: mode
      }
    });

    return { mode };
  }
}
