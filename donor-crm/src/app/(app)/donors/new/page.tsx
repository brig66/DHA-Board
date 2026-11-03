"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ContactForm, { emptyDraft, type ContactDraft } from "@/components/ContactForm";

export default function NewDonorPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewPerson />
    </Suspense>
  );
}

function NewPerson() {
  const router = useRouter();
  const params = useSearchParams();
  // "+ Add volunteer" opens this page with the Volunteer box already ticked
  const asVolunteer = params.get("volunteer") === "1";
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
        if (!confirm(`${e.first_name} ${e.last_name} already uses ${d.email}. Create a separate record anyway?`)) {
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
        <h1 className="mt-2 font-display text-2xl font-semibold">
          {asVolunteer ? "Add a volunteer" : "Add a donor or volunteer"}
        </h1>
        <p className="muted text-sm">
          After saving, you can record their gifts on their page. Tick <strong>Volunteer</strong> to also log the
          time they give. Volunteers are not given access to the CRM.
        </p>
      </div>
      <div className="card p-6">
        <ContactForm
          initial={asVolunteer ? { ...emptyDraft, is_volunteer: true } : emptyDraft}
          saving={saving}
          onSave={save}
          submitLabel={asVolunteer ? "Save volunteer" : "Save"}
        />
        {error && <p className="mt-3 text-sm text-coral-600">{error}</p>}
      </div>
    </div>
  );
}
