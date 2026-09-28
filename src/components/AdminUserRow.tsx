"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types";

export default function AdminUserRow({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(profile.role);
  const [isActive, setIsActive] = useState(profile.is_active);
  const [saving, setSaving] = useState(false);

  async function save(next: Partial<{ role: Role; is_active: boolean }>) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update(next).eq("id", profile.id);
    setSaving(false);
    if (!error) {
      if (next.role) setRole(next.role);
      if (next.is_active !== undefined) setIsActive(next.is_active);
      router.refresh();
    }
  }

  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="py-2 pr-4">
        <div className="font-medium text-ink">{profile.full_name}</div>
        <div className="text-xs text-[#8b8676]">{profile.email}</div>
      </td>
      <td className="py-2 pr-4">
        <select
          className="input py-1 text-sm"
          value={role}
          disabled={saving}
          onChange={(e) => save({ role: e.target.value as Role })}
        >
          <option value="board_member">Board member</option>
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
      </td>
      <td className="py-2 pr-4">
        <button
          type="button"
          disabled={saving}
          onClick={() => save({ is_active: !isActive })}
          className={`pill ${isActive ? "pill-good" : "pill-bad"}`}
        >
          {isActive ? "Active" : "Pending"}
        </button>
      </td>
    </tr>
  );
}
