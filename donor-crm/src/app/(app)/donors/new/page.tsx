"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ContactForm, { emptyDraft, type ContactDraft } from "@/components/ContactForm";

export default function NewDonorPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(d: ContactDraft) {
    setSaving(true);
    setError(null);
    const supabase = createClient();

    // warn before creating an obvious duplicate
    if (d.email) {
      const { data: existing } = await supabase
        .from("contacts")
        .select("id, first_name, last_name")
        .or(`email.eq."${d.email}",alt_emails.cs.{"${d.email}"}`)
        .limit(1);
      if (existing?.length) {
        const e = existing[0];
        setSaving(false);
        if (!confirm(`${e.first_name} ${e.last_name} already uses ${d.email}. Create a separate donor anyway?`)) {
          router.push(`/donors/${e.id}`);
          return;
        }
        setSaving(true);
      }
    }

    const { data, error } = await supabase.from("contacts").insert(d).select("id").single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/donors/${data.id}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/donors" className="text-sm font-semibold text-teal-700">← All donors</Link>
        <h1 className="mt-2 font-display text-2xl font-semibold">Add a donor</h1>
        <p className="muted text-sm">After saving, you can record their gifts on the donor&rsquo;s page.</p>
      </div>
      <div className="card p-6">
        <ContactForm initial={emptyDraft} saving={saving} onSave={save} submitLabel="Save donor" />
        {error && <p className="mt-3 text-sm text-coral-600">{error}</p>}
      </div>
    </div>
  );
}
