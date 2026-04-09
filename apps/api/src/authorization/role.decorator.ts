import { SetMetadata } from "@nestjs/common";
import type { AppRole } from "@s3gator/shared";

export const REQUIRED_ROLES = Symbol("REQUIRED_ROLES");

export const RequireRoles = (...roles: AppRole[]) => SetMetadata(REQUIRED_ROLES, roles);
