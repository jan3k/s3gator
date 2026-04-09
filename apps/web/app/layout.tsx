import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "S3Gator Storage Manager",
  description: "Garage S3 v2.2.0 storage manager"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen">
            <header className="border-b border-slate-200 bg-white/85 backdrop-blur">
              <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
                <Link href="/files" className="text-lg font-semibold tracking-tight text-slate-900">
                  S3Gator
                </Link>
                <nav className="flex items-center gap-3 text-sm text-slate-600">
                  <Link className="rounded-md px-3 py-1.5 hover:bg-slate-100" href="/files">
                    Files
                  </Link>
                  <Link className="rounded-md px-3 py-1.5 hover:bg-slate-100" href="/admin">
                    Admin
                  </Link>
                </nav>
              </div>
            </header>
            <main>{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
