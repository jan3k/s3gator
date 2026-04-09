export const BUCKET_PERMISSIONS = [
  "bucket:list",
  "object:list",
  "object:read",
  "object:preview",
  "object:download",
  "object:upload",
  "object:delete",
  "object:rename",
  "folder:create",
  "folder:rename",
  "folder:delete",
  "folder:stats",
  "search:run"
] as const;

export type BucketPermission = (typeof BUCKET_PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Record<BucketPermission, string> = {
  "bucket:list": "List bucket metadata and root directory",
  "object:list": "List objects and folders",
  "object:read": "Read object metadata",
  "object:preview": "Preview objects in browser",
  "object:download": "Download objects",
  "object:upload": "Upload objects and multipart parts",
  "object:delete": "Delete objects",
  "object:rename": "Rename objects",
  "folder:create": "Create virtual folders",
  "folder:rename": "Rename folders recursively",
  "folder:delete": "Delete folders recursively",
  "folder:stats": "Read folder stats",
  "search:run": "Search objects and folders"
};
