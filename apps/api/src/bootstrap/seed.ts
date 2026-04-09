import { PrismaClient, AuthSource } from "@prisma/client";
import argon2 from "argon2";
import { APP_ROLES, BUCKET_PERMISSIONS, PERMISSION_DESCRIPTIONS } from "@s3gator/shared";
import { createCipheriv, createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const roleByCode = new Map<string, string>();

  for (const roleCode of APP_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      create: {
        code: roleCode,
        name: roleCode.replace(/_/g, " ")
      },
      update: {
        name: roleCode.replace(/_/g, " ")
      }
    });

    roleByCode.set(roleCode, role.id);
  }

  const permissionByCode = new Map<string, string>();

  for (const code of BUCKET_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { code },
      create: {
        code,
        description: PERMISSION_DESCRIPTIONS[code]
      },
      update: {
        description: PERMISSION_DESCRIPTIONS[code]
      }
    });

    permissionByCode.set(code, permission.id);
  }

  await prisma.rolePermission.deleteMany({});

  const superAdminRoleId = roleByCode.get("SUPER_ADMIN");
  const adminRoleId = roleByCode.get("ADMIN");

  if (superAdminRoleId) {
    await prisma.rolePermission.createMany({
      data: [...permissionByCode.values()].map((permissionId) => ({
        roleId: superAdminRoleId,
        permissionId
      }))
    });
  }

  if (adminRoleId) {
    await prisma.rolePermission.createMany({
      data: [...permissionByCode.values()].map((permissionId) => ({
        roleId: adminRoleId,
        permissionId
      }))
    });
  }

  await prisma.ldapConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });

  await prisma.appSetting.upsert({
    where: { key: "auth_mode" },
    create: {
      key: "auth_mode",
      value: "local"
    },
    update: {}
  });

  const username = process.env.DEFAULT_SUPER_ADMIN_USERNAME ?? "admin";
  const email = process.env.DEFAULT_SUPER_ADMIN_EMAIL ?? "admin@example.local";
  const password = process.env.DEFAULT_SUPER_ADMIN_PASSWORD ?? "change-me-now-please";

  const superRoleId = roleByCode.get("SUPER_ADMIN");
  if (!superRoleId) {
    throw new Error("SUPER_ADMIN role missing");
  }

  const user = await prisma.user.upsert({
    where: { username },
    create: {
      username,
      email,
      displayName: "Bootstrap Admin",
      roleId: superRoleId,
      source: AuthSource.LOCAL,
      isActive: true
    },
    update: {
      email,
      roleId: superRoleId,
      isActive: true
    }
  });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.localCredential.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      passwordHash
    },
    update: {
      passwordHash
    }
  });

  await seedEnvDefaultConnection();

  console.log("Seed complete");
}

async function seedEnvDefaultConnection() {
  const endpoint = process.env.GARAGE_ENDPOINT;
  const accessKeyId = process.env.GARAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.GARAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return;
  }

  const key = normalizeKeyMaterial(process.env.APP_ENCRYPTION_KEY ?? "development-key-do-not-use");

  await prisma.garageConnection.updateMany({
    where: { isDefault: true },
    data: { isDefault: false }
  });

  await prisma.garageConnection.upsert({
    where: { name: "env-default" },
    create: {
      name: "env-default",
      endpoint,
      region: process.env.GARAGE_REGION ?? "garage",
      forcePathStyle: process.env.GARAGE_FORCE_PATH_STYLE !== "false",
      accessKeyEncrypted: encrypt(accessKeyId, key),
      secretKeyEncrypted: encrypt(secretAccessKey, key),
      adminApiUrl: process.env.GARAGE_ADMIN_API_URL ?? null,
      adminTokenEncrypted: process.env.GARAGE_ADMIN_TOKEN
        ? encrypt(process.env.GARAGE_ADMIN_TOKEN, key)
        : null,
      isDefault: true
    },
    update: {
      endpoint,
      region: process.env.GARAGE_REGION ?? "garage",
      forcePathStyle: process.env.GARAGE_FORCE_PATH_STYLE !== "false",
      accessKeyEncrypted: encrypt(accessKeyId, key),
      secretKeyEncrypted: encrypt(secretAccessKey, key),
      adminApiUrl: process.env.GARAGE_ADMIN_API_URL ?? null,
      adminTokenEncrypted: process.env.GARAGE_ADMIN_TOKEN
        ? encrypt(process.env.GARAGE_ADMIN_TOKEN, key)
        : null,
      isDefault: true
    }
  });
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function normalizeKeyMaterial(value: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  try {
    const maybe = Buffer.from(value, "base64");
    if (maybe.length >= 32) {
      return maybe.subarray(0, 32);
    }
  } catch {
    // fallback below
  }

  return createHash("sha256").update(value).digest();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
