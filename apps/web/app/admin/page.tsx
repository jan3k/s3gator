"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BUCKET_PERMISSIONS, type BucketPermission } from "@s3gator/shared";
import { PageShell } from "@s3gator/ui";
import { apiFetch } from "@/lib/api-client";

type SessionUser = {
  id: string;
  username: string;
  role: "SUPER_ADMIN" | "ADMIN" | "USER";
};

type User = {
  id: string;
  username: string;
  email: string | null;
  isActive: boolean;
  role: {
    code: string;
  };
};

type Bucket = {
  id: string;
  name: string;
};

type Connection = {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  isDefault: boolean;
  healthStatus: string | null;
};

type Job = {
  id: string;
  type: "FOLDER_RENAME" | "FOLDER_DELETE" | "BUCKET_SYNC" | "UPLOAD_CLEANUP" | "RETENTION_CLEANUP";
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
  correlationId: string | null;
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  failureSummary: string | null;
  progress: {
    totalItems?: number;
    processedItems?: number;
  } | null;
};

type JobEvent = {
  id: string;
  jobId: string;
  correlationId: string | null;
  type: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type JobDetail = {
  job: Job;
  events: JobEvent[];
};

type UploadSession = {
  id: string;
  bucketName: string;
  objectKey: string;
  status: "INITIATED" | "IN_PROGRESS" | "COMPLETED" | "ABORTED" | "FAILED";
  completedPartNumbers: number[];
  totalParts: number | null;
  updatedAt: string;
  error: string | null;
};

type AdminScope = {
  bucketId: string;
  bucketName: string;
};

type Grant = {
  userId: string;
  permission: {
    code: BucketPermission;
  };
};

type AuthModeResponse = {
  mode: "local" | "ldap" | "hybrid";
};

type RetentionPolicy = {
  jobEventsDays: number;
  failedJobDays: number;
  terminalJobDays: number;
  auditLogDays: number;
  securityAuditDays: number;
  uploadSessionDays: number;
  archiveEnabled: boolean;
  archiveBatchSize: number;
};

type MaintenanceStatus = {
  retentionPolicy: RetentionPolicy;
  retentionLastRun: {
    ranAt: string;
    status: "success" | "failure";
    mode: "hard_delete" | "archive_and_prune";
    reason: "manual" | "scheduled";
    jobId: string | null;
    error: string | null;
    archived: Record<string, number>;
    deleted: Record<string, number>;
    archivePurged: Record<string, number>;
  } | null;
  archive: {
    enabled: boolean;
    auditLogArchiveCount: number;
    jobEventArchiveCount: number;
    lastArchivedAt: string | null;
    policy: {
      archiveAuditLogDays: number;
      archiveSecurityAuditDays: number;
      archiveJobEventDays: number;
    };
  };
  scheduler: {
    enabled: boolean;
    tickSeconds: number;
    lockTtlSeconds: number;
    lastHeartbeatAt: string | null;
    tasks: Array<{
      task: "retention_cleanup" | "upload_cleanup" | "bucket_sync";
      enabled: boolean;
      intervalMinutes: number;
      lastRunAt: string | null;
      nextRunAt: string | null;
      lastResult: "queued" | "skipped_active" | "failed" | "skipped_disabled" | null;
      lastTrigger: "scheduled" | "manual" | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastHeartbeatAt: string | null;
      lastJobId: string | null;
      lastError: string | null;
    }>;
  };
};

type SchedulerTaskKey = "retention_cleanup" | "upload_cleanup" | "bucket_sync";

type ArchiveAuditLog = {
  id: string;
  sourceAuditLogId: string | null;
  actorUserId: string | null;
  correlationId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  archivedAt: string;
};

type ArchiveAuditResponse = {
  items: ArchiveAuditLog[];
  total: number;
  limit: number;
  offset: number;
};

type ArchiveJobEvent = {
  id: string;
  sourceJobEventId: string | null;
  jobId: string;
  jobType: string | null;
  jobStatus: string | null;
  correlationId: string | null;
  type: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  archivedAt: string;
};

type ArchiveJobEventsResponse = {
  items: ArchiveJobEvent[];
  total: number;
  limit: number;
  offset: number;
};

export default function AdminPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedBucketId, setSelectedBucketId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<BucketPermission[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState("");
  const [selectedScopeBucketIds, setSelectedScopeBucketIds] = useState<string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [archiveAuditSearch, setArchiveAuditSearch] = useState("");
  const [archiveAuditAction, setArchiveAuditAction] = useState("");
  const [archiveAuditCorrelationId, setArchiveAuditCorrelationId] = useState("");
  const [archiveAuditFrom, setArchiveAuditFrom] = useState("");
  const [archiveAuditTo, setArchiveAuditTo] = useState("");
  const [archiveAuditOffset, setArchiveAuditOffset] = useState(0);
  const [archiveJobSearch, setArchiveJobSearch] = useState("");
  const [archiveJobType, setArchiveJobType] = useState("");
  const [archiveJobCorrelationId, setArchiveJobCorrelationId] = useState("");
  const [archiveJobLevel, setArchiveJobLevel] = useState<"" | "INFO" | "WARN" | "ERROR">("");
  const [archiveJobIdFilter, setArchiveJobIdFilter] = useState("");
  const [archiveJobFrom, setArchiveJobFrom] = useState("");
  const [archiveJobTo, setArchiveJobTo] = useState("");
  const [archiveJobOffset, setArchiveJobOffset] = useState(0);

  const meQuery = useQuery({
    queryKey: ["session", "me"],
    queryFn: () => apiFetch<{ user: SessionUser | null }>("/auth/me")
  });

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<User[]>("/admin/users")
  });

  const bucketsQuery = useQuery({
    queryKey: ["admin", "buckets"],
    queryFn: () => apiFetch<Bucket[]>("/admin/buckets")
  });

  const grantsQuery = useQuery({
    queryKey: ["admin", "grants", selectedBucketId],
    enabled: Boolean(selectedBucketId),
    queryFn: () => apiFetch<Grant[]>(`/admin/buckets/${selectedBucketId}/grants`)
  });

  const ldapQuery = useQuery({
    queryKey: ["admin", "ldap"],
    queryFn: () =>
      apiFetch<{
        enabled: boolean;
        url: string | null;
        bindDn: string | null;
        searchBase: string | null;
        searchFilter: string;
      }>("/admin/settings/ldap"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN"
  });
  const authModeQuery = useQuery({
    queryKey: ["admin", "auth-mode"],
    queryFn: () => apiFetch<AuthModeResponse>("/admin/settings/auth-mode"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN"
  });

  const connectionsQuery = useQuery({
    queryKey: ["admin", "connections"],
    queryFn: () => apiFetch<Connection[]>("/admin/connections"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN"
  });

  const jobsQuery = useQuery({
    queryKey: ["jobs", "all"],
    queryFn: () => apiFetch<Job[]>("/jobs?scope=all&limit=200"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN"
  });

  const jobDetailQuery = useQuery({
    queryKey: ["jobs", "detail", selectedJobId],
    queryFn: () => apiFetch<JobDetail>(`/jobs/${selectedJobId}/detail?limit=400`),
    enabled: Boolean(selectedJobId) && (meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN")
  });
  const retentionPolicyQuery = useQuery({
    queryKey: ["jobs", "retention-policy"],
    queryFn: () => apiFetch<RetentionPolicy>("/jobs/maintenance/retention-policy"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN"
  });
  const maintenanceStatusQuery = useQuery({
    queryKey: ["jobs", "maintenance-status"],
    queryFn: () => apiFetch<MaintenanceStatus>("/jobs/maintenance/status"),
    refetchInterval: 15_000,
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN"
  });

  const uploadSessionsQuery = useQuery({
    queryKey: ["admin", "upload-sessions"],
    queryFn: () => apiFetch<UploadSession[]>("/files/multipart/sessions?scope=all&limit=100"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN"
  });

  const adminUsers = useMemo(
    () => usersQuery.data?.filter((user) => user.role.code === "ADMIN") ?? [],
    [usersQuery.data]
  );

  useEffect(() => {
    if (!selectedAdminId && adminUsers[0]?.id) {
      setSelectedAdminId(adminUsers[0].id);
    }
  }, [adminUsers, selectedAdminId]);

  const adminScopesQuery = useQuery({
    queryKey: ["admin", "scopes", selectedAdminId],
    queryFn: () => apiFetch<AdminScope[]>(`/admin/users/${selectedAdminId}/scopes`),
    enabled: Boolean(selectedAdminId) && meQuery.data?.user?.role === "SUPER_ADMIN"
  });

  useEffect(() => {
    if (!adminScopesQuery.data) {
      return;
    }
    setSelectedScopeBucketIds(adminScopesQuery.data.map((scope) => scope.bucketId));
  }, [adminScopesQuery.data]);

  useEffect(() => {
    if (!selectedJobId && jobsQuery.data?.[0]?.id) {
      setSelectedJobId(jobsQuery.data[0].id);
    }
  }, [jobsQuery.data, selectedJobId]);

  const auditQuery = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiFetch<Array<{ id: string; action: string; entityType: string; entityId: string | null; createdAt: string }>>("/admin/audit"),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN"
  });

  const archiveAuditQuery = useQuery({
    queryKey: [
      "admin",
      "audit",
      "archive",
      archiveAuditOffset,
      archiveAuditSearch,
      archiveAuditAction,
      archiveAuditCorrelationId,
      archiveAuditFrom,
      archiveAuditTo
    ],
    queryFn: () =>
      apiFetch<ArchiveAuditResponse>(
        `/admin/audit/archive?${new URLSearchParams({
          limit: "25",
          offset: String(archiveAuditOffset),
          ...(archiveAuditSearch ? { search: archiveAuditSearch } : {}),
          ...(archiveAuditAction ? { action: archiveAuditAction } : {}),
          ...(archiveAuditCorrelationId ? { correlationId: archiveAuditCorrelationId } : {}),
          ...(archiveAuditFrom ? { from: new Date(archiveAuditFrom).toISOString() } : {}),
          ...(archiveAuditTo ? { to: new Date(archiveAuditTo).toISOString() } : {})
        }).toString()}`
      ),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN"
  });

  const archiveJobEventsQuery = useQuery({
    queryKey: [
      "jobs",
      "archive",
      "events",
      archiveJobOffset,
      archiveJobSearch,
      archiveJobType,
      archiveJobCorrelationId,
      archiveJobLevel,
      archiveJobIdFilter,
      archiveJobFrom,
      archiveJobTo
    ],
    queryFn: () =>
      apiFetch<ArchiveJobEventsResponse>(
        `/jobs/archive/events?${new URLSearchParams({
          limit: "25",
          offset: String(archiveJobOffset),
          ...(archiveJobSearch ? { search: archiveJobSearch } : {}),
          ...(archiveJobType ? { type: archiveJobType } : {}),
          ...(archiveJobCorrelationId ? { correlationId: archiveJobCorrelationId } : {}),
          ...(archiveJobLevel ? { level: archiveJobLevel } : {}),
          ...(archiveJobIdFilter ? { jobId: archiveJobIdFilter } : {}),
          ...(archiveJobFrom ? { from: new Date(archiveJobFrom).toISOString() } : {}),
          ...(archiveJobTo ? { to: new Date(archiveJobTo).toISOString() } : {})
        }).toString()}`
      ),
    enabled: meQuery.data?.user?.role === "SUPER_ADMIN"
  });

  useEffect(() => {
    if (meQuery.data && !meQuery.data.user) {
      router.replace("/login");
    }
    if (meQuery.data?.user?.role === "USER") {
      router.replace("/files");
    }
  }, [meQuery.data, router]);

  useEffect(() => {
    const firstBucket = bucketsQuery.data?.[0];
    if (!selectedBucketId && firstBucket) {
      setSelectedBucketId(firstBucket.id);
    }
    const firstUser = usersQuery.data?.[0];
    if (!selectedUserId && firstUser) {
      setSelectedUserId(firstUser.id);
    }
  }, [selectedBucketId, selectedUserId, bucketsQuery.data, usersQuery.data]);

  useEffect(() => {
    if (!grantsQuery.data || !selectedUserId) {
      return;
    }

    const granted = grantsQuery.data
      .filter((grant) => grant.userId === selectedUserId)
      .map((grant) => grant.permission.code);
    setSelectedPermissions(granted);
  }, [grantsQuery.data, selectedUserId]);

  const createUserMutation = useMutation({
    mutationFn: (payload: { username: string; email?: string; password: string; role: "SUPER_ADMIN" | "ADMIN" | "USER" }) =>
      apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setStatusMessage("User created");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    }
  });

  const syncBucketsMutation = useMutation({
    mutationFn: () => apiFetch("/admin/buckets/sync", { method: "POST" }),
    onSuccess: () => {
      setStatusMessage("Bucket sync job queued");
      void queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", "maintenance-status"] });
    }
  });

  const saveGrantsMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/buckets/${selectedBucketId}/grants/${selectedUserId}`, {
        method: "PUT",
        body: JSON.stringify({ permissions: selectedPermissions })
      }),
    onSuccess: () => {
      setStatusMessage("Bucket grants updated");
      void queryClient.invalidateQueries({ queryKey: ["admin", "grants", selectedBucketId] });
    }
  });

  const saveLdapMutation = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch("/admin/settings/ldap", {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setStatusMessage("LDAP settings saved");
      void queryClient.invalidateQueries({ queryKey: ["admin", "ldap"] });
    }
  });
  const saveAuthModeMutation = useMutation({
    mutationFn: (mode: "local" | "ldap" | "hybrid") =>
      apiFetch("/admin/settings/auth-mode", {
        method: "PATCH",
        body: JSON.stringify({ mode })
      }),
    onSuccess: () => {
      setStatusMessage("Authentication mode updated");
      void queryClient.invalidateQueries({ queryKey: ["admin", "auth-mode"] });
    }
  });

  const createConnectionMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      endpoint: string;
      region: string;
      forcePathStyle: boolean;
      accessKeyId: string;
      secretAccessKey: string;
      adminApiUrl?: string;
      adminToken?: string;
      isDefault?: boolean;
    }) =>
      apiFetch("/admin/connections", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setStatusMessage("Connection saved");
      void queryClient.invalidateQueries({ queryKey: ["admin", "connections"] });
    }
  });

  const healthMutation = useMutation({
    mutationFn: (connectionId: string) => apiFetch(`/admin/connections/${connectionId}/health`, { method: "POST" }),
    onSuccess: () => {
      setStatusMessage("Connection health check completed");
      void queryClient.invalidateQueries({ queryKey: ["admin", "connections"] });
    }
  });

  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => apiFetch(`/jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      setStatusMessage("Job cancellation requested");
      void queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
      if (selectedJobId) {
        void queryClient.invalidateQueries({ queryKey: ["jobs", "detail", selectedJobId] });
      }
    }
  });

  const queueUploadCleanupMutation = useMutation({
    mutationFn: () => apiFetch("/jobs/maintenance/upload-cleanup", { method: "POST" }),
    onSuccess: () => {
      setStatusMessage("Upload cleanup job queued");
      void queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", "maintenance-status"] });
    }
  });

  const queueRetentionCleanupMutation = useMutation({
    mutationFn: () => apiFetch("/jobs/maintenance/retention-cleanup", { method: "POST" }),
    onSuccess: () => {
      setStatusMessage("Retention cleanup job queued");
      void queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", "maintenance-status"] });
    }
  });

  const runSchedulerTaskMutation = useMutation({
    mutationFn: (task: SchedulerTaskKey) =>
      apiFetch<{
        task: SchedulerTaskKey;
        result: "queued" | "skipped_active" | "failed" | "skipped_disabled";
        jobId: string | null;
        error: string | null;
      }>(`/jobs/maintenance/tasks/${task}/run-once`, { method: "POST" }),
    onSuccess: (result) => {
      const message =
        result.result === "queued"
          ? `Task ${result.task} queued (${result.jobId ?? "no-job-id"})`
          : `Task ${result.task} ${result.result}${result.error ? `: ${result.error}` : ""}`;
      setStatusMessage(message);
      void queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", "maintenance-status"] });
    }
  });

  const saveAdminScopesMutation = useMutation({
    mutationFn: (bucketIds: string[]) =>
      apiFetch(`/admin/users/${selectedAdminId}/scopes`, {
        method: "PUT",
        body: JSON.stringify({ bucketIds })
      }),
    onSuccess: () => {
      setStatusMessage("Admin scope updated");
      void queryClient.invalidateQueries({ queryKey: ["admin", "scopes", selectedAdminId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "buckets"] });
    }
  });

  const activeUser = useMemo(
    () => usersQuery.data?.find((user) => user.id === selectedUserId),
    [usersQuery.data, selectedUserId]
  );

  return (
    <PageShell title="Admin" subtitle="Users, grants, LDAP and connection management">
      {statusMessage ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{statusMessage}</div>
      ) : null}

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Users</h2>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">Current users</h3>
            <div className="max-h-64 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usersQuery.data?.map((user) => (
                    <tr key={user.id}>
                      <td className="px-3 py-2">{user.username}</td>
                      <td className="px-3 py-2">{user.role.code}</td>
                      <td className="px-3 py-2">{user.isActive ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                void createUserMutation.mutate({
                  username: String(formData.get("username") ?? ""),
                  email: String(formData.get("email") ?? "") || undefined,
                  password: String(formData.get("password") ?? ""),
                  role: String(formData.get("role") ?? "USER") as "SUPER_ADMIN" | "ADMIN" | "USER"
                });
                event.currentTarget.reset();
              }}
            >
              <h3 className="text-sm font-medium text-slate-700">Create local user</h3>
              <input required name="username" className="w-full rounded border border-slate-300 px-3 py-2" placeholder="username" />
              <input name="email" className="w-full rounded border border-slate-300 px-3 py-2" placeholder="email" />
              <input required name="password" type="password" className="w-full rounded border border-slate-300 px-3 py-2" placeholder="password" />
              <select name="role" className="w-full rounded border border-slate-300 px-3 py-2" defaultValue="USER">
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              </select>
              <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white">Create User</button>
            </form>
          ) : (
            <div className="rounded border border-slate-200 p-3 text-sm text-slate-600">User creation is limited to Super Admin.</div>
          )}
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Bucket permissions</h2>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            onClick={() => {
              void syncBucketsMutation.mutate();
            }}
          >
            Sync Buckets
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-sm">
            Bucket
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={selectedBucketId}
              onChange={(event) => setSelectedBucketId(event.target.value)}
            >
              {bucketsQuery.data?.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            User
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
            >
              {usersQuery.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm text-slate-600">Editing grants for: {activeUser?.username ?? "-"}</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
          {BUCKET_PERMISSIONS.map((permission) => (
            <label key={permission} className="inline-flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={selectedPermissions.includes(permission)}
                onChange={(event) => {
                  setSelectedPermissions((prev) =>
                    event.target.checked
                      ? [...new Set([...prev, permission])]
                      : prev.filter((item) => item !== permission)
                  );
                }}
              />
              {permission}
            </label>
          ))}
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Bucket visibility requires explicit <code>bucket:list</code> permission.
        </p>

        <button
          className="mt-3 rounded bg-blue-600 px-3 py-2 text-sm text-white"
          disabled={!selectedBucketId || !selectedUserId}
          onClick={() => {
            void saveGrantsMutation.mutate();
          }}
        >
          Save Grants
        </button>
      </section>

      {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Admin scopes</h2>
          <p className="mt-1 text-sm text-slate-600">Limit ADMIN operations to selected buckets.</p>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label className="text-sm">
              Admin user
              <select
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={selectedAdminId}
                onChange={(event) => setSelectedAdminId(event.target.value)}
              >
                {adminUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {bucketsQuery.data?.map((bucket) => (
              <label key={bucket.id} className="inline-flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={selectedScopeBucketIds.includes(bucket.id)}
                  onChange={(event) => {
                    setSelectedScopeBucketIds((prev) =>
                      event.target.checked
                        ? [...new Set([...prev, bucket.id])]
                        : prev.filter((item) => item !== bucket.id)
                    );
                  }}
                />
                {bucket.name}
              </label>
            ))}
          </div>

          <button
            className="mt-3 rounded bg-blue-600 px-3 py-2 text-sm text-white"
            disabled={!selectedAdminId}
            onClick={() => {
              void saveAdminScopesMutation.mutate(selectedScopeBucketIds);
            }}
          >
            Save Admin Scope
          </button>
        </section>
      ) : null}

      {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
        <>
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">LDAP settings</h2>
            <form
              className="mt-3 grid gap-2 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);

                void saveLdapMutation.mutate({
                  enabled: formData.get("enabled") === "on",
                  url: String(formData.get("url") ?? "") || null,
                  bindDn: String(formData.get("bindDn") ?? "") || null,
                  bindPassword: String(formData.get("bindPassword") ?? "") || undefined,
                  searchBase: String(formData.get("searchBase") ?? "") || null,
                  searchFilter: String(formData.get("searchFilter") ?? "(uid={{username}})"),
                  usernameAttribute: String(formData.get("usernameAttribute") ?? "uid"),
                  emailAttribute: String(formData.get("emailAttribute") ?? "mail"),
                  displayNameAttribute: String(formData.get("displayNameAttribute") ?? "cn"),
                  groupAttribute: String(formData.get("groupAttribute") ?? "memberOf"),
                  groupRoleMapping: {},
                  tlsRejectUnauthorized: formData.get("tlsRejectUnauthorized") === "on"
                });
              }}
            >
              <label className="col-span-2 inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={ldapQuery.data?.enabled ?? false} />
                Enable LDAP
              </label>
              <input name="url" defaultValue={ldapQuery.data?.url ?? ""} className="rounded border border-slate-300 px-3 py-2" placeholder="ldap://host:389" />
              <input name="bindDn" defaultValue={ldapQuery.data?.bindDn ?? ""} className="rounded border border-slate-300 px-3 py-2" placeholder="bind dn" />
              <input name="bindPassword" type="password" className="rounded border border-slate-300 px-3 py-2" placeholder="bind password" />
              <input name="searchBase" defaultValue={ldapQuery.data?.searchBase ?? ""} className="rounded border border-slate-300 px-3 py-2" placeholder="dc=example,dc=com" />
              <input name="searchFilter" defaultValue={ldapQuery.data?.searchFilter ?? "(uid={{username}})"} className="rounded border border-slate-300 px-3 py-2" placeholder="(uid={{username}})" />
              <input name="usernameAttribute" defaultValue="uid" className="rounded border border-slate-300 px-3 py-2" placeholder="username attribute" />
              <input name="emailAttribute" defaultValue="mail" className="rounded border border-slate-300 px-3 py-2" placeholder="email attribute" />
              <input name="displayNameAttribute" defaultValue="cn" className="rounded border border-slate-300 px-3 py-2" placeholder="display name attribute" />
              <input name="groupAttribute" defaultValue="memberOf" className="rounded border border-slate-300 px-3 py-2" placeholder="group attribute" />
              <label className="col-span-2 inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="tlsRejectUnauthorized" defaultChecked />
                Verify LDAP TLS certificates
              </label>
              <button className="col-span-2 rounded bg-blue-600 px-3 py-2 text-sm text-white">Save LDAP Settings</button>
            </form>
          </section>

          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Authentication mode</h2>
            <p className="mt-1 text-sm text-slate-600">Controls whether local, LDAP, or hybrid login is allowed.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                value={authModeQuery.data?.mode ?? "local"}
                onChange={(event) => {
                  void saveAuthModeMutation.mutate(event.target.value as "local" | "ldap" | "hybrid");
                }}
              >
                <option value="local">local</option>
                <option value="ldap">ldap</option>
                <option value="hybrid">hybrid</option>
              </select>
              <span className="text-xs text-slate-500">
                Current mode: {authModeQuery.data?.mode ?? "loading..."}
              </span>
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Garage connections</h2>

            <div className="mt-3 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Endpoint</th>
                    <th className="px-3 py-2">Region</th>
                    <th className="px-3 py-2">Default</th>
                    <th className="px-3 py-2">Health</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {connectionsQuery.data?.map((conn) => (
                    <tr key={conn.id}>
                      <td className="px-3 py-2">{conn.name}</td>
                      <td className="px-3 py-2">{conn.endpoint}</td>
                      <td className="px-3 py-2">{conn.region}</td>
                      <td className="px-3 py-2">{conn.isDefault ? "yes" : "no"}</td>
                      <td className="px-3 py-2">{conn.healthStatus ?? "unknown"}</td>
                      <td className="px-3 py-2">
                        <button
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                          onClick={() => {
                            void healthMutation.mutate(conn.id);
                          }}
                        >
                          Check health
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form
              className="mt-3 grid gap-2 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void createConnectionMutation.mutate({
                  name: String(data.get("name") ?? ""),
                  endpoint: String(data.get("endpoint") ?? ""),
                  region: String(data.get("region") ?? "garage"),
                  forcePathStyle: data.get("forcePathStyle") === "on",
                  accessKeyId: String(data.get("accessKeyId") ?? ""),
                  secretAccessKey: String(data.get("secretAccessKey") ?? ""),
                  adminApiUrl: String(data.get("adminApiUrl") ?? "") || undefined,
                  adminToken: String(data.get("adminToken") ?? "") || undefined,
                  isDefault: data.get("isDefault") === "on"
                });
                event.currentTarget.reset();
              }}
            >
              <input required name="name" className="rounded border border-slate-300 px-3 py-2" placeholder="connection name" />
              <input required name="endpoint" className="rounded border border-slate-300 px-3 py-2" placeholder="https://s3.example.com" />
              <input name="region" defaultValue="garage" className="rounded border border-slate-300 px-3 py-2" placeholder="garage" />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="forcePathStyle" defaultChecked />
                Force path style
              </label>
              <input required name="accessKeyId" className="rounded border border-slate-300 px-3 py-2" placeholder="access key id" />
              <input required name="secretAccessKey" className="rounded border border-slate-300 px-3 py-2" placeholder="secret access key" />
              <input name="adminApiUrl" className="rounded border border-slate-300 px-3 py-2" placeholder="http://garage-admin:3903" />
              <input name="adminToken" className="rounded border border-slate-300 px-3 py-2" placeholder="admin bearer token" />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="isDefault" />
                Set as default
              </label>
              <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white">Save Connection</button>
            </form>
          </section>
        </>
      ) : null}

      {(meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN") ? (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Background jobs</h2>
            <div className="flex items-center gap-2">
              <button
                className="rounded border border-slate-300 px-3 py-2 text-xs"
                onClick={() => {
                  void queueUploadCleanupMutation.mutate();
                }}
              >
                Queue upload cleanup
              </button>
              {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
                <button
                  className="rounded border border-slate-300 px-3 py-2 text-xs"
                  onClick={() => {
                    void queueRetentionCleanupMutation.mutate();
                  }}
                >
                  Queue retention cleanup
                </button>
              ) : null}
            </div>
          </div>

          <p className="mb-2 text-xs text-slate-500">
            Cancel is best-effort. In-flight S3 requests may complete before worker cancellation checkpoints.
          </p>
          {retentionPolicyQuery.data ? (
            <p className="mb-2 text-xs text-slate-500">
              Retention defaults: job events {retentionPolicyQuery.data.jobEventsDays}d / failed jobs {retentionPolicyQuery.data.failedJobDays}d / audit {retentionPolicyQuery.data.auditLogDays}d / mode {retentionPolicyQuery.data.archiveEnabled ? "archive+prune" : "hard delete"}.
            </p>
          ) : null}
          {maintenanceStatusQuery.data ? (
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-medium text-slate-800">Maintenance status</div>
              <div className="mt-1">Archive enabled: {maintenanceStatusQuery.data.archive.enabled ? "yes" : "no"}</div>
              <div>Archive counts: audit {maintenanceStatusQuery.data.archive.auditLogArchiveCount} / events {maintenanceStatusQuery.data.archive.jobEventArchiveCount}</div>
              <div>Last archived at: {maintenanceStatusQuery.data.archive.lastArchivedAt ?? "-"}</div>
              <div>
                Archive lifecycle windows: audit {maintenanceStatusQuery.data.archive.policy.archiveAuditLogDays}d / security audit{" "}
                {maintenanceStatusQuery.data.archive.policy.archiveSecurityAuditDays}d / job events{" "}
                {maintenanceStatusQuery.data.archive.policy.archiveJobEventDays}d
              </div>
              <div className="mt-1">
                Last retention run:{" "}
                {maintenanceStatusQuery.data.retentionLastRun
                  ? `${maintenanceStatusQuery.data.retentionLastRun.ranAt} (${maintenanceStatusQuery.data.retentionLastRun.status}, ${maintenanceStatusQuery.data.retentionLastRun.reason})`
                  : "-"}
              </div>
              {maintenanceStatusQuery.data.retentionLastRun ? (
                <div>
                  Last archive purge: {maintenanceStatusQuery.data.retentionLastRun.archivePurged.jobEvents ?? 0} job events /{" "}
                  {((maintenanceStatusQuery.data.retentionLastRun.archivePurged.auditLogsGeneral ?? 0) +
                    (maintenanceStatusQuery.data.retentionLastRun.archivePurged.auditLogsSecurity ?? 0))}{" "}
                  audit rows
                </div>
              ) : null}
              {maintenanceStatusQuery.data.retentionLastRun?.error ? (
                <div className="text-red-700">Last retention error: {maintenanceStatusQuery.data.retentionLastRun.error}</div>
              ) : null}
              <div className="mt-2 font-medium text-slate-800">
                Scheduler: {maintenanceStatusQuery.data.scheduler.enabled ? "enabled" : "disabled"} (tick {maintenanceStatusQuery.data.scheduler.tickSeconds}s)
              </div>
              <div>Scheduler heartbeat: {maintenanceStatusQuery.data.scheduler.lastHeartbeatAt ?? "-"}</div>
              <div className="mt-1 overflow-auto rounded border border-slate-200 bg-white">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-slate-50 text-left uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-1">Task</th>
                      <th className="px-2 py-1">Enabled</th>
                      <th className="px-2 py-1">Interval</th>
                      <th className="px-2 py-1">Trigger</th>
                      <th className="px-2 py-1">Last result</th>
                      <th className="px-2 py-1">Last success</th>
                      <th className="px-2 py-1">Last failure</th>
                      <th className="px-2 py-1">Last run</th>
                      <th className="px-2 py-1">Next run</th>
                      <th className="px-2 py-1">Last job</th>
                      <th className="px-2 py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {maintenanceStatusQuery.data.scheduler.tasks.map((task) => (
                      <tr key={task.task}>
                        <td className="px-2 py-1">{task.task}</td>
                        <td className="px-2 py-1">{task.enabled ? "yes" : "no"}</td>
                        <td className="px-2 py-1">{task.intervalMinutes > 0 ? `${task.intervalMinutes}m` : "-"}</td>
                        <td className="px-2 py-1">{task.lastTrigger ?? "-"}</td>
                        <td className="px-2 py-1">{task.lastResult ?? "-"}</td>
                        <td className="px-2 py-1">{task.lastSuccessAt ?? "-"}</td>
                        <td className="px-2 py-1">{task.lastFailureAt ?? "-"}</td>
                        <td className="px-2 py-1">{task.lastRunAt ?? "-"}</td>
                        <td className="px-2 py-1">{task.nextRunAt ?? "-"}</td>
                        <td className="px-2 py-1">{task.lastJobId ?? "-"}</td>
                        <td className="px-2 py-1">
                          {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
                            <button
                              className="rounded border border-slate-300 px-2 py-1 text-[10px]"
                              onClick={() => {
                                void runSchedulerTaskMutation.mutate(task.task);
                              }}
                            >
                              Run once
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="max-h-80 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Next retry</th>
                  <th className="px-3 py-2">Failure</th>
                  <th className="px-3 py-2">Correlation</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobsQuery.data?.map((job) => (
                  <tr
                    key={job.id}
                    className={selectedJobId === job.id ? "bg-slate-50" : undefined}
                  >
                    <td className="px-3 py-2">{job.type}</td>
                    <td className="px-3 py-2">{job.status}</td>
                    <td className="px-3 py-2">
                      {job.attemptCount}/{job.maxAttempts}
                      {!job.retryable ? " (no)" : ""}
                    </td>
                    <td className="px-3 py-2">
                      {job.progress?.processedItems !== undefined
                        ? `${job.progress.processedItems}/${job.progress.totalItems ?? "?"}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">{job.nextRetryAt ?? "-"}</td>
                    <td className="px-3 py-2">{job.failureSummary ?? job.lastError ?? "-"}</td>
                    <td className="max-w-52 truncate px-3 py-2 font-mono text-[11px]">{job.correlationId ?? "-"}</td>
                    <td className="px-3 py-2">{job.createdAt}</td>
                    <td className="px-3 py-2 space-x-1">
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-[11px]"
                        onClick={() => {
                          setSelectedJobId(job.id);
                        }}
                      >
                        Details
                      </button>
                      {(job.status === "QUEUED" || job.status === "RUNNING") ? (
                        <button
                          className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700"
                          onClick={() => {
                            void cancelJobMutation.mutate(job.id);
                          }}
                        >
                          Cancel
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Job timeline</h3>
            {selectedJobId ? (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  Selected job: <span className="font-mono">{selectedJobId}</span>
                </p>
                {jobDetailQuery.isLoading ? (
                  <p className="mt-2 text-xs text-slate-500">Loading timeline...</p>
                ) : null}
                {jobDetailQuery.data ? (
                  <div className="mt-3 space-y-2">
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <div>Status: {jobDetailQuery.data.job.status}</div>
                      <div>Retryable: {jobDetailQuery.data.job.retryable ? "yes" : "no"}</div>
                      <div>Attempts: {jobDetailQuery.data.job.attemptCount}/{jobDetailQuery.data.job.maxAttempts}</div>
                      <div>Next retry at: {jobDetailQuery.data.job.nextRetryAt ?? "-"}</div>
                      <div>Correlation ID: <span className="font-mono">{jobDetailQuery.data.job.correlationId ?? "-"}</span></div>
                      <div>Failure: {jobDetailQuery.data.job.failureSummary ?? jobDetailQuery.data.job.lastError ?? "-"}</div>
                    </div>
                    <div className="max-h-64 overflow-auto rounded border border-slate-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50 text-left uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Time</th>
                            <th className="px-3 py-2">Level</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Message</th>
                            <th className="px-3 py-2">Metadata</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {jobDetailQuery.data.events.map((event) => (
                            <tr key={event.id}>
                              <td className="px-3 py-2">{event.createdAt}</td>
                              <td className="px-3 py-2">{event.level}</td>
                              <td className="px-3 py-2">{event.type}</td>
                              <td className="px-3 py-2">{event.message}</td>
                              <td className="max-w-96 truncate px-3 py-2 font-mono">
                                {event.metadata ? JSON.stringify(event.metadata) : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No timeline data.</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Select a job to inspect timeline events.</p>
            )}
          </div>
        </section>
      ) : null}

      {(meQuery.data?.user?.role === "SUPER_ADMIN" || meQuery.data?.user?.role === "ADMIN") ? (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Upload sessions</h2>
          <div className="mt-3 max-h-72 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Bucket</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Parts</th>
                  <th className="px-3 py-2">Error</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploadSessionsQuery.data?.map((session) => (
                  <tr key={session.id}>
                    <td className="px-3 py-2">{session.bucketName}</td>
                    <td className="px-3 py-2">{session.objectKey}</td>
                    <td className="px-3 py-2">{session.status}</td>
                    <td className="px-3 py-2">
                      {session.completedPartNumbers.length}/{session.totalParts ?? "?"}
                    </td>
                    <td className="px-3 py-2">{session.error ?? "-"}</td>
                    <td className="px-3 py-2">{session.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Audit log</h2>
          <div className="mt-3 max-h-80 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditQuery.data?.map((log) => (
                  <tr key={log.id}>
                    <td className="px-3 py-2">{log.action}</td>
                    <td className="px-3 py-2">{log.entityType}</td>
                    <td className="px-3 py-2">{log.entityId ?? "-"}</td>
                    <td className="px-3 py-2">{log.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {meQuery.data?.user?.role === "SUPER_ADMIN" ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Archive browser</h2>
          <p className="mt-1 text-xs text-slate-500">
            Read-only access to archived operational history. Data is filtered and paginated.
          </p>

          <div className="mt-4 rounded border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-800">Archived audit logs</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-6">
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="search action/entity"
                value={archiveAuditSearch}
                onChange={(event) => {
                  setArchiveAuditOffset(0);
                  setArchiveAuditSearch(event.target.value);
                }}
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="action contains"
                value={archiveAuditAction}
                onChange={(event) => {
                  setArchiveAuditOffset(0);
                  setArchiveAuditAction(event.target.value);
                }}
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="correlation id"
                value={archiveAuditCorrelationId}
                onChange={(event) => {
                  setArchiveAuditOffset(0);
                  setArchiveAuditCorrelationId(event.target.value);
                }}
              />
              <input
                type="datetime-local"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={archiveAuditFrom}
                onChange={(event) => {
                  setArchiveAuditOffset(0);
                  setArchiveAuditFrom(event.target.value);
                }}
              />
              <input
                type="datetime-local"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={archiveAuditTo}
                onChange={(event) => {
                  setArchiveAuditOffset(0);
                  setArchiveAuditTo(event.target.value);
                }}
              />
              <button
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                onClick={() => {
                  void archiveAuditQuery.refetch();
                }}
              >
                Refresh
              </button>
            </div>
            <div className="mt-2 max-h-64 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Created</th>
                    <th className="px-2 py-1">Action</th>
                    <th className="px-2 py-1">Entity</th>
                    <th className="px-2 py-1">Target</th>
                    <th className="px-2 py-1">Correlation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {archiveAuditQuery.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-2 py-1">{item.createdAt}</td>
                      <td className="px-2 py-1">{item.action}</td>
                      <td className="px-2 py-1">{item.entityType}</td>
                      <td className="px-2 py-1">{item.entityId ?? "-"}</td>
                      <td className="max-w-52 truncate px-2 py-1 font-mono text-[11px]">{item.correlationId ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>
                Showing {archiveAuditQuery.data?.items.length ?? 0} / {archiveAuditQuery.data?.total ?? 0}
              </span>
              <div className="space-x-2">
                <button
                  className="rounded border border-slate-300 px-2 py-1"
                  disabled={archiveAuditOffset === 0}
                  onClick={() => setArchiveAuditOffset((prev) => Math.max(prev - 25, 0))}
                >
                  Prev
                </button>
                <button
                  className="rounded border border-slate-300 px-2 py-1"
                  disabled={(archiveAuditQuery.data?.offset ?? 0) + (archiveAuditQuery.data?.limit ?? 25) >= (archiveAuditQuery.data?.total ?? 0)}
                  onClick={() => setArchiveAuditOffset((prev) => prev + 25)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-800">Archived job events</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-7">
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="search type/message"
                value={archiveJobSearch}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobSearch(event.target.value);
                }}
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="type contains"
                value={archiveJobType}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobType(event.target.value);
                }}
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="jobId"
                value={archiveJobIdFilter}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobIdFilter(event.target.value);
                }}
              />
              <input
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="correlation id"
                value={archiveJobCorrelationId}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobCorrelationId(event.target.value);
                }}
              />
              <select
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={archiveJobLevel}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobLevel(event.target.value as "" | "INFO" | "WARN" | "ERROR");
                }}
              >
                <option value="">level:any</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
              <input
                type="datetime-local"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={archiveJobFrom}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobFrom(event.target.value);
                }}
              />
              <input
                type="datetime-local"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={archiveJobTo}
                onChange={(event) => {
                  setArchiveJobOffset(0);
                  setArchiveJobTo(event.target.value);
                }}
              />
            </div>
            <div className="mt-2 max-h-64 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Created</th>
                    <th className="px-2 py-1">Job</th>
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1">Level</th>
                    <th className="px-2 py-1">Message</th>
                    <th className="px-2 py-1">Correlation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {archiveJobEventsQuery.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-2 py-1">{item.createdAt}</td>
                      <td className="px-2 py-1">{item.jobId}</td>
                      <td className="px-2 py-1">{item.type}</td>
                      <td className="px-2 py-1">{item.level}</td>
                      <td className="px-2 py-1">{item.message}</td>
                      <td className="max-w-52 truncate px-2 py-1 font-mono text-[11px]">{item.correlationId ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <span>
                Showing {archiveJobEventsQuery.data?.items.length ?? 0} / {archiveJobEventsQuery.data?.total ?? 0}
              </span>
              <div className="space-x-2">
                <button
                  className="rounded border border-slate-300 px-2 py-1"
                  disabled={archiveJobOffset === 0}
                  onClick={() => setArchiveJobOffset((prev) => Math.max(prev - 25, 0))}
                >
                  Prev
                </button>
                <button
                  className="rounded border border-slate-300 px-2 py-1"
                  disabled={(archiveJobEventsQuery.data?.offset ?? 0) + (archiveJobEventsQuery.data?.limit ?? 25) >= (archiveJobEventsQuery.data?.total ?? 0)}
                  onClick={() => setArchiveJobOffset((prev) => prev + 25)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
