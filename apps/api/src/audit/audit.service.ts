import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";
import { getRequestContext } from "@/common/request-context.js";

export interface ListAuditArchiveInput {
  limit?: number;
  offset?: number;
  search?: string;
  action?: string;
  entityType?: string;
  correlationId?: string;
  from?: string;
  to?: string;
}

export interface AuditArchiveListResult {
  items: Array<{
    id: string;
    sourceAuditLogId: string | null;
    actorUserId: string | null;
    correlationId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    metadata: Record<string, unknown> | null;
    ipAddress: string | null;
    createdAt: string;
    archivedAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
}

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
    const context = getRequestContext();

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actor?.id,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: sanitizeAuditMetadata(
          attachContextMetadata(input.metadata, context)
        ) as object | undefined,
        ipAddress: input.ipAddress
      }
    });
  }

  async list(input: {
    limit?: number;
    search?: string;
    action?: string;
    entityType?: string;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);

    const where = {
      action: input.action
        ? {
            contains: input.action,
            mode: "insensitive" as const
          }
        : undefined,
      entityType: input.entityType
        ? {
            contains: input.entityType,
            mode: "insensitive" as const
          }
        : undefined,
      OR: input.search
        ? [
            {
              action: {
                contains: input.search,
                mode: "insensitive" as const
              }
            },
            {
              entityType: {
                contains: input.search,
                mode: "insensitive" as const
              }
            },
            {
              entityId: {
                contains: input.search,
                mode: "insensitive" as const
              }
            }
          ]
        : undefined
    };

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        actorUser: {
          select: { id: true, username: true, email: true }
        }
      }
    });
  }

  async listArchive(input: ListAuditArchiveInput): Promise<AuditArchiveListResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const offset = Math.max(input.offset ?? 0, 0);
    const fromDate = parseIsoDate(input.from);
    const toDate = parseIsoDate(input.to);

    const where: Prisma.AuditLogArchiveWhereInput = {
      action: input.action
        ? {
            contains: input.action,
            mode: "insensitive"
          }
        : undefined,
      entityType: input.entityType
        ? {
            contains: input.entityType,
            mode: "insensitive"
          }
        : undefined,
      correlationId: input.correlationId
        ? {
            equals: input.correlationId
          }
        : undefined,
      createdAt:
        fromDate || toDate
          ? {
              gte: fromDate ?? undefined,
              lte: toDate ?? undefined
            }
          : undefined,
      OR: input.search
        ? [
            {
              action: {
                contains: input.search,
                mode: "insensitive"
              }
            },
            {
              entityType: {
                contains: input.search,
                mode: "insensitive"
              }
            },
            {
              entityId: {
                contains: input.search,
                mode: "insensitive"
              }
            }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLogArchive.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit
      }),
      this.prisma.auditLogArchive.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        sourceAuditLogId: item.sourceAuditLogId,
        actorUserId: item.actorUserId,
        correlationId: item.correlationId,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        metadata: (item.metadata as Record<string, unknown> | null) ?? null,
        ipAddress: item.ipAddress,
        createdAt: item.createdAt.toISOString(),
        archivedAt: item.archivedAt.toISOString()
      })),
      total,
      limit,
      offset
    };
  }
}

const REDACT_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "credential",
  "accesskey",
  "bindpassword"
] as const;

function sanitizeAuditMetadata(input: unknown): unknown {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeAuditMetadata(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const lowered = key.toLowerCase();
      if (REDACT_KEYS.some((segment) => lowered.includes(segment))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeAuditMetadata(value);
      }
    }

    return result;
  }

  return String(input);
}

function attachContextMetadata(
  metadata: unknown,
  context: ReturnType<typeof getRequestContext>
): unknown {
  if (!context) {
    return metadata;
  }

  const contextPayload = {
    requestId: context.requestId,
    correlationId: context.correlationId,
    source: context.source,
    jobId: context.jobId ?? null,
    userId: context.userId ?? null
  };

  if (metadata === undefined) {
    return {
      _context: contextPayload
    };
  }

  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return {
      ...(metadata as Record<string, unknown>),
      _context: contextPayload
    };
  }

  return {
    value: metadata,
    _context: contextPayload
  };
}

function parseIsoDate(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}
