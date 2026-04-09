import type { AppRole } from "./roles.js";
import type { BucketPermission } from "./permissions.js";

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: AppRole;
  displayName: string | null;
}

export interface BucketGrant {
  userId: string;
  bucketId: string;
  permissions: BucketPermission[];
}

export interface GarageConnectionPublic {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  adminApiUrl: string | null;
  isDefault: boolean;
  healthStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationQuery {
  limit?: number;
  cursor?: string | null;
}
