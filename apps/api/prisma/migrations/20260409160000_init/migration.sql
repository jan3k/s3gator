-- Migration generated manually for bootstrap.
-- Recommended: run `pnpm --filter @s3gator/api prisma migrate dev` to regenerate if schema changes.

CREATE TYPE "AppRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');
CREATE TYPE "AuthSource" AS ENUM ('LOCAL', 'LDAP');
CREATE TYPE "UploadSessionStatus" AS ENUM ('INITIATED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED', 'FAILED');

CREATE TABLE "Role" (
  "id" TEXT PRIMARY KEY,
  "code" "AppRole" NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Permission" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "RolePermission" (
  "id" TEXT PRIMARY KEY,
  "roleId" TEXT NOT NULL REFERENCES "Role"("id") ON DELETE CASCADE,
  "permissionId" TEXT NOT NULL REFERENCES "Permission"("id") ON DELETE CASCADE,
  UNIQUE ("roleId", "permissionId")
);

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL UNIQUE,
  "email" TEXT UNIQUE,
  "displayName" TEXT,
  "roleId" TEXT NOT NULL REFERENCES "Role"("id"),
  "source" "AuthSource" NOT NULL DEFAULT 'LOCAL',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "LocalCredential" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "LdapConfig" (
  "id" TEXT PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "url" TEXT,
  "bindDn" TEXT,
  "bindPasswordEncrypted" TEXT,
  "searchBase" TEXT,
  "searchFilter" TEXT NOT NULL DEFAULT '(uid={{username}})',
  "usernameAttribute" TEXT NOT NULL DEFAULT 'uid',
  "emailAttribute" TEXT NOT NULL DEFAULT 'mail',
  "displayNameAttribute" TEXT NOT NULL DEFAULT 'cn',
  "groupAttribute" TEXT NOT NULL DEFAULT 'memberOf',
  "groupRoleMapping" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "tlsRejectUnauthorized" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "csrfToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "GarageConnection" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "endpoint" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "forcePathStyle" BOOLEAN NOT NULL DEFAULT TRUE,
  "accessKeyEncrypted" TEXT NOT NULL,
  "secretKeyEncrypted" TEXT NOT NULL,
  "adminApiUrl" TEXT,
  "adminTokenEncrypted" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "healthStatus" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Bucket" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "garageBucketId" TEXT,
  "connectionId" TEXT REFERENCES "GarageConnection"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "UserBucketPermission" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "bucketId" TEXT NOT NULL REFERENCES "Bucket"("id") ON DELETE CASCADE,
  "permissionId" TEXT NOT NULL REFERENCES "Permission"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "bucketId", "permissionId")
);

CREATE TABLE "AppSetting" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "actorUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "UploadSession" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "bucketId" TEXT NOT NULL REFERENCES "Bucket"("id") ON DELETE CASCADE,
  "objectKey" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "status" "UploadSessionStatus" NOT NULL DEFAULT 'INITIATED',
  "partsMeta" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "error" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ NOT NULL
);

INSERT INTO "LdapConfig" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
