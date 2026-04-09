export const APP_ROLES = ["SUPER_ADMIN", "ADMIN", "USER"] as const;

export type AppRole = (typeof APP_ROLES)[number];
