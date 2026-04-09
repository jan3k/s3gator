import { S3Client } from "@aws-sdk/client-s3";
import type { GarageS3Config } from "./types.js";

export function createGarageS3Client(config: GarageS3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? true,
    maxAttempts: config.maxAttempts ?? 3,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}
