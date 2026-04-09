import type { PutObjectCommandInput, S3Client } from "@aws-sdk/client-s3";

export interface GarageS3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  maxAttempts?: number;
}

export interface FileEntry {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  eTag: string | null;
  contentType: string | null;
  kind: "file";
}

export interface FolderEntry {
  key: string;
  name: string;
  kind: "folder";
}

export type ListedEntry = FileEntry | FolderEntry;

export interface ListFilesOptions {
  continuationToken?: string;
  recursive?: boolean;
  pageSize?: number;
  sortBy?: "name" | "size" | "lastModified" | "type";
  sortOrder?: "asc" | "desc";
}

export interface ListFilesResult {
  bucket: string;
  prefix: string;
  entries: ListedEntry[];
  continuationToken: string | null;
  isTruncated: boolean;
}

export interface RenameProgress {
  total: number;
  processed: number;
  copied: number;
  deleted: number;
  failed: number;
  currentKey?: string;
}

export interface RenameItemError {
  sourceKey: string;
  destinationKey: string;
  stage: "copy" | "delete";
  message: string;
}

export interface RenameResult {
  bucket: string;
  oldPrefixOrKey: string;
  newPrefixOrKey: string;
  copied: number;
  deleted: number;
  failed: RenameItemError[];
}

export interface DeleteResult {
  bucket: string;
  deleted: number;
  failed: { key: string; message: string }[];
}

export interface FolderStats {
  bucket: string;
  prefix: string;
  totalSize: number;
  objectCount: number;
  folderCount: number;
  latestModified: string | null;
  extensionBreakdown: Record<string, { count: number; size: number }>;
}

export interface SearchResult {
  bucket: string;
  prefix: string;
  term: string;
  entries: ListedEntry[];
  continuationToken: string | null;
  scanned: number;
}

export interface PreviewResult {
  bucket: string;
  key: string;
  url: string;
  mode: "inline" | "download";
  previewType: "image" | "video" | "audio" | "text" | "pdf" | "download";
  contentType: string;
  expiresIn: number;
}

export interface MultipartPartSpec {
  partNumber: number;
  url: string;
  expiresIn: number;
}

export interface MultipartInitRequest {
  bucket: string;
  key: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface MultipartInitResult {
  bucket: string;
  key: string;
  uploadId: string;
}

export interface MultipartCompletePart {
  partNumber: number;
  eTag: string;
}

export interface MultipartCompleteRequest {
  bucket: string;
  key: string;
  uploadId: string;
  parts: MultipartCompletePart[];
}

export interface MultipartCompleteResult {
  bucket: string;
  key: string;
  uploadId: string;
  eTag?: string;
}

export interface UploadInput {
  s3: S3Client;
  bucket: string;
  key: string;
  body: NonNullable<PutObjectCommandInput["Body"]>;
  contentType?: string;
  onProgress?: (loaded: number, total?: number) => void;
}

export interface AdminClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export interface GarageBucketSummary {
  id: string;
  created: string;
  globalAliases: string[];
  localAliases: Array<{ accessKeyId: string; alias: string }>;
}

export interface GarageBucketInfo {
  id: string;
  created: string;
  globalAliases: string[];
  websiteAccess: boolean;
  objects: number;
  bytes: number;
}

export interface GarageClusterHealth {
  status: "healthy" | "degraded" | "unavailable" | string;
  knownNodes: number;
  connectedNodes: number;
  storageNodes: number;
  storageNodesUp: number;
  partitions: number;
  partitionsQuorum: number;
  partitionsAllOk: number;
}
