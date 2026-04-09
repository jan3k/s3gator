import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AppRole, BucketPermission, SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  requireRole(user: SessionUser | undefined, allowed: AppRole[]): void {
    if (!user) {
      throw new ForbiddenException("Not authenticated");
    }

    if (!allowed.includes(user.role)) {
      throw new ForbiddenException("Insufficient role");
    }
  }

  async requireBucketPermission(
    user: SessionUser | undefined,
    bucketName: string | undefined,
    permission: BucketPermission
  ): Promise<void> {
    if (!user) {
      throw new ForbiddenException("Not authenticated");
    }

    if (user.role === "SUPER_ADMIN") {
      return;
    }

    if (!bucketName) {
      throw new ForbiddenException("Missing bucket scope");
    }

    const bucket = await this.prisma.bucket.findUnique({
      where: { name: bucketName },
      select: { id: true }
    });

    if (!bucket) {
      throw new ForbiddenException("Unknown bucket");
    }

    const wherePermission =
      permission === "bucket:list"
        ? { userId: user.id, bucketId: bucket.id }
        : {
            userId: user.id,
            bucketId: bucket.id,
            permission: {
              code: permission
            }
          };

    const grant = await this.prisma.userBucketPermission.findFirst({
      where: wherePermission,
      select: { id: true }
    });

    if (!grant) {
      throw new ForbiddenException(`Missing permission ${permission} on bucket ${bucketName}`);
    }
  }

  async listAccessibleBuckets(user: SessionUser) {
    if (user.role === "SUPER_ADMIN") {
      return this.prisma.bucket.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          garageBucketId: true,
          connectionId: true,
          createdAt: true,
          updatedAt: true
        }
      });
    }

    return this.prisma.bucket.findMany({
      where: {
        userPermissions: {
          some: {
            userId: user.id
          }
        }
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        garageBucketId: true,
        connectionId: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }
}
