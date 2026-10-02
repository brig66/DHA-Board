"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function TopNav({ profile, openDuplicates }: { profile: Profile; openDuplicates: number }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/donors", label: "Donors" },
    { href: "/board", label: "Board" },
    { href: "/email", label: "Email" },
    { href: "/import", label: "Import" },
    { href: "/duplicates", label: "Possible Duplicates", badge: openDuplicates },
    ...(profile.role === "admin" ? [{ href: "/settings", label: "Settings" }] : []),
  ];

  return (
    <header className="border-b border-[var(--border)] bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/dashboard" className="font-display text-lg font-semibold text-teal-700">
            DHA Donor CRM
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-1 text-sm font-medium ${
                  pathname.startsWith(l.href) ? "text-teal-700" : "text-[#5c584d]"
                }`}
              >
                {l.label}
                {!!l.badge && <span className="pill pill-warn">{l.badge}</span>}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[#5c584d] sm:inline">
            {profile.full_name} &middot; {profile.role === "admin" ? "Admin" : "Staff"}
          </span>
          <button onClick={signOut} className="btn btn-secondary btn-sm">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
