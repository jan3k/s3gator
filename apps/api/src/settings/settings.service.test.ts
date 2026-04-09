import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsService } from "./settings.service.js";

const prisma = {
  ldapConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  },
  appSetting: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  }
};

const cryptoService = {
  encrypt: vi.fn((value: string) => `enc(${value})`)
};

const auditService = {
  record: vi.fn()
};

describe("SettingsService audit", () => {
  let service: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SettingsService(prisma as never, cryptoService as never, auditService as never);
  });

  it("writes audit log for LDAP settings update without leaking bind password", async () => {
    prisma.ldapConfig.findUnique.mockResolvedValue({
      id: "default",
      enabled: false,
      bindPasswordEncrypted: null
    });
    prisma.ldapConfig.upsert.mockResolvedValue({});
    prisma.ldapConfig.findUnique.mockResolvedValueOnce({
      id: "default",
      enabled: false,
      bindPasswordEncrypted: null
    });
    prisma.ldapConfig.findUnique.mockResolvedValueOnce({
      id: "default",
      enabled: true,
      url: "ldap://ldap.example.local:389",
      bindDn: "cn=admin,dc=example,dc=org",
      bindPasswordEncrypted: "enc(secret)",
      searchBase: "dc=example,dc=org",
      searchFilter: "(uid={{username}})",
      usernameAttribute: "uid",
      emailAttribute: "mail",
      displayNameAttribute: "cn",
      groupAttribute: "memberOf",
      groupRoleMapping: {},
      tlsRejectUnauthorized: true
    });

    await service.updateLdapConfig(
      {
        id: "actor-super",
        username: "super",
        email: "super@example.com",
        displayName: "Super",
        role: "SUPER_ADMIN"
      },
      {
        enabled: true,
        url: "ldap://ldap.example.local:389",
        bindDn: "cn=admin,dc=example,dc=org",
        bindPassword: "plaintext-should-not-be-logged",
        searchBase: "dc=example,dc=org",
        searchFilter: "(uid={{username}})",
        tlsRejectUnauthorized: true
      }
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "settings.ldap.update",
        metadata: expect.objectContaining({
          bindPasswordUpdated: true
        })
      })
    );

    const loggedMetadata = auditService.record.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(loggedMetadata?.bindPassword).toBeUndefined();
  });
});
