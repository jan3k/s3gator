"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "@/lib/api-client";

const formSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(8).max(1024),
  mode: z.enum(["local", "ldap"])
});

type FormValues = z.infer<typeof formSchema>;

export default function LoginPage() {
  const router = useRouter();

  const meQuery = useQuery({
    queryKey: ["session", "me"],
    queryFn: () => apiFetch<{ user: { id: string } | null }>("/auth/me")
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
      mode: "local"
    }
  });

  const loginMutation = useMutation({
    mutationFn: (values: FormValues) =>
      apiFetch<{ user: { id: string } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      }),
    onSuccess: () => {
      router.push("/files");
    }
  });

  const onSubmit = (values: FormValues) => {
    loginMutation.mutate(values);
  };

  useEffect(() => {
    if (meQuery.data?.user) {
      router.replace("/files");
    }
  }, [meQuery.data?.user, router]);

  return (
    <div className="mx-auto mt-20 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Use your local or LDAP account.</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <label className="block text-sm font-medium text-slate-700">
          Username
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-blue-500"
            {...form.register("username")}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-blue-500"
            {...form.register("password")}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Auth Mode
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-blue-500"
            {...form.register("mode")}
          >
            <option value="local">Local</option>
            <option value="ldap">LDAP</option>
          </select>
        </label>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-red-700">{form.formState.errors.root.message}</p>
        ) : null}

        {loginMutation.error ? (
          <p className="text-sm text-red-700">{loginMutation.error.message}</p>
        ) : null}

        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loginMutation.isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
