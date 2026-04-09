import { SetMetadata } from "@nestjs/common";
import type { BucketPermission } from "@s3gator/shared";

export const REQUIRED_BUCKET_PERMISSION = Symbol("REQUIRED_BUCKET_PERMISSION");

export interface BucketPermissionRequirement {
  permission: BucketPermission;
  bucketField?: string;
  source?: "query" | "body" | "params";
}

export const RequireBucketPermission = (
  permission: BucketPermission,
  bucketField = "bucket",
  source: BucketPermissionRequirement["source"] = "query"
) =>
  SetMetadata(REQUIRED_BUCKET_PERMISSION, {
    permission,
    bucketField,
    source
  } satisfies BucketPermissionRequirement);
