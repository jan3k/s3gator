import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { SessionUser, BucketPermission } from "@s3gator/shared";
import { GarageAdminApiV2Client } from "@s3gator/s3";
import { PrismaService } from "@/prisma/prisma.service.js";
import { AuthorizationService } from "@/authorization/authorization.service.js";
import { ConnectionsService } from "@/connections/connections.service.js";
import { AuditService } from "@/audit/audit.service.js";

@Injectable()
export class BucketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly connectionsService: ConnectionsService,
    private readonly auditService: AuditService
  ) {}

  async listForUser(user: SessionUser) {
    return this.authorizationService.listAccessibleBuckets(user);
  }

  async listAll() {
    return this.prisma.bucket.findMany({
      orderBy: { name: "asc" },
      include: {
        connection: {
          select: {
            id: true,
            name: true,
            endpoint: true,
            region: true,
            forcePathStyle: true,
            isDefault: true
          }
        }
      }
    });
  }

  async syncFromGarage(actor: SessionUser, ipAddress?: string) {
    const conn = await this.connectionsService.getDefaultConnectionWithSecrets();
    if (!conn.adminApiUrl || !conn.adminToken) {
      throw new NotFoundException("Default connection does not include Admin API credentials");
    }

    const adminClient = new GarageAdminApiV2Client({
      baseUrl: conn.adminApiUrl,
      token: conn.adminToken
    });

    const remoteBuckets = await adminClient.listBuckets();
    const upserts = [];

    for (const bucket of remoteBuckets) {
      const preferredName = bucket.globalAliases[0] ?? bucket.id;
      upserts.push(
        this.prisma.bucket.upsert({
          where: { name: preferredName },
          create: {
            name: preferredName,
            garageBucketId: bucket.id,
            connectionId: conn.id
          },
          update: {
            garageBucketId: bucket.id,
            connectionId: conn.id
          }
        })
      );
    }

    await Promise.all(upserts);

    await this.auditService.record({
      actor,
      action: "bucket.sync",
      entityType: "bucket",
      metadata: {
        synced: remoteBuckets.length,
        connectionId: conn.id
      },
      ipAddress
    });

    return {
      synced: remoteBuckets.length
    };
  }

  async setUserBucketPermissions(
    actor: SessionUser,
    userId: string,
    bucketId: string,
    permissions: BucketPermission[],
    ipAddress?: string
  ) {
    const bucket = await this.prisma.bucket.findUnique({ where: { id: bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true
      }
    });

    if (!targetUser) {
      throw new NotFoundException("Target user not found");
    }

    if (actor.role === "ADMIN" && targetUser.role.code !== "USER") {
      throw new ForbiddenException("ADMIN can only manage bucket grants for USER accounts");
    }

    const permissionRows = await this.prisma.permission.findMany({
      where: {
        code: { in: permissions }
      }
    });

    await this.prisma.userBucketPermission.deleteMany({
      where: {
        userId,
        bucketId
      }
    });

    if (permissionRows.length) {
      await this.prisma.userBucketPermission.createMany({
        data: permissionRows.map((permission) => ({
          userId,
          bucketId,
          permissionId: permission.id
        }))
      });
    }

    await this.auditService.record({
      actor,
      action: "bucket.grants.update",
      entityType: "bucket",
      entityId: bucket.id,
      metadata: {
        bucketName: bucket.name,
        targetUserId: userId,
        targetUsername: targetUser.username,
        permissions
      },
      ipAddress
    });

    return this.getBucketGrants(bucketId);
  }

  async getBucketGrants(bucketId: string) {
    return this.prisma.userBucketPermission.findMany({
      where: { bucketId },
      include: {
        permission: true,
        user: {
          include: {
            role: true
          }
        }
      },
      orderBy: [{ user: { username: "asc" } }, { permission: { code: "asc" } }]
    });
  }
}
