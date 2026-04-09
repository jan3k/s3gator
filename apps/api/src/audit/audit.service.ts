import { Injectable } from "@nestjs/common";
import type { SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actor?: SessionUser;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: unknown;
    ipAddress?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actor?.id,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata as object | undefined,
        ipAddress: input.ipAddress
      }
    });
  }

  async list(limit = 200) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 1000),
      include: {
        actorUser: {
          select: { id: true, username: true, email: true }
        }
      }
    });
  }
}
