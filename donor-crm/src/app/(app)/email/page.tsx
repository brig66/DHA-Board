"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllContacts, getEmailRecipients, setEmailRecipients } from "@/lib/data";
import { fullName, MERGE_FIELDS } from "@/lib/format";
import { fillMergeFields } from "@/lib/merge";
import type { ContactSummary, EmailTemplate, Settings } from "@/lib/types";

type SendResult = {
  sent: number;
  failed: number;
  skipped: number;
  results: { contact_id: string; name: string; email: string | null; status: string; error?: string }[];
};

export default function EmailPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Composer />
    </Suspense>
  );
}

function Composer() {
  const params = useSearchParams();
  const [all, setAll] = useState<ContactSummary[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [addEvent, setAddEvent] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const loadTemplates = async () => {
    const { data } = await createClient().from("email_templates").select("*").order("name");
    setTemplates((data ?? []) as EmailTemplate[]);
    return (data ?? []) as EmailTemplate[];
  };

  useEffect(() => {
    const supabase = createClient();
    setIds(getEmailRecipients());
    fetchAllContacts(supabase).then(setAll);
    supabase.from("settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => setSettings(data as Settings));
    supabase.auth.getUser().then(({ data }) => data.user && setMe({ email: data.user.email ?? "" }));
    loadTemplates().then((ts) => {
      const wanted = params.get("template");
      const t = ts.find((x) => x.name === wanted);
      if (t) applyTemplate(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTemplate(t: EmailTemplate | undefined) {
    setTemplateId(t?.id ?? "");
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  const recipients = useMemo(() => ids.map((id) => byId.get(id)).filter(Boolean) as ContactSummary[], [ids, byId]);
  const sendable = recipients.filter((c) => c.email && !c.do_not_email && !c.is_anonymous);
  const notSendable = recipients.filter((c) => !(c.email && !c.do_not_email && !c.is_anonymous));
  const preview = sendable[Math.min(previewIdx, Math.max(sendable.length - 1, 0))];

  const eventOptions = useMemo(
    () =>
      Array.from(
        new Set(
          all.flatMap((c) => [
            ...(c.events ? c.events.split("; ") : []),
            ...(c.events_attended ? c.events_attended.split("; ") : []),
          ])
        )
      ).sort(),
    [all]
  );

  function updateIds(next: string[]) {
    const unique = Array.from(new Set(next));
    setIds(unique);
    setEmailRecipients(unique);
  }

  function insertField(tag: string) {
    const el = bodyRef.current;
    if (!el) return setBody(body + tag);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + tag + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + tag.length;
    });
  }

  async function callSend(contactIds: string[], testTo: string | null) {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: {
        contact_ids: contactIds,
        subject,
        body,
        template_name: templates.find((t) => t.id === templateId)?.name ?? null,
        test_to: testTo,
      },
    });
    if (error) {
      let detail = error.message;
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx) detail = (await ctx.json()).error ?? detail;
      } catch {
        /* keep the generic message */
      }
      throw new Error(detail);
    }
    return data as SendResult;
  }

  async function sendTest() {
    if (!me?.email || !sendable.length) return;
    setBusy("test");
    setMessage(null);
    try {
      const r = await callSend([(preview ?? sendable[0]).id], me.email);
      if (r.sent) setMessage({ kind: "good", text: `Test sent to ${me.email}, using ${fullName(preview ?? sendable[0])}'s details.` });
      else setMessage({ kind: "bad", text: `Test failed: ${r.results[0]?.error ?? "unknown error"}` });
    } catch (e) {
      setMessage({ kind: "bad", text: (e as Error).message });
    }
    setBusy(null);
  }

  async function sendAll() {
    if (!confirm(`Send this email to ${sendable.length} donor${sendable.length === 1 ? "" : "s"}? Each one gets their own copy.`)) return;
    setBusy("send");
    setMessage(null);
    setResult(null);
    try {
      const totals: SendResult = { sent: 0, failed: 0, skipped: 0, results: [] };
      const list = sendable.map((c) => c.id);
      // send in batches so a large list doesn't time out
      for (let i = 0; i < list.length; i += 40) {
        const r = await callSend(list.slice(i, i + 40), null);
        totals.sent += r.sent;
        totals.failed += r.failed;
        totals.skipped += r.skipped;
        totals.results.push(...r.results);
      }
      setResult(totals);
      fetchAllContacts(createClient()).then(setAll);
    } catch (e) {
      setMessage({ kind: "bad", text: (e as Error).message });
    }
    setBusy(null);
  }

  async function saveTemplate(asNew: boolean) {
    const supabase = createClient();
    if (asNew || !templateId) {
      const name = prompt("Name for this template:");
      if (!name) return;
      const { data, error } = await supabase.from("email_templates").insert({ name, subject, body }).select().single();
      if (error) return setMessage({ kind: "bad", text: error.message });
      await loadTemplates();
      setTemplateId((data as EmailTemplate).id);
    } else {
      const { error } = await supabase
        .from("email_templates")
        .update({ subject, body, updated_at: new Date().toISOString() })
        .eq("id", templateId);
      if (error) return setMessage({ kind: "bad", text: error.message });
      await loadTemplates();
    }
    setMessage({ kind: "good", text: "Template saved." });
  }

  async function deleteTemplate() {
    const t = templates.find((x) => x.id === templateId);
    if (!t || !confirm(`Delete the template "${t.name}"?`)) return;
    await createClient().from("email_templates").delete().eq("id", t.id);
    setTemplateId("");
    loadTemplates();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Email donors</h1>
        <p className="muted text-sm">
          Each donor receives their own personal copy, sent from{" "}
          <strong>{settings ? `${settings.sender_name} <${settings.sender_email}>` : "…"}</strong>. Every email is
          saved to the donor&rsquo;s history.
        </p>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">
            Recipients <span className="muted text-base font-normal">({sendable.length} will receive it)</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={addEvent} onChange={(e) => setAddEvent(e.target.value)}>
              <option value="">Add everyone who gave at or attended an event…</option>
              {eventOptions.map((e) => <option key={e}>{e}</option>)}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!addEvent}
              onClick={() => {
                updateIds([
                  ...ids,
                  ...all
                    .filter(
                      (c) =>
                        (c.events ?? "").split("; ").includes(addEvent) ||
                        (c.events_attended ?? "").split("; ").includes(addEvent)
                    )
                    .map((c) => c.id),
                ]);
                setAddEvent("");
              }}
            >
              Add
            </button>
            <Link href="/donors" className="btn btn-secondary btn-sm">Pick on Donors page</Link>
            {ids.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => updateIds([])}>Clear all</button>
            )}
          </div>
        </div>
        {recipients.length === 0 ? (
          <p className="muted mt-3 text-sm">
            No recipients yet. Choose donors on the <Link href="/donors" className="font-semibold text-teal-700">Donors</Link> page
            (tick the boxes, then &ldquo;Email selected&rdquo;), or add everyone from an event above.
          </p>
        ) : (
          <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {sendable.map((c) => (
              <span key={c.id} className="pill pill-good gap-1">
                {fullName(c)}
                <button aria-label={`Remove ${fullName(c)}`} onClick={() => updateIds(ids.filter((x) => x !== c.id))}>×</button>
              </span>
            ))}
          </div>
        )}
        {notSendable.length > 0 && (
          <p className="mt-3 text-sm text-[#b8862e]">
            {notSendable.length} selected donor{notSendable.length === 1 ? "" : "s"} will be skipped (no email address or marked
            do-not-email): {notSendable.map(fullName).join(", ")}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="label">Template</label>
              <select
                className="input mt-1"
                value={templateId}
                onChange={(e) => applyTemplate(templates.find((t) => t.id === e.target.value))}
              >
                <option value="">Start from scratch</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {templateId && <button className="btn btn-secondary btn-sm" onClick={() => saveTemplate(false)}>Update template</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => saveTemplate(true)} disabled={!subject || !body}>Save as new</button>
            {templateId && <button className="btn btn-danger btn-sm" onClick={deleteTemplate}>Delete</button>}
          </div>
          <div>
            <label className="label">Subject</label>
            <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea ref={bodyRef} rows={14} className="input mt-1" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div>
            <div className="label">Insert donor details</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {MERGE_FIELDS.map((f) => (
                <button key={f.tag} type="button" className="btn btn-secondary btn-sm" onClick={() => insertField(f.tag)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Preview</h2>
            {sendable.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <button className="btn btn-secondary btn-sm" onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}>‹</button>
                {Math.min(previewIdx, sendable.length - 1) + 1} of {sendable.length}
                <button className="btn btn-secondary btn-sm" onClick={() => setPreviewIdx(Math.min(sendable.length - 1, previewIdx + 1))}>›</button>
              </div>
            )}
          </div>
          {preview ? (
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 text-sm">
              <div className="muted text-xs">To: {fullName(preview)} &lt;{preview.email}&gt;</div>
              <div className="mt-1 font-semibold">{fillMergeFields(subject, preview) || "(no subject)"}</div>
              <hr className="my-3 border-[var(--border)]" />
              <div className="whitespace-pre-wrap">{fillMergeFields(body, preview)}</div>
              {settings?.email_footer && (
                <p className="muted mt-4 border-t border-[var(--border)] pt-2 text-xs">{settings.email_footer}</p>
              )}
            </div>
          ) : (
            <p className="muted text-sm">Add recipients to see a preview.</p>
          )}

          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <button className="btn btn-secondary" onClick={sendTest} disabled={!!busy || !preview || !subject || !body}>
              {busy === "test" ? "Sending test…" : `Send a test to me`}
            </button>
            <button className="btn btn-primary" onClick={sendAll} disabled={!!busy || !sendable.length || !subject || !body}>
              {busy === "send" ? "Sending…" : `Send to ${sendable.length} donor${sendable.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {message && (
            <p className={`text-sm ${message.kind === "good" ? "text-teal-700" : "text-coral-600"}`}>{message.text}</p>
          )}
          {result && (
            <div className="rounded-lg bg-[#faf8f3] p-3 text-sm">
              <strong>{result.sent} sent</strong>
              {result.failed > 0 && <>, <span className="text-coral-600">{result.failed} failed</span></>}
              {result.skipped > 0 && <>, {result.skipped} skipped</>}.
              {result.results.filter((r) => r.status !== "sent").map((r) => (
                <div key={r.contact_id} className="muted text-xs">{r.name}: {r.error}</div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
