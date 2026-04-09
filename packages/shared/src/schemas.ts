import { z } from "zod";
import { APP_ROLES } from "./roles.js";
import { BUCKET_PERMISSIONS } from "./permissions.js";

export const roleSchema = z.enum(APP_ROLES);
export const bucketPermissionSchema = z.enum(BUCKET_PERMISSIONS);

export const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(8).max(1024),
  mode: z.enum(["local", "ldap"]).optional()
});

export const createFolderSchema = z.object({
  bucket: z.string().min(1),
  folderPath: z.string().min(1)
});

export const renameSchema = z.object({
  bucket: z.string().min(1),
  oldKey: z.string().min(1),
  newKey: z.string().min(1)
});

export const deleteSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1)
});

export const listSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().default(""),
  continuationToken: z.string().optional(),
  recursive: z
    .union([z.boolean(), z.string().regex(/^(true|false)$/)])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(false),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  sortBy: z.enum(["name", "size", "lastModified", "type"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc")
});

export const searchSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().default(""),
  term: z.string().min(1).max(512),
  continuationToken: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200)
});

export const previewSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  download: z
    .union([z.boolean(), z.string().regex(/^(true|false)$/)])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(false)
});

export const ldapConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().url().optional().nullable(),
  bindDn: z.string().optional().nullable(),
  bindPassword: z.string().optional().nullable(),
  searchBase: z.string().optional().nullable(),
  searchFilter: z.string().default("(uid={{username}})"),
  usernameAttribute: z.string().default("uid"),
  emailAttribute: z.string().default("mail"),
  displayNameAttribute: z.string().default("cn"),
  groupAttribute: z.string().default("memberOf"),
  groupRoleMapping: z.record(z.string(), roleSchema).default({}),
  tlsRejectUnauthorized: z.boolean().default(true)
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ListInput = z.infer<typeof listSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type PreviewInput = z.infer<typeof previewSchema>;
