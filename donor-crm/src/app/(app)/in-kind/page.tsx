"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAll, fetchAllContacts } from "@/lib/data";
import { downloadCsv, fullName, money, shortDate } from "@/lib/format";
import { todayLocal } from "@/lib/thanks";
import ContactPicker, { type PickerContact } from "@/components/ContactPicker";
import EmailPreview from "@/components/EmailPreview";
import {
  LETTER_TEMPLATE_NAME,
  defaultMessage,
  defaultSubject,
  fillText,
  itemList,
  messageHtml,
  raisedSentence,
  type LetterVars,
} from "@/lib/letters";
import { buildEmailHtml, htmlToText } from "../../../../supabase/functions/_shared/email-html";
import { SALE_TYPES, THANK_METHODS, type ContactSummary, type InkindItem, type LetterKind, type Settings } from "@/lib/types";

type GiftLite = { id: string; thanked_on: string | null; thanked_method: string | null };
type SendResult = { sent: number; failed: number; skipped: number; results: { status: string; error?: string }[] };

type Draft = {
  id: string | null;
  event_name: string;
  item_number: string;
  title: string;
  description: string;
  sale_type: string;
  is_service: boolean;
  donor_contact_id: string | null;
  fair_market_value: string;
  received_date: string;
  buyer_contact_id: string | null;
  bidder_number: string;
  sold_amount: string;
  sold_date: string;
  notes: string;
};

const blank = (event: string): Draft => ({
  id: null, event_name: event, item_number: "", title: "", description: "", sale_type: "Silent auction", is_service: false,
  donor_contact_id: null, fair_market_value: "", received_date: todayLocal(), buyer_contact_id: null, bidder_number: "",
  sold_amount: "", sold_date: "", notes: "",
});

const toDraft = (i: InkindItem): Draft => ({
  id: i.id, event_name: i.event_name, item_number: i.item_number ?? "", title: i.title, description: i.description ?? "",
  sale_type: i.sale_type ?? "", is_service: i.is_service, donor_contact_id: i.donor_contact_id,
  fair_market_value: i.fair_market_value === null ? "" : String(Number(i.fair_market_value)), received_date: i.received_date ?? "",
  buyer_contact_id: i.buyer_contact_id, bidder_number: i.bidder_number ?? "",
  sold_amount: i.sold_amount === null ? "" : String(Number(i.sold_amount)), sold_date: i.sold_date ?? "", notes: i.notes ?? "",
});

const amountOrNull = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? NaN : n;
};

export default function InKindPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <InKind />
    </Suspense>
  );
}

type Group = { contact: ContactSummary; items: InkindItem[] };

function InKind() {
  const params = useSearchParams();
  const [items, setItems] = useState<InkindItem[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [gifts, setGifts] = useState<Map<string, GiftLite>>(new Map());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ kind: LetterKind; subject: string; text: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [thank, setThank] = useState<{ method: string; on: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    try {
      // in-kind gifts recorded elsewhere (a gift spreadsheet, the donor page) show up here
      await supabase.rpc("adopt_inkind_gifts");
      const [it, cs, gs, st, user] = await Promise.all([
        fetchAll<InkindItem>(supabase, "inkind_items", "*"),
        fetchAllContacts(supabase),
        fetchAll<GiftLite & { gift_type: string }>(supabase, "donations", "id, thanked_on, thanked_method, gift_type"),
        supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
        supabase.auth.getUser(),
      ]);
      setItems(it);
      setContacts(cs);
      setGifts(new Map(gs.filter((g) => g.gift_type === "In-kind").map((g) => [g.id, g])));
      setSettings(st.data as Settings | null);
      setMe(user.data.user?.email ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  // events, most recently active first
  const events = useMemo(() => {
    const latest = new Map<string, string>();
    for (const i of items) {
      const d = i.received_date ?? i.created_at.slice(0, 10);
      if (!latest.has(i.event_name) || d > latest.get(i.event_name)!) latest.set(i.event_name, d);
    }
    return Array.from(latest.entries()).sort((a, b) => b[1].localeCompare(a[1])).map(([e]) => e);
  }, [items]);

  useEffect(() => {
    if (!loading && !event && events.length && !params.get("item")) setEvent(events[0]);
  }, [loading, events, event, params]);

  // a link from a donor's page opens that item
  useEffect(() => {
    const id = params.get("item");
    if (loading || opened.current || !id) return;
    const it = items.find((i) => i.id === id);
    opened.current = true;
    if (it) {
      setEvent(it.event_name);
      setForm(toDraft(it));
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [loading, items, params]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => !event || i.event_name === event)
      .filter((i) => {
        if (!q) return true;
        const donor = i.donor_contact_id ? byId.get(i.donor_contact_id) : undefined;
        const buyer = i.buyer_contact_id ? byId.get(i.buyer_contact_id) : undefined;
        return [i.title, i.description, i.item_number, donor && fullName(donor), donor?.organization, buyer && fullName(buyer)]
          .join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) =>
        (a.item_number ?? "").localeCompare(b.item_number ?? "", undefined, { numeric: true }) || a.title.localeCompare(b.title)
      );
  }, [items, event, search, byId]);

  const totals = useMemo(() => {
    const withDonor = shown.filter((i) => i.donor_contact_id);
    return {
      value: shown.reduce((s, i) => s + Number(i.fair_market_value ?? 0), 0),
      sold: shown.reduce((s, i) => s + Number(i.sold_amount ?? 0), 0),
      soldCount: shown.filter((i) => i.sold_amount !== null).length,
      withDonor: withDonor.length,
      thanked: withDonor.filter((i) => thankedLabel(i) !== null).length,
    };
  }, [shown, gifts]); // eslint-disable-line react-hooks/exhaustive-deps

  function thankedLabel(i: InkindItem): string | null {
    if (i.donor_letter_sent_at) return `Letter emailed ${shortDate(i.donor_letter_sent_at)}`;
    const g = i.donation_id ? gifts.get(i.donation_id) : undefined;
    if (g?.thanked_on) return `${g.thanked_method ?? "Thanked"} · ${shortDate(g.thanked_on)}`;
    return null;
  }

  const selectedItems = shown.filter((i) => selected.has(i.id));
  const allShown = shown.length > 0 && shown.every((i) => selected.has(i.id));

  function groups(kind: LetterKind, list: InkindItem[]): { groups: Group[]; left: InkindItem[] } {
    const map = new Map<string, Group>();
    const left: InkindItem[] = [];
    for (const i of list) {
      const cid = kind === "inkind_ack" ? i.donor_contact_id : i.buyer_contact_id;
      const okReceipt = kind === "inkind_ack" || (i.sold_amount !== null && i.fair_market_value !== null);
      const c = cid ? byId.get(cid) : undefined;
      if (!c || !okReceipt) {
        left.push(i);
        continue;
      }
      const g = map.get(c.id) ?? { contact: c, items: [] };
      g.items.push(i);
      map.set(c.id, g);
    }
    return { groups: Array.from(map.values()), left };
  }

  const canEmail = (c: ContactSummary) => !!c.email && !c.do_not_email;
  const org = settings?.org_display_name ?? "Dental Health Arlington";
  const site = (settings?.site_url || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");

  function varsFor(kind: LetterKind, g: Group): LetterVars {
    const evs = Array.from(new Set(g.items.map((i) => i.event_name).filter((e) => e !== "In-kind donation")));
    return {
      first_name: g.contact.first_name || g.contact.organization || g.contact.last_name || "Friend",
      items: itemList(g.items.map((i) => i.title)),
      event: evs.length === 1 ? evs[0] : org,
      raised: kind === "inkind_ack" ? raisedSentence(g.items.reduce((s, i) => s + Number(i.sold_amount ?? 0), 0)) : "",
    };
  }

  function startCompose(kind: LetterKind) {
    const ev = event && event !== "In-kind donation" ? event : org;
    setCompose({
      kind,
      subject: defaultSubject(kind, ev),
      text: defaultMessage(kind, org, settings?.letter_signer_name ?? "", settings?.letter_signer_title ?? ""),
    });
    setMessage(null);
    setError(null);
  }

  async function createLetter(kind: LetterKind, g: Group): Promise<string> {
    const { data, error } = await createClient().rpc("create_letter", {
      p_kind: kind,
      p_contact: g.contact.id,
      p_item_ids: g.items.map((i) => i.id),
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async function sendOne(kind: LetterKind, g: Group, testTo: string | null, batchId: string | null): Promise<SendResult> {
    if (!compose) throw new Error("Nothing to send");
    const letterId = await createLetter(kind, g);
    const v = varsFor(kind, g);
    const url = `${site}/letter/${letterId}`;
    const html = messageHtml(compose.text, v, url, kind === "inkind_ack" ? "Download your letter (PDF)" : "Download your receipt (PDF)");
    const { data, error } = await createClient().functions.invoke("send-email", {
      body: {
        contact_ids: [g.contact.id],
        subject: fillText(compose.subject, v),
        body: htmlToText(html),
        body_html: html,
        template_name: LETTER_TEMPLATE_NAME[kind],
        test_to: testTo,
        batch_id: batchId,
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
    const r = data as SendResult;
    if (!testTo && r.sent) {
      const { error: e2 } = await createClient().rpc("mark_letter_emailed", { p_letter: letterId });
      if (e2) throw new Error(e2.message);
    }
    return r;
  }

  async function sendTest() {
    if (!compose || !me) return;
    const { groups: gs } = groups(compose.kind, selectedItems);
    const g = gs.find((x) => canEmail(x.contact)) ?? gs[0];
    if (!g) return;
    setSending("test");
    setError(null);
    try {
      const r = await sendOne(compose.kind, g, me, null);
      setMessage(r.sent ? `Test sent to ${me}, using ${fullName(g.contact)}'s details. Open it to check the wording and the download.` : `Test failed: ${r.results[0]?.error ?? "unknown error"}`);
    } catch (e) {
      setError((e as Error).message);
    }
    setSending(null);
  }

  async function sendAll() {
    if (!compose) return;
    const { groups: gs } = groups(compose.kind, selectedItems);
    const targets = gs.filter((g) => canEmail(g.contact));
    if (!targets.length) return;
    const what = compose.kind === "inkind_ack" ? "thank-you letter" : "receipt";
    if (!confirm(`Email a ${what} to ${targets.length} ${targets.length === 1 ? "person" : "people"}? Each one gets their own copy.`)) return;
    const batchId = crypto.randomUUID();
    let sent = 0;
    const problems: string[] = [];
    for (const [n, g] of targets.entries()) {
      setSending(`${n + 1}/${targets.length}`);
      try {
        const r = await sendOne(compose.kind, g, null, batchId);
        if (r.sent) sent++;
        else problems.push(`${fullName(g.contact)}: ${r.results[0]?.error ?? r.results[0]?.status ?? "not sent"}`);
      } catch (e) {
        problems.push(`${fullName(g.contact)}: ${(e as Error).message}`);
      }
    }
    setSending(null);
    setCompose(null);
    setSelected(new Set());
    setMessage(
      `Emailed ${sent} ${what}${sent === 1 ? "" : "s"}.` +
        (problems.length ? ` Not sent: ${problems.join("; ")}.` : "") +
        (compose.kind === "inkind_ack" ? " Those gifts are now marked thanked." : "")
    );
    await load();
  }

  async function downloadLetters(kind: LetterKind, list: InkindItem[]) {
    const { groups: gs, left } = groups(kind, list);
    if (!gs.length) {
      setError(kind === "inkind_ack" ? "None of these items has a donor yet." : "A receipt needs a buyer, the amount paid and the market value.");
      return;
    }
    const win = window.open("", "_blank"); // opened now so the browser doesn't block it
    setError(null);
    try {
      const ids: string[] = [];
      for (const g of gs) ids.push(await createLetter(kind, g));
      const url = `${site || window.location.origin}/letter/${ids.join(",")}`;
      if (win) win.location.href = url;
      else window.location.href = url;
      if (left.length)
        setMessage(`${left.length} item${left.length === 1 ? " was" : "s were"} left out: ${kind === "inkind_ack" ? "no donor" : "missing a buyer, amount paid or market value"}.`);
    } catch (e) {
      win?.close();
      setError((e as Error).message);
    }
  }

  async function markThanked() {
    if (!thank) return;
    const ids = selectedItems.map((i) => i.donation_id).filter(Boolean) as string[];
    if (!ids.length) return setError("None of these items has a donor gift to mark.");
    const { error } = await createClient().rpc("mark_gifts_thanked", { p_gift_ids: ids, p_method: thank.method, p_on: thank.on });
    if (error) return setError(error.message);
    setThank(null);
    setSelected(new Set());
    setMessage(`Marked ${ids.length} donor gift${ids.length === 1 ? "" : "s"} as thanked.`);
    load();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const fmv = amountOrNull(form.fair_market_value);
    const sold = amountOrNull(form.sold_amount);
    if (Number.isNaN(fmv) || Number.isNaN(sold)) return setError("Enter dollar amounts as numbers, for example 250.");
    if (!form.title.trim()) return setError("Enter what the item is.");
    setSaving(true);
    setError(null);
    const { error } = await createClient().rpc("save_inkind_item", {
      p: {
        id: form.id,
        event_name: form.event_name,
        item_number: form.item_number,
        title: form.title,
        description: form.description,
        sale_type: form.sale_type || null,
        is_service: form.is_service,
        donor_contact_id: form.donor_contact_id,
        fair_market_value: fmv,
        received_date: form.received_date || null,
        buyer_contact_id: form.buyer_contact_id,
        bidder_number: form.bidder_number,
        sold_amount: sold,
        sold_date: form.sold_date || null,
        notes: form.notes,
      },
    });
    setSaving(false);
    if (error) return setError(error.message);
    setMessage(form.id ? "Item saved." : `Added "${form.title.trim()}".`);
    setEvent(form.event_name.trim() || "In-kind donation");
    setForm(null);
    load();
  }

  async function remove() {
    if (!form?.id) return;
    if (!confirm(`Delete "${form.title}"? The donor's matching in-kind gift is deleted too. Letters already sent are kept.`)) return;
    const { error } = await createClient().rpc("delete_inkind_item", { p_item: form.id });
    if (error) return setError(error.message);
    setForm(null);
    setMessage("Item deleted.");
    load();
  }

  function exportShown() {
    downloadCsv(
      `DHA in-kind items ${event || "all events"} ${todayLocal()}.csv`,
      ["Event", "Item #", "Item", "Description", "Type", "Service", "Donor", "Donor Email", "Market Value", "Received",
        "Buyer", "Buyer Email", "Bidder #", "Sold For", "Thank-you", "Receipt Emailed"],
      shown.map((i) => {
        const d = i.donor_contact_id ? byId.get(i.donor_contact_id) : undefined;
        const b = i.buyer_contact_id ? byId.get(i.buyer_contact_id) : undefined;
        return [
          i.event_name, i.item_number, i.title, i.description, i.sale_type, i.is_service ? "Yes" : "",
          d ? fullName(d) : "", d?.email, i.fair_market_value === null ? "" : Number(i.fair_market_value).toFixed(2), i.received_date,
          b ? fullName(b) : "", b?.email, i.bidder_number, i.sold_amount === null ? "" : Number(i.sold_amount).toFixed(2),
          thankedLabel(i) ?? "", i.buyer_receipt_sent_at ? i.buyer_receipt_sent_at.slice(0, 10) : "",
        ];
      })
    );
  }

  if (loading) return <p className="muted">Loading…</p>;

  const pickerContacts: PickerContact[] = contacts;
  const composeInfo = compose ? groups(compose.kind, selectedItems) : null;
  const composeEmailable = composeInfo?.groups.filter((g) => canEmail(g.contact)) ?? [];
  const composeNoEmail = composeInfo?.groups.filter((g) => !canEmail(g.contact)) ?? [];
  const previewGroup = composeEmailable[0] ?? composeInfo?.groups[0];
  const previewHtml =
    compose && previewGroup
      ? buildEmailHtml(
          messageHtml(compose.text, varsFor(compose.kind, previewGroup), "#", compose.kind === "inkind_ack" ? "Download your letter (PDF)" : "Download your receipt (PDF)"),
          settings?.email_footer ?? "",
          { unsubscribeUrl: "#" }
        )
      : "";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="font-display text-2xl font-semibold">In-kind and auction items</h1>
          <p className="muted text-sm">
            Everything donated that isn&rsquo;t cash: auction items, gift cards, services and supplies. Each item counts as
            an in-kind gift from its donor at its market value. Add the winning bidder and price after the auction, then
            email donors a thank-you with a PDF letter for their tax records. To bring in a OneCause export, use{" "}
            <Link href="/import" className="font-semibold text-teal-700">Import</Link>.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(blank(event && event !== "" ? event : "")); setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }}>
          + Add item
        </button>
      </div>

      {message && (
        <div className="card flex items-start gap-3 border-teal-100 bg-teal-50 p-3 text-sm">
          <span>{message}</span>
          <button className="muted ml-auto text-xs" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}
      {error && <p className="text-sm text-coral-600">{error}</p>}

      {form && (
        <div ref={formRef} className="card p-5">
          <h2 className="font-display text-lg font-semibold">{form.id ? "Edit item" : "Add an item"}</h2>
          <form onSubmit={save} className="mt-3 grid gap-4 md:grid-cols-6">
            <div className="md:col-span-3">
              <label className="label">Event</label>
              <input list="inkind-events" className="input mt-1" placeholder="e.g. Love That Smile 2026" value={form.event_name}
                onChange={(e) => setForm({ ...form, event_name: e.target.value })} />
              <datalist id="inkind-events">{events.map((e) => <option key={e} value={e} />)}</datalist>
            </div>
            <div>
              <label className="label">Item #</label>
              <input className="input mt-1" value={form.item_number} onChange={(e) => setForm({ ...form, item_number: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Type</label>
              <select className="input mt-1" value={form.sale_type} onChange={(e) => setForm({ ...form, sale_type: e.target.value })}>
                <option value="">Not recorded</option>
                {SALE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="label">What it is</label>
              <input required className="input mt-1" placeholder="e.g. Teeth whitening package" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm md:col-span-2">
              <input type="checkbox" checked={form.is_service} onChange={(e) => setForm({ ...form, is_service: e.target.checked })} />
              A service (not tax-deductible for the donor)
            </label>
            <div className="md:col-span-6">
              <label className="label">Description (appears on the thank-you letter)</label>
              <input className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="md:col-span-3">
              <ContactPicker label="Donated by" contacts={pickerContacts} value={form.donor_contact_id}
                onChange={(id) => setForm({ ...form, donor_contact_id: id })}
                onCreated={(c) => setContacts((cs) => [...cs, c as ContactSummary])} />
            </div>
            <div>
              <label className="label">Market value ($)</label>
              <input inputMode="decimal" className="input mt-1" value={form.fair_market_value}
                onChange={(e) => setForm({ ...form, fair_market_value: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Date received</label>
              <input type="date" className="input mt-1" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
            </div>

            <div className="md:col-span-3">
              <ContactPicker label="Won by (buyer)" contacts={pickerContacts} value={form.buyer_contact_id}
                onChange={(id) => setForm({ ...form, buyer_contact_id: id })}
                onCreated={(c) => setContacts((cs) => [...cs, c as ContactSummary])} />
            </div>
            <div>
              <label className="label">Sold for ($)</label>
              <input inputMode="decimal" className="input mt-1" value={form.sold_amount} onChange={(e) => setForm({ ...form, sold_amount: e.target.value })} />
            </div>
            <div>
              <label className="label">Bidder #</label>
              <input className="input mt-1" value={form.bidder_number} onChange={(e) => setForm({ ...form, bidder_number: e.target.value })} />
            </div>
            <div>
              <label className="label">Date sold</label>
              <input type="date" className="input mt-1" value={form.sold_date} onChange={(e) => setForm({ ...form, sold_date: e.target.value })} />
            </div>
            <div className="md:col-span-6">
              <label className="label">Notes (staff only)</label>
              <input className="input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-6">
              <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : form.id ? "Save item" : "Add item"}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              {form.id && <button type="button" className="btn btn-danger ml-auto" onClick={remove}>Delete item</button>}
            </div>
          </form>
        </div>
      )}

      <div className="card grid gap-3 p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="label">Event</label>
          <select className="input mt-1" value={event} onChange={(e) => { setEvent(e.target.value); setSelected(new Set()); }}>
            <option value="">All events</option>
            {events.map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="label">Search</label>
          <input className="input mt-1" placeholder="Item, donor or buyer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button className="btn btn-secondary w-full" onClick={exportShown}>Download for Excel</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Items" value={shown.length.toLocaleString()} />
        <Tile label="Market value" value={money(totals.value)} />
        <Tile label={`Sold (${totals.soldCount})`} value={money(totals.sold)} />
        <Tile label="Donors thanked" value={`${totals.thanked} of ${totals.withDonor}`} />
      </div>

      {selected.size > 0 && !compose && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={() => startCompose("inkind_ack")}>Email thank-you letters</button>
          <button className="btn btn-secondary btn-sm" onClick={() => downloadLetters("inkind_ack", selectedItems)}>Download letters to print</button>
          <button className="btn btn-secondary btn-sm" onClick={() => startCompose("buyer_receipt")}>Email buyer receipts</button>
          <button className="btn btn-secondary btn-sm" onClick={() => downloadLetters("buyer_receipt", selectedItems)}>Download receipts to print</button>
          {!thank ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setThank({ method: "Letter", on: todayLocal() })}>Mark donors thanked…</button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <select className="input w-auto py-1" value={thank.method} onChange={(e) => setThank({ ...thank, method: e.target.value })}>
                {THANK_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input type="date" className="input w-auto py-1" value={thank.on} max={todayLocal()} onChange={(e) => setThank({ ...thank, on: e.target.value })} />
              <button className="btn btn-primary btn-sm" onClick={markThanked}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setThank(null)}>Cancel</button>
            </span>
          )}
          <button className="muted ml-auto text-xs" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {compose && composeInfo && (
        <div className="card p-5">
          <h2 className="font-display text-lg font-semibold">
            {compose.kind === "inkind_ack" ? "Email thank-you letters to donors" : "Email receipts to buyers"}
          </h2>
          <p className="mt-1 text-sm">
            <strong>{composeEmailable.length}</strong> {composeEmailable.length === 1 ? "person" : "people"} will get an email with a
            link to their own PDF {compose.kind === "inkind_ack" ? "letter" : "receipt"}.
            {composeNoEmail.length > 0 && (
              <span className="text-[#b8862e]">
                {" "}{composeNoEmail.length} can&rsquo;t be emailed (no email address, or asked not to be emailed):{" "}
                {composeNoEmail.map((g) => fullName(g.contact)).join(", ")}. Use <em>Download {compose.kind === "inkind_ack" ? "letters" : "receipts"} to print</em> to mail theirs.
              </span>
            )}
            {composeInfo.left.length > 0 && (
              <span className="muted">
                {" "}{composeInfo.left.length} selected item{composeInfo.left.length === 1 ? "" : "s"} left out ({compose.kind === "inkind_ack" ? "no donor" : "missing a buyer, amount paid or market value"}).
              </span>
            )}
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <div>
                <label className="label">Subject</label>
                <input className="input mt-1" value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
              </div>
              <div>
                <label className="label">Message</label>
                <textarea rows={14} className="input mt-1 font-mono text-sm" value={compose.text}
                  onChange={(e) => setCompose({ ...compose, text: e.target.value })} />
                <p className="muted mt-1 text-xs">
                  Filled in for each person: {"{{first_name}}"}, {"{{items}}"}, {"{{event}}"}
                  {compose.kind === "inkind_ack" && <>, {"{{raised}}"} (what their items sold for, when they sold)</>}. {"{{letter_button}}"} is
                  where the download button goes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-secondary" disabled={!!sending || !me} onClick={sendTest}>
                  {sending === "test" ? "Sending…" : "Send a test to me"}
                </button>
                <button className="btn btn-primary" disabled={!!sending || !composeEmailable.length} onClick={sendAll}>
                  {sending && sending !== "test" ? `Sending ${sending}…` : `Send ${composeEmailable.length} email${composeEmailable.length === 1 ? "" : "s"}`}
                </button>
                <button className="btn btn-secondary" disabled={!!sending} onClick={() => setCompose(null)}>Cancel</button>
              </div>
            </div>
            <div>
              <span className="label">Preview{previewGroup ? ` for ${fullName(previewGroup.contact)}` : ""}</span>
              {previewHtml && <EmailPreview className="mt-1 block w-full rounded border border-[var(--border)]" html={previewHtml} />}
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allShown} aria-label="Select all shown"
                  onChange={() => {
                    const next = new Set(selected);
                    if (allShown) shown.forEach((i) => next.delete(i.id));
                    else shown.forEach((i) => next.add(i.id));
                    setSelected(next);
                  }} />
              </th>
              <th>Item</th>
              <th>Donated by</th>
              <th className="text-right">Value</th>
              <th>Sold</th>
              <th>Donor thanked</th>
              <th>Buyer receipt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const d = i.donor_contact_id ? byId.get(i.donor_contact_id) : undefined;
              const b = i.buyer_contact_id ? byId.get(i.buyer_contact_id) : undefined;
              const thanked = thankedLabel(i);
              return (
                <tr key={i.id} className={selected.has(i.id) ? "bg-teal-50" : ""}>
                  <td>
                    <input type="checkbox" checked={selected.has(i.id)} aria-label={`Select ${i.title}`}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(i.id)) next.delete(i.id);
                        else next.add(i.id);
                        setSelected(next);
                      }} />
                  </td>
                  <td className="max-w-xs">
                    <button className="text-left font-semibold text-teal-700" onClick={() => { setForm(toDraft(i)); setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }}>
                      {i.item_number ? `#${i.item_number} ` : ""}{i.title}
                    </button>
                    {i.description && <div className="muted text-xs">{i.description}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.sale_type && <span className="pill">{i.sale_type}</span>}
                      {i.is_service && <span className="pill pill-warn">Service</span>}
                      {!event && <span className="muted text-xs">{i.event_name}</span>}
                    </div>
                  </td>
                  <td>
                    {d ? <Link href={`/donors/${d.id}`} className="font-semibold text-teal-700">{fullName(d)}</Link> : <span className="muted">No donor</span>}
                    {d?.organization && d.organization !== d.last_name && <div className="muted text-xs">{d.organization}</div>}
                  </td>
                  <td className="text-right">{i.fair_market_value === null ? <span className="muted">—</span> : money(i.fair_market_value)}</td>
                  <td>
                    {i.sold_amount !== null ? (
                      <>
                        {money(i.sold_amount)}
                        <div className="text-xs">
                          {b ? <Link href={`/donors/${b.id}`} className="text-teal-700">{fullName(b)}</Link> : <span className="muted">buyer not recorded</span>}
                          {i.bidder_number && <span className="muted"> · bidder {i.bidder_number}</span>}
                        </div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="text-sm">
                    {d ? (thanked ? <span className="pill pill-good">{thanked}</span> : <span className="pill pill-warn">Not yet</span>) : <span className="muted">—</span>}
                  </td>
                  <td className="text-sm">
                    {i.sold_amount !== null && b
                      ? i.buyer_receipt_sent_at ? `Emailed ${shortDate(i.buyer_receipt_sent_at)}` : <span className="muted">Not sent</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="whitespace-nowrap text-right text-xs">
                    {d && <button className="font-semibold text-teal-700" onClick={() => downloadLetters("inkind_ack", [i])}>Letter</button>}
                    {b && i.sold_amount !== null && i.fair_market_value !== null && (
                      <button className="ml-3 font-semibold text-teal-700" onClick={() => downloadLetters("buyer_receipt", [i])}>Receipt</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="muted p-6 text-center">
                  {items.length ? "No items match." : "No in-kind items yet. Click + Add item, or import a OneCause export on the Import tab."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {settings && !settings.site_url && (
        <p className="text-xs text-[#b8862e]">
          Letter links use this page&rsquo;s address. An admin can set the public CRM address under Settings → Letters.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-teal-700">{value}</div>
    </div>
  );
}
