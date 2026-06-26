import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import PersonaProvider from "@/components/PersonaProvider";
import PersonaSwitcher from "@/components/PersonaSwitcher";

export const metadata: Metadata = {
  title: "ABAC Demo — MongoDB Atlas",
  description: "Attribute-based access control with Atlas Vector Search",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PersonaProvider>
          <header className="border-b border-edge bg-white">
            <div className="max-w-7xl mx-auto flex items-center gap-6 px-6 py-3">
              <Link href="/search" className="font-semibold tracking-wide text-accent">
                ABAC · Atlas
              </Link>
              <nav className="flex gap-4 text-sm text-slate-700">
                <Link href="/search" className="hover:text-accent">Search</Link>
                <Link href="/admin" className="hover:text-accent">Policies</Link>
                <Link href="/admin/users" className="hover:text-accent">Users</Link>
              </nav>
              <div className="ml-auto">
                <PersonaSwitcher />
              </div>
            </div>
          </header>
          <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
          <footer className="text-xs text-slate-500 text-center py-6">
            Demo only · synthetic data · ABAC enforced at app layer over MongoDB Atlas
          </footer>
        </PersonaProvider>
      </body>
    </html>
  );
}
