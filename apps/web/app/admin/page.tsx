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

type Grant = {
  userId: string;
  permission: {
    code: BucketPermission;
  };
};

export default function AdminPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedBucketId, setSelectedBucketId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<BucketPermission[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");

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
      }>("/admin/settings/ldap")
  });

  const connectionsQuery = useQuery({
    queryKey: ["admin", "connections"],
    queryFn: () => apiFetch<Connection[]>("/admin/connections")
  });

  const auditQuery = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiFetch<Array<{ id: string; action: string; entityType: string; entityId: string | null; createdAt: string }>>("/admin/audit"),
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
      setStatusMessage("Buckets synced from Garage Admin API");
      void queryClient.invalidateQueries({ queryKey: ["admin", "buckets"] });
      void queryClient.invalidateQueries({ queryKey: ["buckets"] });
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
    </PageShell>
  );
}
