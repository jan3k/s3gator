import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  type _Object,
  type S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  baseNameFromKey,
  inferContentTypeFromKey,
  inferPreviewType,
  mapWithConcurrency,
  normalizeKey,
  normalizePrefix
} from "./utils.js";
import type {
  DeleteResult,
  FileEntry,
  FolderEntry,
  FolderStats,
  ListFilesOptions,
  ListFilesResult,
  MultipartCompleteRequest,
  MultipartCompleteResult,
  MultipartInitRequest,
  MultipartInitResult,
  MultipartPartSpec,
  PreviewResult,
  RenameProgress,
  RenameResult,
  SearchResult,
  UploadInput
} from "./types.js";

export async function listFiles(
  s3: S3Client,
  prefix: string,
  bucket: string,
  opts: ListFilesOptions = {}
): Promise<ListFilesResult> {
  const normalizedPrefix = prefix ? normalizePrefix(prefix) : "";

  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizedPrefix,
      Delimiter: opts.recursive ? undefined : "/",
      ContinuationToken: opts.continuationToken,
      MaxKeys: opts.pageSize ?? 100
    })
  );

  const folders: FolderEntry[] = (response.CommonPrefixes ?? [])
    .map((item) => item.Prefix)
    .filter((value): value is string => Boolean(value))
    .map((folderPrefix) => ({
      kind: "folder",
      key: folderPrefix,
      name: baseNameFromKey(folderPrefix)
    }));

  const files: FileEntry[] = (response.Contents ?? [])
    .filter((item): item is _Object & { Key: string } => Boolean(item.Key))
    .filter((item) => item.Key !== normalizedPrefix)
    .map((item) => ({
      kind: "file",
      key: item.Key,
      name: baseNameFromKey(item.Key),
      size: item.Size ?? 0,
      lastModified: item.LastModified?.toISOString() ?? null,
      eTag: item.ETag ?? null,
      contentType: null
    }));

  const entries = [...folders, ...files];
  const sortBy = opts.sortBy ?? "name";
  const sortOrder = opts.sortOrder ?? "asc";

  entries.sort((a, b) => {
    if (sortBy === "type") {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    }

    if (sortBy === "size") {
      const aSize = a.kind === "file" ? a.size : -1;
      const bSize = b.kind === "file" ? b.size : -1;
      return aSize - bSize;
    }

    if (sortBy === "lastModified") {
      const aDate = a.kind === "file" ? Date.parse(a.lastModified ?? "1970-01-01") : 0;
      const bDate = b.kind === "file" ? Date.parse(b.lastModified ?? "1970-01-01") : 0;
      return aDate - bDate;
    }

    return a.name.localeCompare(b.name);
  });

  if (sortOrder === "desc") {
    entries.reverse();
  }

  return {
    bucket,
    prefix: normalizedPrefix,
    entries,
    continuationToken: response.NextContinuationToken ?? null,
    isTruncated: Boolean(response.IsTruncated)
  };
}

export async function addFolder(s3: S3Client, folderPath: string, bucket: string): Promise<{ key: string }> {
  const key = normalizePrefix(folderPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: ""
    })
  );

  return { key };
}

export async function deleteFileOrFolder(s3: S3Client, key: string, bucket: string): Promise<DeleteResult> {
  const normalized = normalizeKey(key);
  if (normalized.endsWith("/")) {
    return deleteFolderByPrefix(s3, normalized, bucket);
  }

  const failed: Array<{ key: string; message: string }> = [];
  let deleted = 0;

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: normalized
      })
    );
    deleted += 1;
  } catch (error) {
    failed.push({ key: normalized, message: (error as Error).message });
  }

  const folderProbe = await listObjectKeys(s3, bucket, normalizePrefix(normalized), undefined, 1);
  if (folderProbe.objects.length > 0) {
    const folderDeleted = await deleteFolderByPrefix(s3, normalizePrefix(normalized), bucket);
    deleted += folderDeleted.deleted;
    failed.push(...folderDeleted.failed);
  }

  return {
    bucket,
    deleted,
    failed
  };
}

export async function renameFileOrFolder(
  s3: S3Client,
  oldKey: string,
  newKey: string,
  bucket: string,
  onProgress?: (state: RenameProgress) => void
): Promise<RenameResult> {
  const normalizedOld = normalizeKey(oldKey);
  const normalizedNew = normalizeKey(newKey);

  const folderRename = normalizedOld.endsWith("/") || normalizedNew.endsWith("/");
  if (folderRename) {
    return renameFolder(s3, normalizePrefix(normalizedOld), normalizePrefix(normalizedNew), bucket, onProgress);
  }

  const failed: RenameResult["failed"] = [];
  let copied = 0;
  let deleted = 0;

  const copySource = `${bucket}/${encodeURIComponent(normalizedOld).replace(/%2F/g, "/")}`;

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: normalizedNew,
        CopySource: copySource
      })
    );
    copied += 1;
  } catch (error) {
    failed.push({
      sourceKey: normalizedOld,
      destinationKey: normalizedNew,
      stage: "copy",
      message: (error as Error).message
    });
  }

  if (!failed.length) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: normalizedOld
        })
      );
      deleted += 1;
    } catch (error) {
      failed.push({
        sourceKey: normalizedOld,
        destinationKey: normalizedNew,
        stage: "delete",
        message: (error as Error).message
      });
    }
  }

  return {
    bucket,
    oldPrefixOrKey: normalizedOld,
    newPrefixOrKey: normalizedNew,
    copied,
    deleted,
    failed
  };
}

export async function renameFolder(
  s3: S3Client,
  oldPrefix: string,
  newPrefix: string,
  bucket: string,
  onProgress?: (state: RenameProgress) => void,
  concurrency = 5
): Promise<RenameResult> {
  const sourcePrefix = normalizePrefix(oldPrefix);
  const targetPrefix = normalizePrefix(newPrefix);

  if (sourcePrefix === targetPrefix) {
    return {
      bucket,
      oldPrefixOrKey: sourcePrefix,
      newPrefixOrKey: targetPrefix,
      copied: 0,
      deleted: 0,
      failed: []
    };
  }

  const keys = await listAllKeys(s3, bucket, sourcePrefix);
  const failed: RenameResult["failed"] = [];
  let copied = 0;
  let deleted = 0;

  const progress: RenameProgress = {
    total: keys.length,
    processed: 0,
    copied: 0,
    deleted: 0,
    failed: 0
  };

  onProgress?.(progress);

  await mapWithConcurrency(keys, concurrency, async (sourceKey) => {
    const suffix = sourceKey.slice(sourcePrefix.length);
    const destinationKey = `${targetPrefix}${suffix}`;
    progress.currentKey = sourceKey;

    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: destinationKey,
          CopySource: `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`
        })
      );
      copied += 1;
      progress.copied += 1;
    } catch (error) {
      failed.push({
        sourceKey,
        destinationKey,
        stage: "copy",
        message: (error as Error).message
      });
      progress.failed += 1;
      progress.processed += 1;
      onProgress?.({ ...progress });
      return;
    }

    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: sourceKey
        })
      );
      deleted += 1;
      progress.deleted += 1;
    } catch (error) {
      failed.push({
        sourceKey,
        destinationKey,
        stage: "delete",
        message: (error as Error).message
      });
      progress.failed += 1;
    }

    progress.processed += 1;
    onProgress?.({ ...progress });
  });

  return {
    bucket,
    oldPrefixOrKey: sourcePrefix,
    newPrefixOrKey: targetPrefix,
    copied,
    deleted,
    failed
  };
}

export async function getFilePreview(
  s3: S3Client,
  key: string,
  download: boolean,
  bucket: string,
  expiresIn = 900
): Promise<PreviewResult> {
  const normalized = normalizeKey(key);
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: normalized
    })
  );

  const contentType = head.ContentType ?? inferContentTypeFromKey(normalized);
  const previewType = inferPreviewType(contentType);
  const mode = download || previewType === "download" ? "download" : "inline";

  const responseDisposition = `${mode}; filename*=UTF-8''${encodeURIComponent(baseNameFromKey(normalized))}`;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: normalized,
    ResponseContentDisposition: responseDisposition,
    ResponseContentType: contentType
  });

  const url = await getSignedUrl(s3, command, { expiresIn });

  return {
    bucket,
    key: normalized,
    url,
    mode,
    previewType,
    contentType,
    expiresIn
  };
}

export async function getFolderStats(s3: S3Client, prefix: string, bucket: string): Promise<FolderStats> {
  const normalizedPrefix = prefix ? normalizePrefix(prefix) : "";
  const keys = await listAllObjects(s3, bucket, normalizedPrefix);

  let totalSize = 0;
  let objectCount = 0;
  let latestModified: string | null = null;
  const folders = new Set<string>();
  const extensionBreakdown: FolderStats["extensionBreakdown"] = {};

  for (const item of keys) {
    const key = item.Key;
    if (!key) {
      continue;
    }

    if (key.endsWith("/") && (item.Size ?? 0) === 0) {
      const relative = key.slice(normalizedPrefix.length).replace(/\/$/, "");
      if (relative) {
        folders.add(relative);
      }
      continue;
    }

    objectCount += 1;
    const size = item.Size ?? 0;
    totalSize += size;

    const modified = item.LastModified?.toISOString() ?? null;
    if (modified && (!latestModified || modified > latestModified)) {
      latestModified = modified;
    }

    const relative = key.slice(normalizedPrefix.length);
    const parts = relative.split("/").filter(Boolean);
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i += 1) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }

    const extMatch = /\.([a-z0-9]+)$/i.exec(key);
    const ext = extMatch?.[1]?.toLowerCase() ?? "(none)";
    extensionBreakdown[ext] ??= { count: 0, size: 0 };
    extensionBreakdown[ext].count += 1;
    extensionBreakdown[ext].size += size;
  }

  return {
    bucket,
    prefix: normalizedPrefix,
    totalSize,
    objectCount,
    folderCount: folders.size,
    latestModified,
    extensionBreakdown
  };
}

export async function searchFilesAndFolders(
  s3: S3Client,
  prefix: string,
  term: string,
  bucket: string,
  continuationToken?: string,
  pageSize = 200
): Promise<SearchResult> {
  const normalizedPrefix = prefix ? normalizePrefix(prefix) : "";
  const lowercaseTerm = term.toLowerCase();

  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizedPrefix,
      ContinuationToken: continuationToken,
      MaxKeys: Math.min(pageSize, 1000)
    })
  );

  const folderSet = new Map<string, FolderEntry>();
  const fileEntries: FileEntry[] = [];

  for (const item of response.Contents ?? []) {
    const key = item.Key;
    if (!key) {
      continue;
    }

    const relative = key.slice(normalizedPrefix.length);
    const name = baseNameFromKey(key);

    if (name.toLowerCase().includes(lowercaseTerm)) {
      fileEntries.push({
        kind: "file",
        key,
        name,
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString() ?? null,
        eTag: item.ETag ?? null,
        contentType: null
      });
    }

    const segments = relative.split("/").filter(Boolean);
    let running = "";
    for (const segment of segments.slice(0, -1)) {
      running = running ? `${running}/${segment}` : segment;
      if (segment.toLowerCase().includes(lowercaseTerm)) {
        const folderKey = `${normalizedPrefix}${running}/`;
        folderSet.set(folderKey, {
          kind: "folder",
          key: folderKey,
          name: segment
        });
      }
    }
  }

  return {
    bucket,
    prefix: normalizedPrefix,
    term,
    entries: [...folderSet.values(), ...fileEntries],
    continuationToken: response.NextContinuationToken ?? null,
    scanned: response.KeyCount ?? 0
  };
}

export async function initMultipartUpload(
  s3: S3Client,
  input: MultipartInitRequest
): Promise<MultipartInitResult> {
  const key = normalizeKey(input.key);

  const result = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: input.bucket,
      Key: key,
      ContentType: input.contentType,
      Metadata: input.metadata
    })
  );

  if (!result.UploadId) {
    throw new Error("Failed to initialize multipart upload: upload id missing");
  }

  return {
    bucket: input.bucket,
    key,
    uploadId: result.UploadId
  };
}

export async function presignMultipartPart(
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 900
): Promise<MultipartPartSpec> {
  const command = new UploadPartCommand({
    Bucket: bucket,
    Key: normalizeKey(key),
    UploadId: uploadId,
    PartNumber: partNumber
  });

  return {
    partNumber,
    url: await getSignedUrl(s3, command, { expiresIn }),
    expiresIn
  };
}

export async function completeMultipartUpload(
  s3: S3Client,
  input: MultipartCompleteRequest
): Promise<MultipartCompleteResult> {
  const key = normalizeKey(input.key);

  const result = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: input.bucket,
      Key: key,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: [...input.parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.eTag
          }))
      }
    })
  );

  return {
    bucket: input.bucket,
    key,
    uploadId: input.uploadId,
    eTag: result.ETag
  };
}

export async function abortMultipartUpload(
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string
): Promise<void> {
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: normalizeKey(key),
      UploadId: uploadId
    })
  );
}

export async function MultiPartUpload(input: UploadInput & { partSizeMb?: number; queueSize?: number }): Promise<void> {
  const upload = new Upload({
    client: input.s3,
    params: {
      Bucket: input.bucket,
      Key: normalizeKey(input.key),
      Body: input.body,
      ContentType: input.contentType
    },
    queueSize: input.queueSize ?? 4,
    partSize: (input.partSizeMb ?? 10) * 1024 * 1024,
    leavePartsOnError: false
  });

  upload.on("httpUploadProgress", (progress) => {
    input.onProgress?.(progress.loaded ?? 0, progress.total);
  });

  await upload.done();
}

async function deleteFolderByPrefix(s3: S3Client, prefix: string, bucket: string): Promise<DeleteResult> {
  const failed: Array<{ key: string; message: string }> = [];
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const page = await listObjectKeys(s3, bucket, prefix, continuationToken, 1000);
    continuationToken = page.nextContinuationToken;

    if (!page.objects.length) {
      continue;
    }

    for (let i = 0; i < page.objects.length; i += 1000) {
      const chunk = page.objects.slice(i, i + 1000);
      try {
        const response = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: chunk.map((item) => ({ Key: item.Key! })),
              Quiet: true
            }
          })
        );

        deleted += response.Deleted?.length ?? 0;
        for (const error of response.Errors ?? []) {
          failed.push({
            key: error.Key ?? "(unknown)",
            message: error.Message ?? "DeleteObjects failed"
          });
        }
      } catch (error) {
        for (const item of chunk) {
          failed.push({ key: item.Key ?? "(unknown)", message: (error as Error).message });
        }
      }
    }
  } while (continuationToken);

  return {
    bucket,
    deleted,
    failed
  };
}

async function listObjectKeys(
  s3: S3Client,
  bucket: string,
  prefix: string,
  continuationToken?: string,
  maxKeys = 1000
): Promise<{ objects: _Object[]; nextContinuationToken?: string }> {
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: maxKeys
    })
  );

  return {
    objects: response.Contents ?? [],
    nextContinuationToken: response.NextContinuationToken
  };
}

async function listAllKeys(s3: S3Client, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const page = await listObjectKeys(s3, bucket, prefix, token);
    token = page.nextContinuationToken;

    for (const item of page.objects) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }
  } while (token);

  return keys;
}

async function listAllObjects(s3: S3Client, bucket: string, prefix: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let token: string | undefined;

  do {
    const page = await listObjectKeys(s3, bucket, prefix, token);
    token = page.nextContinuationToken;
    objects.push(...page.objects);
  } while (token);

  return objects;
}
