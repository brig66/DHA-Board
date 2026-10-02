"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cityLine, fullName, money, shortDate } from "@/lib/format";
import type { ContactSummary } from "@/lib/types";

type Pair = { id: string; reason: string; a: ContactSummary; b: ContactSummary };

export default function DuplicatesPage() {
  const router = useRouter();
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: rows, error } = await supabase
      .from("possible_duplicates")
      .select("id, reason, contact_a, contact_b")
      .eq("status", "open")
      .order("created_at");
    if (error) return setError(error.message);
    const ids = Array.from(new Set((rows ?? []).flatMap((r) => [r.contact_a, r.contact_b])));
    const { data: contacts } = ids.length
      ? await supabase.from("contact_summary").select("*").in("id", ids)
      : { data: [] };
    const byId = new Map((contacts ?? []).map((c: ContactSummary) => [c.id, c]));
    setPairs(
      (rows ?? [])
        .filter((r) => byId.has(r.contact_a) && byId.has(r.contact_b))
        .map((r) => ({ id: r.id, reason: r.reason, a: byId.get(r.contact_a)!, b: byId.get(r.contact_b)! }))
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function merge(p: Pair, keep: ContactSummary, remove: ContactSummary) {
    if (!confirm(`Merge ${fullName(remove)} into ${fullName(keep)}? All gifts and emails move to ${fullName(keep)}, and ${fullName(remove)}'s other email, phone, and address are kept as alternates.`)) return;
    setBusy(p.id);
    const { error } = await createClient().rpc("merge_contacts", { keep_id: keep.id, remove_id: remove.id });
    setBusy(null);
    if (error) return setError(error.message);
    await load();
    router.refresh();
  }

  async function dismiss(p: Pair) {
    setBusy(p.id);
    const { error } = await createClient().from("possible_duplicates").update({ status: "dismissed" }).eq("id", p.id);
    setBusy(null);
    if (error) return setError(error.message);
    await load();
    router.refresh();
  }

  if (!pairs) return <p className="muted">{error ?? "Loading…"}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Possible duplicates</h1>
        <p className="muted text-sm">
          These donor pairs might be the same person, but the CRM wasn&rsquo;t sure enough to combine them on its own.
          Merge them if they&rsquo;re the same person, or mark them as different people (for example, a couple who share
          an email address).
        </p>
      </div>
      {error && <p className="text-sm text-coral-600">{error}</p>}
      {pairs.length === 0 && <div className="card muted p-6 text-center">Nothing to review. 🎉</div>}
      {pairs.map((p) => (
        <section key={p.id} className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="pill pill-warn">{p.reason}</span>
            <button className="btn btn-secondary btn-sm" disabled={busy === p.id} onClick={() => dismiss(p)}>
              Different people — keep both
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[
              [p.a, p.b],
              [p.b, p.a],
            ].map(([c, other]) => (
              <div key={c.id} className="rounded-lg border border-[var(--border)] p-4 text-sm">
                <Link href={`/donors/${c.id}`} className="font-display text-lg font-semibold text-teal-700">
                  {fullName(c)}
                </Link>
                <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1">
                  <dt className="muted">Email</dt>
                  <dd className="break-all">{[c.email, ...c.alt_emails].filter(Boolean).join(", ") || "—"}</dd>
                  <dt className="muted">Phone</dt>
                  <dd>{[c.phone, ...c.alt_phones].filter(Boolean).join(", ") || "—"}</dd>
                  <dt className="muted">Address</dt>
                  <dd>{c.address ? `${c.address}, ${cityLine(c)}` : "—"}</dd>
                  <dt className="muted">Gifts</dt>
                  <dd>{c.gift_count} totaling {money(c.total_given)}</dd>
                  <dt className="muted">Last gift</dt>
                  <dd>{shortDate(c.last_gift_date)} · {c.last_gift_event}</dd>
                </dl>
                <button
                  className="btn btn-primary btn-sm mt-3"
                  disabled={busy === p.id}
                  onClick={() => merge(p, c, other)}
                >
                  Same person — keep this one
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
