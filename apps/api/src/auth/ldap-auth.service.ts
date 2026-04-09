import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Client } from "ldapts";
import { AppRole } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service.js";
import { CryptoService } from "@/common/crypto.service.js";

interface LdapAuthResult {
  username: string;
  email?: string;
  displayName?: string;
  role: AppRole;
}

@Injectable()
export class LdapAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService
  ) {}

  async authenticate(username: string, password: string): Promise<LdapAuthResult> {
    const config = await this.prisma.ldapConfig.findUnique({ where: { id: "default" } });

    if (!config?.enabled || !config.url || !config.searchBase) {
      throw new UnauthorizedException("LDAP authentication is not configured");
    }

    const client = new Client({
      url: config.url,
      timeout: 8000,
      connectTimeout: 8000,
      tlsOptions: {
        rejectUnauthorized: config.tlsRejectUnauthorized
      }
    });

    try {
      if (config.bindDn) {
        const bindPassword = config.bindPasswordEncrypted
          ? this.cryptoService.decrypt(config.bindPasswordEncrypted)
          : "";
        await client.bind(config.bindDn, bindPassword);
      }

      const filter = (config.searchFilter || "(uid={{username}})").replaceAll("{{username}}", escapeLdapValue(username));
      const attrs = [
        config.usernameAttribute,
        config.emailAttribute,
        config.displayNameAttribute,
        config.groupAttribute,
        "dn"
      ].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);

      const search = await client.search(config.searchBase, {
        scope: "sub",
        filter,
        attributes: attrs
      });

      const entry = search.searchEntries[0] as Record<string, unknown> | undefined;
      if (!entry) {
        throw new UnauthorizedException("Invalid LDAP credentials");
      }

      const userDn = String(entry.dn ?? "");
      if (!userDn) {
        throw new UnauthorizedException("LDAP user DN not found");
      }

      await client.bind(userDn, password);

      const ldapUsername = firstString(entry[config.usernameAttribute]) ?? username;
      const email = firstString(entry[config.emailAttribute]);
      const displayName = firstString(entry[config.displayNameAttribute]) ?? ldapUsername;
      const groups = manyStrings(entry[config.groupAttribute]);
      const mapping = (config.groupRoleMapping ?? {}) as Record<string, AppRole>;

      let role: AppRole = "USER";
      for (const group of groups) {
        const mapped = mapping[group];
        if (mapped === "SUPER_ADMIN") {
          role = "SUPER_ADMIN";
          break;
        }
        if (mapped === "ADMIN") {
          role = "ADMIN";
        }
      }

      return {
        username: ldapUsername,
        email,
        displayName,
        role
      };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}

function escapeLdapValue(value: string): string {
  return value.replace(/[\\*()\x00]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string");
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

function manyStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}
