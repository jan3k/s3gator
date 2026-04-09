"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FolderPlus, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";
import { EmptyState, PageShell } from "@s3gator/ui";
import { apiFetch } from "@/lib/api-client";
import { isAbortUploadError, uploadPartsWithConcurrency } from "@/lib/multipart-upload";

type SessionUser = {
  id: string;
  username: string;
  email: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "USER";
};

type Bucket = {
  id: string;
  name: string;
};

type FileEntry = {
  kind: "file";
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
};

type FolderEntry = {
  kind: "folder";
  key: string;
  name: string;
};

type Entry = FileEntry | FolderEntry;

type PreviewPayload = {
  url: string;
  previewType: "image" | "video" | "audio" | "text" | "pdf" | "download";
  mode: "inline" | "download";
};

type UploadJob = {
  id: string;
  name: string;
  progress: number;
  status: "queued" | "running" | "done" | "aborted" | "error";
  uploadSessionId?: string;
  error?: string;
};

type CompletedPart = {
  partNumber: number;
  eTag: string;
};

type ResumableSession = {
  id: string;
  objectKey: string;
  status: "INITIATED" | "IN_PROGRESS" | "FAILED" | "COMPLETED" | "ABORTED";
  partSize: number | null;
  completedPartNumbers: number[];
  completedParts: CompletedPart[];
  totalParts: number | null;
  updatedAt: string;
};

const PART_SIZE = 10 * 1024 * 1024;

export default function FilesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [preview, setPreview] = useState<{ key: string; payload: PreviewPayload } | null>(null);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [statsText, setStatsText] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const uploadControllersRef = useRef(new Map<string, AbortController>());

  const meQuery = useQuery({
    queryKey: ["session", "me"],
    queryFn: () => apiFetch<{ user: SessionUser | null }>("/auth/me")
  });

  const bucketsQuery = useQuery({
    queryKey: ["buckets"],
    queryFn: () => apiFetch<Bucket[]>("/buckets")
  });

  const listQuery = useQuery({
    queryKey: ["files", bucket, prefix],
    enabled: Boolean(bucket) && !activeSearch,
    queryFn: () =>
      apiFetch<{ entries: Entry[]; continuationToken: string | null }>(
        `/files/list?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix)}&recursive=false&pageSize=500&sortBy=type&sortOrder=asc`
      )
  });

  const searchQuery = useQuery({
    queryKey: ["files-search", bucket, prefix, activeSearch],
    enabled: Boolean(bucket) && Boolean(activeSearch),
    queryFn: () =>
      apiFetch<{ entries: Entry[] }>(
        `/files/search?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix)}&term=${encodeURIComponent(activeSearch)}&pageSize=500`
      )
  });

  const resumableUploadsQuery = useQuery({
    queryKey: ["multipart-sessions", bucket],
    enabled: Boolean(bucket),
    queryFn: () =>
      apiFetch<ResumableSession[]>(
        "/files/multipart/sessions?scope=mine&status=INITIATED,IN_PROGRESS,FAILED&limit=100"
      )
  });

  const previewMutation = useMutation({
    mutationFn: (key: string) =>
      apiFetch<PreviewPayload>(
        `/files/preview?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}&download=false`
      ),
    onSuccess: (payload, key) => {
      setPreview({ key, payload });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ mode?: "job"; job?: { id: string } }>("/files", {
        method: "DELETE",
        body: JSON.stringify({ bucket, key })
      }),
    onSuccess: (payload) => {
      if (payload?.mode === "job" && payload.job?.id) {
        setOperationMessage(`Delete queued as background job: ${payload.job.id}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["files-search"] });
      void queryClient.invalidateQueries({ queryKey: ["multipart-sessions"] });
    }
  });

  const renameMutation = useMutation({
    mutationFn: (input: { oldKey: string; newKey: string }) =>
      apiFetch<{ mode?: "job"; job?: { id: string } }>("/files/rename", {
        method: "POST",
        body: JSON.stringify({ bucket, ...input })
      }),
    onSuccess: (payload) => {
      if (payload?.mode === "job" && payload.job?.id) {
        setOperationMessage(`Rename queued as background job: ${payload.job.id}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["files-search"] });
    }
  });

  const folderMutation = useMutation({
    mutationFn: (folderPath: string) =>
      apiFetch("/files/folder", {
        method: "POST",
        body: JSON.stringify({ bucket, folderPath })
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    }
  });

  const statsMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ totalSize: number; objectCount: number; folderCount: number; latestModified: string | null }>(
        `/files/stats?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix)}`
      ),
    onSuccess: (stats) => {
      setStatsText(
        `Objects: ${stats.objectCount} | Folders: ${stats.folderCount} | Size: ${formatBytes(stats.totalSize)} | Latest: ${stats.latestModified ?? "n/a"}`
      );
    }
  });

  const abortSessionMutation = useMutation({
    mutationFn: (uploadSessionId: string) =>
      apiFetch(`/files/multipart/${uploadSessionId}/abort`, {
        method: "POST"
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["multipart-sessions"] });
    }
  });

  useEffect(() => {
    const firstBucket = bucketsQuery.data?.[0];
    if (!bucket && firstBucket) {
      setBucket(firstBucket.name);
    }
  }, [bucket, bucketsQuery.data]);

  useEffect(() => {
    return () => {
      uploadControllersRef.current.forEach((controller) => controller.abort());
      uploadControllersRef.current.clear();
    };
  }, []);

  if (meQuery.data && !meQuery.data.user) {
    router.replace("/login");
    return null;
  }

  const entries = activeSearch ? searchQuery.data?.entries ?? [] : listQuery.data?.entries ?? [];

  const breadcrumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    const result = [{ label: "Root", value: "" }];
    let current = "";
    for (const part of parts) {
      current = `${current}${part}/`;
      result.push({ label: part, value: current });
    }
    return result;
  }, [prefix]);

  async function handleUploadFiles(files: FileList | File[]) {
    if (!bucket || !files.length) {
      return;
    }

    const list = Array.from(files);

    for (const file of list) {
      const relative = file.webkitRelativePath || file.name;
      const key = normalizeObjectKey(prefix ? `${prefix}${relative}` : relative);
      const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const abortController = new AbortController();
      let uploadSessionId: string | null = null;

      setUploadJobs((prev) => [...prev, { id: jobId, name: relative, progress: 0, status: "queued" }]);
      uploadControllersRef.current.set(jobId, abortController);

      try {
        setUploadJobs((prev) =>
          prev.map((job) => (job.id === jobId ? { ...job, status: "running", error: undefined } : job))
        );

        const partSize = PART_SIZE;
        const totalParts = Math.max(1, Math.ceil(file.size / partSize));
        const recoverable = await apiFetch<ResumableSession | null>("/files/multipart/recover", {
          method: "POST",
          body: JSON.stringify({
            bucket,
            key,
            fileSize: file.size,
            partSize
          })
        });

        let sessionId: string;
        const completedPartsMap = new Map<number, CompletedPart>();
        if (recoverable) {
          sessionId = recoverable.id;
          for (const part of recoverable.completedParts ?? []) {
            completedPartsMap.set(part.partNumber, part);
          }
        } else {
          const initialized = await apiFetch<{ uploadSessionId: string; uploadId: string }>("/files/multipart/init", {
            method: "POST",
            body: JSON.stringify({
              bucket,
              key,
              contentType: file.type || undefined,
              fileSize: file.size,
              partSize,
              totalParts,
              relativePath: relative
            })
          });
          sessionId = initialized.uploadSessionId;
        }

        uploadSessionId = sessionId;

        setUploadJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  uploadSessionId: sessionId
                }
              : job
          )
        );

        const partNumbers = Array.from({ length: totalParts }, (_, index) => index + 1);
        const missingPartNumbers = partNumbers.filter((partNumber) => !completedPartsMap.has(partNumber));
        const alreadyUploadedBytes = calculateUploadedBytes(file.size, partSize, [...completedPartsMap.keys()]);

        if (missingPartNumbers.length > 0) {
          const signed = await apiFetch<{ parts: Array<{ partNumber: number; url: string }> }>(
            `/files/multipart/${sessionId}/sign-parts`,
            {
              method: "POST",
              body: JSON.stringify({ partNumbers: missingPartNumbers })
            }
          );

          await uploadPartsWithConcurrency({
            file,
            parts: signed.parts,
            partSize,
            contentType: file.type || undefined,
            concurrency: 4,
            maxRetries: 3,
            signal: abortController.signal,
            onProgress: (loaded) => {
              const uploaded = Math.min(file.size, alreadyUploadedBytes + loaded);
              const denominator = file.size > 0 ? file.size : 1;
              setUploadJobs((prev) =>
                prev.map((job) =>
                  job.id === jobId
                    ? {
                        ...job,
                        progress: Math.round((uploaded / denominator) * 100)
                      }
                    : job
                )
              );
            },
            onPartComplete: async (part) => {
              completedPartsMap.set(part.partNumber, part);
              await apiFetch(`/files/multipart/${sessionId}/part-complete`, {
                method: "POST",
                body: JSON.stringify(part)
              });
            }
          });
        } else {
          setUploadJobs((prev) =>
            prev.map((job) =>
              job.id === jobId
                ? {
                    ...job,
                    progress: 100
                  }
                : job
            )
          );
        }

        const completed = [...completedPartsMap.values()].sort((a, b) => a.partNumber - b.partNumber);
        if (completed.length === 0) {
          throw new Error("No multipart parts available to complete upload");
        }

        await apiFetch(`/files/multipart/${sessionId}/complete`, {
          method: "POST",
          body: JSON.stringify({ parts: completed })
        });

        setUploadJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: "done", progress: 100 } : job)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        const isAbort = isAbortUploadError(error) || abortController.signal.aborted;

        if (uploadSessionId) {
          try {
            if (isAbort) {
              await apiFetch(`/files/multipart/${uploadSessionId}/abort`, { method: "POST" });
            } else {
              await apiFetch(`/files/multipart/${uploadSessionId}/fail`, {
                method: "POST",
                body: JSON.stringify({
                  error: message
                })
              });
            }
          } catch {
            // Session cleanup best effort only; preserve original user-visible error.
          }
        }

        setUploadJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: isAbort ? "aborted" : "error",
                  error: isAbort ? "Upload canceled by user" : message
                }
              : job
          )
        );
      } finally {
        uploadControllersRef.current.delete(jobId);
      }
    }

    void queryClient.invalidateQueries({ queryKey: ["files"] });
    void queryClient.invalidateQueries({ queryKey: ["multipart-sessions"] });
  }

  return (
    <PageShell
      title="Storage Browser"
      subtitle={meQuery.data?.user ? `Signed in as ${meQuery.data.user.username}` : "Checking session..."}
      actions={
        <>
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["files"] });
              void queryClient.invalidateQueries({ queryKey: ["files-search"] });
            }}
          >
            <RefreshCw className="mr-1 inline h-4 w-4" /> Refresh
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              if (!bucket) {
                return;
              }
              const name = prompt("Folder name");
              if (!name) {
                return;
              }
              void folderMutation.mutate(`${prefix}${name}`);
            }}
          >
            <FolderPlus className="mr-1 inline h-4 w-4" /> Folder
          </button>
          <button
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="mr-1 inline h-4 w-4" /> Upload
          </button>
        </>
      }
    >
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={(event) => {
          if (event.target.files) {
            void handleUploadFiles(event.target.files);
          }
          event.target.value = "";
        }}
      />
      <input
        ref={directoryInputRef}
        className="hidden"
        type="file"
        multiple
        // @ts-expect-error non-standard but supported by Chromium-based browsers
        webkitdirectory=""
        onChange={(event) => {
          if (event.target.files) {
            void handleUploadFiles(event.target.files);
          }
          event.target.value = "";
        }}
      />

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
        <label className="text-sm md:col-span-2">
          Bucket
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={bucket}
            onChange={(event) => {
              setBucket(event.target.value);
              setPrefix("");
              setActiveSearch("");
            }}
          >
            {bucketsQuery.data?.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm md:col-span-2">
          Search
          <div className="mt-1 flex items-center gap-2">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search files and folders"
            />
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              onClick={() => setActiveSearch(searchTerm.trim())}
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        </label>

        <div className="flex items-end gap-2">
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onClick={() => setViewMode(viewMode === "table" ? "grid" : "table")}
          >
            {viewMode === "table" ? "Grid" : "Table"}
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onClick={() => {
              void statsMutation.mutate();
            }}
          >
            Stats
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {breadcrumbs.map((crumb, index) => (
          <button
            key={`${crumb.value}-${index}`}
            onClick={() => setPrefix(crumb.value)}
            className="rounded-md px-2 py-1 hover:bg-slate-100"
          >
            {crumb.label}
          </button>
        ))}
      </div>

      <div
        className="mb-4 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files?.length) {
            void handleUploadFiles(event.dataTransfer.files);
          }
        }}
      >
        Drag and drop files/folders here. Directory selection is also available.
        <div className="mt-3 flex justify-center gap-2">
          <button className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => fileInputRef.current?.click()}>
            Select Files
          </button>
          <button className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => directoryInputRef.current?.click()}>
            Select Directory
          </button>
        </div>
      </div>

      {statsText ? (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">{statsText}</div>
      ) : null}
      {operationMessage ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {operationMessage}
        </div>
      ) : null}

      {resumableUploadsQuery.data?.length ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Resumable uploads</h3>
          <div className="mt-3 space-y-2">
            {resumableUploadsQuery.data.map((session) => (
              <div key={session.id} className="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{session.objectKey}</p>
                    <p>
                      {session.status} | {session.completedPartNumbers.length}/{session.totalParts ?? "?"} parts
                    </p>
                  </div>
                  {(session.status === "INITIATED" || session.status === "IN_PROGRESS" || session.status === "FAILED") ? (
                    <button
                      className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700"
                      onClick={() => {
                        void abortSessionMutation.mutate(session.id);
                      }}
                    >
                      Abort
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState title="No objects" description="This location is empty or no results match the current search." />
      ) : viewMode === "table" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Modified</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.key}>
                  <td className="px-4 py-3">
                    <button
                      className="font-medium text-slate-900 hover:text-blue-700"
                      onClick={() => {
                        if (entry.kind === "folder") {
                          setPrefix(entry.key);
                        } else {
                          previewMutation.mutate(entry.key);
                        }
                      }}
                    >
                      {entry.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{entry.kind}</td>
                  <td className="px-4 py-3 text-slate-600">{entry.kind === "file" ? formatBytes(entry.size) : "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{entry.kind === "file" ? entry.lastModified ?? "-" : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {entry.kind === "file" ? (
                        <button
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                          onClick={() => previewMutation.mutate(entry.key)}
                        >
                          <Eye className="mr-1 inline h-3.5 w-3.5" /> Preview
                        </button>
                      ) : null}
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                        onClick={() => {
                          const nextName = prompt("New name", entry.name);
                          if (!nextName) return;

                          const basePath = entry.key.split("/").slice(0, -2).join("/");
                          const newKey = `${basePath ? `${basePath}/` : ""}${nextName}${entry.kind === "folder" ? "/" : ""}`;
                          void renameMutation.mutate({ oldKey: entry.key, newKey });
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                        onClick={() => {
                          if (!confirm(`Delete ${entry.name}?`)) return;
                          void deleteMutation.mutate(entry.key);
                        }}
                      >
                        <Trash2 className="mr-1 inline h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {entries.map((entry) => (
            <div key={entry.key} className="rounded-xl border border-slate-200 bg-white p-4">
              <button
                className="block text-left text-sm font-medium text-slate-900 hover:text-blue-700"
                onClick={() => {
                  if (entry.kind === "folder") {
                    setPrefix(entry.key);
                  } else {
                    previewMutation.mutate(entry.key);
                  }
                }}
              >
                {entry.name}
              </button>
              <p className="mt-1 text-xs text-slate-500">{entry.kind === "file" ? formatBytes(entry.size) : "Folder"}</p>
            </div>
          ))}
        </div>
      )}

      {uploadJobs.length ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Uploads</h3>
          <div className="mt-3 space-y-2">
            {uploadJobs.map((job) => (
              <div key={job.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>{job.name}</span>
                  <div className="flex items-center gap-2">
                    <span>{job.status}</span>
                    {job.status === "running" ? (
                      <button
                        className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-700"
                        onClick={() => {
                          uploadControllersRef.current.get(job.id)?.abort();
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${job.progress}%` }} />
                </div>
                {job.error ? <p className="mt-1 text-xs text-red-700">{job.error}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">Preview: {preview.key}</h4>
              <button className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded border border-slate-200">
              {preview.payload.previewType === "image" ? (
                <img src={preview.payload.url} alt={preview.key} className="max-h-[68vh] w-auto object-contain" />
              ) : preview.payload.previewType === "video" ? (
                <video src={preview.payload.url} controls className="max-h-[68vh] w-full" />
              ) : preview.payload.previewType === "audio" ? (
                <audio src={preview.payload.url} controls className="m-4" />
              ) : preview.payload.previewType === "download" ? (
                <div className="p-5 text-sm">
                  <p>Direct preview is not available for this file type.</p>
                  <a className="mt-2 inline-block rounded bg-blue-600 px-3 py-2 text-white" href={preview.payload.url}>
                    Download
                  </a>
                </div>
              ) : (
                <iframe src={preview.payload.url} className="h-[68vh] w-full" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function normalizeObjectKey(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function calculateUploadedBytes(fileSize: number, partSize: number, partNumbers: number[]): number {
  return partNumbers.reduce((sum, partNumber) => {
    if (partNumber < 1) {
      return sum;
    }
    const start = (partNumber - 1) * partSize;
    if (start >= fileSize) {
      return sum;
    }
    const end = Math.min(start + partSize, fileSize);
    return sum + Math.max(end - start, 0);
  }, 0);
}
