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

  async listAll(actor: SessionUser) {
    if (actor.role === "SUPER_ADMIN") {
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

    if (actor.role === "ADMIN") {
      return this.prisma.bucket.findMany({
        where: {
          adminScopes: {
            some: {
              adminUserId: actor.id
            }
          }
        },
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

    throw new ForbiddenException("Insufficient role");
  }

  async runSyncFromGarage(actor: SessionUser, ipAddress?: string) {
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
    await this.assertActorCanManageBucket(actor, bucketId);

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

    return this.getBucketGrants(actor, bucketId);
  }

  async getBucketGrants(actor: SessionUser, bucketId: string) {
    await this.assertActorCanManageBucket(actor, bucketId);

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

  async setAdminScopes(
    actor: SessionUser,
    adminUserId: string,
    bucketIds: string[],
    ipAddress?: string
  ) {
    if (actor.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only SUPER_ADMIN can manage admin scopes");
    }

    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      include: { role: true }
    });
    if (!adminUser) {
      throw new NotFoundException("Admin user not found");
    }
    if (adminUser.role.code !== "ADMIN") {
      throw new ForbiddenException("Scopes can only be assigned to ADMIN users");
    }

    await this.prisma.adminBucketScope.deleteMany({
      where: {
        adminUserId
      }
    });

    if (bucketIds.length) {
      await this.prisma.adminBucketScope.createMany({
        data: bucketIds.map((bucketId) => ({
          adminUserId,
          bucketId
        }))
      });
    }

    await this.auditService.record({
      actor,
      action: "admin.scope.update",
      entityType: "user",
      entityId: adminUserId,
      metadata: {
        bucketIds
      },
      ipAddress
    });

    return this.getAdminScopes(actor, adminUserId);
  }

  async getAdminScopes(actor: SessionUser, adminUserId: string) {
    if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN") {
      throw new ForbiddenException("Insufficient role");
    }

    if (actor.role === "ADMIN" && actor.id !== adminUserId) {
      throw new ForbiddenException("ADMIN can view only own scope");
    }

    const scopes = await this.prisma.adminBucketScope.findMany({
      where: { adminUserId },
      include: {
        bucket: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        bucket: {
          name: "asc"
        }
      }
    });

    return scopes.map((scope) => ({
      bucketId: scope.bucketId,
      bucketName: scope.bucket.name
    }));
  }

  async assertActorCanManageBucket(actor: SessionUser, bucketId: string): Promise<void> {
    if (actor.role === "SUPER_ADMIN") {
      return;
    }

    if (actor.role !== "ADMIN") {
      throw new ForbiddenException("Insufficient role");
    }

    const scope = await this.prisma.adminBucketScope.findFirst({
      where: {
        adminUserId: actor.id,
        bucketId
      },
      select: {
        id: true
      }
    });

    if (!scope) {
      throw new ForbiddenException("ADMIN is not scoped to this bucket");
    }
  }
}
