import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import type { GarageConnection } from "@prisma/client";
import { createGarageS3Client, GarageAdminApiV2Client } from "@s3gator/s3";
import type { GarageConnectionPublic, SessionUser } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";
import { CryptoService } from "@/common/crypto.service.js";
import { AuditService } from "@/audit/audit.service.js";

interface UpsertConnectionInput {
  name: string;
  endpoint: string;
  region: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  adminApiUrl?: string | null;
  adminToken?: string | null;
  isDefault?: boolean;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService
  ) {}

  async listPublic(): Promise<GarageConnectionPublic[]> {
    const items = await this.prisma.garageConnection.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }]
    });

    return items.map((item) => this.toPublic(item));
  }

  async create(actor: SessionUser, input: UpsertConnectionInput, ipAddress?: string): Promise<GarageConnectionPublic> {
    if (input.isDefault) {
      await this.prisma.garageConnection.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
    }

    const created = await this.prisma.garageConnection.create({
      data: {
        name: input.name,
        endpoint: input.endpoint,
        region: input.region,
        forcePathStyle: input.forcePathStyle ?? true,
        accessKeyEncrypted: this.cryptoService.encrypt(input.accessKeyId),
        secretKeyEncrypted: this.cryptoService.encrypt(input.secretAccessKey),
        adminApiUrl: input.adminApiUrl ?? null,
        adminTokenEncrypted: input.adminToken ? this.cryptoService.encrypt(input.adminToken) : null,
        isDefault: input.isDefault ?? false
      }
    });

    await this.auditService.record({
      actor,
      action: "connection.create",
      entityType: "garage_connection",
      entityId: created.id,
      metadata: {
        name: created.name,
        endpoint: created.endpoint,
        region: created.region,
        forcePathStyle: created.forcePathStyle,
        isDefault: created.isDefault,
        hasAdminApi: Boolean(created.adminApiUrl),
        hasAdminToken: Boolean(created.adminTokenEncrypted)
      },
      ipAddress
    });

    return this.toPublic(created);
  }

  async update(
    actor: SessionUser,
    id: string,
    input: Partial<UpsertConnectionInput>,
    ipAddress?: string
  ): Promise<GarageConnectionPublic> {
    const existing = await this.prisma.garageConnection.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Connection not found");
    }

    if (input.isDefault) {
      await this.prisma.garageConnection.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false }
      });
    }

    const updated = await this.prisma.garageConnection.update({
      where: { id },
      data: {
        name: input.name,
        endpoint: input.endpoint,
        region: input.region,
        forcePathStyle: input.forcePathStyle,
        accessKeyEncrypted: input.accessKeyId ? this.cryptoService.encrypt(input.accessKeyId) : undefined,
        secretKeyEncrypted: input.secretAccessKey ? this.cryptoService.encrypt(input.secretAccessKey) : undefined,
        adminApiUrl: input.adminApiUrl,
        adminTokenEncrypted: input.adminToken
          ? this.cryptoService.encrypt(input.adminToken)
          : input.adminToken === null
            ? null
            : undefined,
        isDefault: input.isDefault
      }
    });

    await this.auditService.record({
      actor,
      action: "connection.update",
      entityType: "garage_connection",
      entityId: updated.id,
      metadata: {
        updatedFields: Object.keys(input),
        name: updated.name,
        endpoint: updated.endpoint,
        region: updated.region,
        forcePathStyle: updated.forcePathStyle,
        isDefault: updated.isDefault,
        hasAdminApi: Boolean(updated.adminApiUrl),
        hasAdminToken: Boolean(updated.adminTokenEncrypted)
      },
      ipAddress
    });

    return this.toPublic(updated);
  }

  async getDefaultConnectionWithSecrets() {
    let connection = await this.prisma.garageConnection.findFirst({ where: { isDefault: true } });

    if (!connection) {
      connection = await this.ensureEnvFallbackConnection();
    }

    if (!connection) {
      throw new NotFoundException("No Garage connection configured");
    }

    return {
      id: connection.id,
      name: connection.name,
      endpoint: connection.endpoint,
      region: connection.region,
      forcePathStyle: connection.forcePathStyle,
      accessKeyId: this.cryptoService.decrypt(connection.accessKeyEncrypted),
      secretAccessKey: this.cryptoService.decrypt(connection.secretKeyEncrypted),
      adminApiUrl: connection.adminApiUrl,
      adminToken: connection.adminTokenEncrypted ? this.cryptoService.decrypt(connection.adminTokenEncrypted) : null
    };
  }

  async healthCheck(actor: SessionUser, id: string, ipAddress?: string) {
    const item = await this.prisma.garageConnection.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException("Connection not found");
    }

    const s3 = createGarageS3Client({
      endpoint: item.endpoint,
      region: item.region,
      forcePathStyle: item.forcePathStyle,
      accessKeyId: this.cryptoService.decrypt(item.accessKeyEncrypted),
      secretAccessKey: this.cryptoService.decrypt(item.secretKeyEncrypted)
    });

    let s3Ok = false;
    let adminOk: boolean | null = null;
    let error: string | null = null;

    try {
      await s3.send(new ListBucketsCommand({}));
      s3Ok = true;
    } catch (err) {
      error = (err as Error).message;
    }

    if (item.adminApiUrl && item.adminTokenEncrypted) {
      try {
        const adminClient = new GarageAdminApiV2Client({
          baseUrl: item.adminApiUrl,
          token: this.cryptoService.decrypt(item.adminTokenEncrypted)
        });
        adminOk = await adminClient.healthCheck();
      } catch (err) {
        adminOk = false;
        error = error ?? (err as Error).message;
      }
    }

    await this.prisma.garageConnection.update({
      where: { id: item.id },
      data: {
        healthStatus: s3Ok && (adminOk === null || adminOk) ? "healthy" : "degraded"
      }
    });

    await this.auditService.record({
      actor,
      action: "connection.health.check",
      entityType: "garage_connection",
      entityId: item.id,
      metadata: {
        s3Ok,
        adminOk,
        result: s3Ok && (adminOk === null || adminOk) ? "healthy" : "degraded",
        error
      },
      ipAddress
    });

    return {
      id: item.id,
      s3Ok,
      adminOk,
      error
    };
  }

  private async ensureEnvFallbackConnection() {
    const endpoint = this.configService.get<string>("GARAGE_ENDPOINT");
    const accessKeyId = this.configService.get<string>("GARAGE_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>("GARAGE_SECRET_ACCESS_KEY");

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      return null;
    }

    const existing = await this.prisma.garageConnection.findUnique({ where: { name: "env-default" } });
    if (existing) {
      if (!existing.isDefault) {
        await this.prisma.garageConnection.update({
          where: { id: existing.id },
          data: { isDefault: true }
        });
      }
      return existing;
    }

    await this.prisma.garageConnection.updateMany({
      where: { isDefault: true },
      data: { isDefault: false }
    });

    return this.prisma.garageConnection.create({
      data: {
        name: "env-default",
        endpoint,
        region: this.configService.get<string>("GARAGE_REGION", "garage"),
        forcePathStyle: this.configService.get<boolean>("GARAGE_FORCE_PATH_STYLE", true),
        accessKeyEncrypted: this.cryptoService.encrypt(accessKeyId),
        secretKeyEncrypted: this.cryptoService.encrypt(secretAccessKey),
        adminApiUrl: this.configService.get<string>("GARAGE_ADMIN_API_URL") ?? null,
        adminTokenEncrypted: this.configService.get<string>("GARAGE_ADMIN_TOKEN")
          ? this.cryptoService.encrypt(this.configService.getOrThrow<string>("GARAGE_ADMIN_TOKEN"))
          : null,
        isDefault: true
      }
    });
  }

  private toPublic(item: GarageConnection): GarageConnectionPublic {
    return {
      id: item.id,
      name: item.name,
      endpoint: item.endpoint,
      region: item.region,
      forcePathStyle: item.forcePathStyle,
      adminApiUrl: item.adminApiUrl,
      isDefault: item.isDefault,
      healthStatus: item.healthStatus ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }
}
