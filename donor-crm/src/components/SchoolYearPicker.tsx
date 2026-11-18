"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** School-year menu for the SMILES tab. Changing it reloads the page for that year. */
export default function SchoolYearPicker({ years, value }: { years: string[]; value: string }) {
  const router = useRouter();
  const [loading, startLoading] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <label className="label whitespace-nowrap" htmlFor="smiles-year">
        School year
      </label>
      <select
        id="smiles-year"
        className="input w-auto"
        value={value}
        disabled={loading}
        onChange={(e) => startLoading(() => router.push(`/smiles?year=${encodeURIComponent(e.target.value)}`))}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y.replace("-", "–")}
          </option>
        ))}
      </select>
      {loading && <span className="muted text-sm">Loading…</span>}
    </div>
  );
}
