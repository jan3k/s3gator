import { Injectable, NotFoundException } from "@nestjs/common";
import argon2 from "argon2";
import { AuthSource } from "@prisma/client";
import type { AppRole } from "@s3gator/shared";
import { PrismaService } from "@/prisma/prisma.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      orderBy: { username: "asc" },
      include: {
        role: true
      }
    });
  }

  async createLocal(input: {
    username: string;
    email?: string;
    displayName?: string;
    password: string;
    role: AppRole;
  }) {
    const role = await this.prisma.role.findUnique({ where: { code: input.role } });
    if (!role) {
      throw new NotFoundException("Role not found");
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    return this.prisma.user.create({
      data: {
        username: input.username,
        email: input.email,
        displayName: input.displayName,
        roleId: role.id,
        source: AuthSource.LOCAL,
        localCreds: {
          create: {
            passwordHash
          }
        }
      },
      include: {
        role: true
      }
    });
  }

  async updateUser(
    userId: string,
    input: Partial<{
      email: string | null;
      displayName: string | null;
      role: AppRole;
      isActive: boolean;
      password: string;
    }>
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        localCreds: true
      }
    });

    if (!existing) {
      throw new NotFoundException("User not found");
    }

    const role = input.role
      ? await this.prisma.role.findUnique({
          where: { code: input.role }
        })
      : null;

    if (input.role && !role) {
      throw new NotFoundException("Role not found");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: input.email,
        displayName: input.displayName,
        isActive: input.isActive,
        roleId: role?.id
      }
    });

    if (input.password) {
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      if (existing.localCreds) {
        await this.prisma.localCredential.update({
          where: { userId },
          data: { passwordHash }
        });
      } else {
        await this.prisma.localCredential.create({
          data: {
            userId,
            passwordHash
          }
        });
      }
    }

    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    });
  }
}
