"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function TopNav({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const orgName = process.env.NEXT_PUBLIC_ORG_NAME || "Board Portal";

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const canManage = profile.role === "admin" || profile.role === "staff";

  const links = [
    { href: "/meetings", label: "Meetings" },
    ...(profile.role === "admin" ? [{ href: "/admin", label: "Utilization & Access" }] : []),
  ];

  return (
    <header className="border-b border-[var(--border)] bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/meetings" className="font-display text-lg font-semibold text-teal-700">
            {orgName} Board
          </Link>
          <nav className="hidden gap-4 sm:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm font-medium ${
                  pathname.startsWith(l.href) ? "text-teal-700" : "text-[#5c584d]"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[#5c584d] sm:inline">
            {profile.full_name} &middot; {canManage ? "Staff" : "Board Member"}
          </span>
          <button onClick={signOut} className="btn btn-secondary">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
