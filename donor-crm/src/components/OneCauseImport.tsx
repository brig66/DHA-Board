"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money, shortDate } from "@/lib/format";
import {
  buildOneCausePayload,
  crmEventsOf,
  defaultChoice as defaultChoiceFor,
  isReceived,
  keepEarlierKeys,
  linkItems,
  normKey,
  ocEventKey,
  parseItems,
  parseProceeds,
  suggestEventName,
  type OcItem,
  type OcPackage,
  type RawRow,
} from "@/lib/onecause";

type Summary = {
  packages_added: number; packages_updated: number; items_added: number; items_updated: number;
  new_people: number; matched_people: number; possible_duplicates_flagged: number;
};

const name = (p: { first_name: string; last_name: string } | null) => (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "");

/** Imports OneCause's Auction Proceeds report and/or Items Report. */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export default function OneCauseImport({
  proceeds,
  items: itemsRaw,
  knownEvents,
}: {
  proceeds: { name: string; raw: RawRow[] } | null;
  items: { name: string; raw: RawRow[] } | null;
  knownEvents: string[];
}) {
  const pkgs = useMemo<OcPackage[]>(() => (proceeds ? parseProceeds(proceeds.raw) : []), [proceeds]);
  const parsedItems = useMemo<OcItem[]>(() => (itemsRaw ? parseItems(itemsRaw.raw) : []), [itemsRaw]);

  // OneCause events (name + date), most recent first
  const ocEvents = useMemo(() => {
    const m = new Map<string, { name: string; date: string | null; count: number; sales: number }>();
    for (const p of pkgs) {
      const k = ocEventKey(p);
      const e = m.get(k) ?? { name: p.ocEvent, date: p.eventDate, count: 0, sales: 0 };
      e.count += 1;
      e.sales += p.sold ?? 0;
      m.set(k, e);
    }
    return Array.from(m.entries()).sort((a, b) => (b[1].date ?? "").localeCompare(a[1].date ?? ""));
  }, [pkgs]);

  const [eventMap, setEventMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const p of pkgs) m[ocEventKey(p)] ??= suggestEventName(p.ocEvent, p.eventDate);
    return m;
  });
  const edited = useRef(new Set<string>());

  // What an earlier OneCause import already brought in. Those items keep the package and
  // event they have in the CRM, and an event imported before keeps its CRM name.
  const [existing, setExisting] = useState<Map<string, number | null> | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await createClient()
        .from("inkind_items")
        .select("import_key, onecause_key, event_name, fair_market_value")
        .or("import_key.like.oc-*,onecause_key.not.is.null")
        .range(0, 9999);
      if (!live) return;
      const rows = ((data ?? []) as { import_key: string | null; onecause_key: string | null; event_name: string; fair_market_value: number | null }[])
        .map((r) => ({ ...r, import_key: r.onecause_key ?? r.import_key }))
        .filter((r) => typeof r.import_key === "string" && r.import_key.startsWith("oc-"));
      const m = new Map<string, string>(rows.map((r) => [r.import_key as string, r.event_name]));
      setExisting(new Map(rows.map((r) => [r.import_key as string, r.fair_market_value === null ? null : Number(r.fair_market_value)])));
      setEventMap((cur) => {
        const next = { ...cur };
        for (const p of pkgs) {
          const k = ocEventKey(p);
          if (edited.current.has(k)) continue;
          const prefix = `oc-lot|${normKey(p.ocEvent)}|${p.eventDate ?? ""}|`;
          for (const [key, ev] of Array.from(m.entries())) if (key.startsWith(prefix)) { next[k] = ev; break; }
        }
        return next;
      });
    })();
    return () => { live = false; };
  }, [pkgs]);
  // items keep the keys they were saved under, and are matched once the CRM has answered
  const items = useMemo(() => (existing ? keepEarlierKeys(parsedItems, existing) : parsedItems), [parsedItems, existing]);
  const links = useMemo(() => linkItems(items, pkgs), [items, pkgs]);
  const already = (it: OcItem) => !!existing?.has(it.key);
  const [progress, setProgress] = useState<string | null>(null);
  const [itemsOnlyEvent, setItemsOnlyEvent] = useState(knownEvents.find((e) => /love that smile/i.test(e)) ?? "");
  const [label, setLabel] = useState("OneCause export");
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showLinked, setShowLinked] = useState(false);

  const eventOf = (p: OcPackage) => (eventMap[ocEventKey(p)] ?? "").trim();
  const crmEvents = pkgs.length ? crmEventsOf(pkgs, eventMap).map((e) => e.name) : [itemsOnlyEvent].filter(Boolean);
  const latestEvent = crmEvents[0] ?? itemsOnlyEvent;
  const received = isReceived;
  const review = links.filter((l) => received(items[l.item]) && items[l.item].donor && l.chosen === null && !already(items[l.item]));
  const alreadyCount = items.filter((it) => received(it) && already(it)).length;
  const choiceFor = (l: (typeof links)[number]) => choices[l.item] ?? defaultChoiceFor(l, latestEvent);

  const plan = useMemo(() => {
    const out = { donorItems: 0, autoLinked: 0, contents: 0, needsRequested: 0, needsRequestedWithDonor: 0, orphan: 0 };
    for (const l of links) {
      const it = items[l.item];
      if (!received(it)) {
        out.needsRequested++;
        if (it.donor) out.needsRequestedWithDonor++;
        continue;
      }
      if (it.donor) {
        out.donorItems++;
        if (l.chosen !== null) out.autoLinked++;
      } else if (l.chosen !== null) out.contents++;
      else out.orphan++;
    }
    return out;
  }, [links, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const held = pkgs.filter((p) => p.value === null);
  const unnamedEvent = ocEvents.some(([k]) => !(eventMap[k] ?? "").trim()) || (!pkgs.length && !itemsOnlyEvent.trim());

  const payload = () =>
    buildOneCausePayload({ pkgs, items, links, eventMap, choices, itemsOnlyEvent });

  async function run() {
    if (unnamedEvent) return setError("Give each event a name.");
    setBusy(true);
    setError(null);
    const { packages, items: its } = payload();
    const src = label.trim() || "OneCause export";
    const allKeys = its.map((i) => String(i.key));
    // small batches, packages first, so no single save runs long enough to time out
    const SIZE = 10;
    const jobs: { packages: unknown[]; items: unknown[] }[] = [];
    for (let i = 0; i < packages.length; i += SIZE) jobs.push({ packages: packages.slice(i, i + SIZE), items: [] });
    for (let i = 0; i < its.length; i += SIZE) jobs.push({ packages: [], items: its.slice(i, i + SIZE) });
    const total: Summary = { packages_added: 0, packages_updated: 0, items_added: 0, items_updated: 0, new_people: 0, matched_people: 0, possible_duplicates_flagged: 0 };
    for (const [n, job] of Array.from(jobs.entries())) {
      setProgress(`${n + 1} of ${jobs.length}`);
      const { data, error } = await createClient().rpc("import_onecause", { packages: job.packages, items: job.items, source_label: src, all_item_keys: allKeys });
      if (error) {
        setBusy(false);
        setProgress(null);
        return setError(`Import stopped partway (${n} of ${jobs.length} parts saved): ${error.message}. Import the same files again to finish; nothing is doubled.`);
      }
      for (const k of Object.keys(total) as (keyof Summary)[]) total[k] += Number((data as Summary)[k] ?? 0);
    }
    setBusy(false);
    setProgress(null);
    setSummary(total);
  }

  if (summary)
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">OneCause import complete</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          <li><strong>{summary.packages_added}</strong> packages added{summary.packages_updated > 0 && <>, <strong>{summary.packages_updated}</strong> updated</>}</li>
          <li><strong>{summary.items_added}</strong> donated items added{summary.items_updated > 0 && <>, <strong>{summary.items_updated}</strong> updated</>}</li>
          <li><strong>{summary.new_people}</strong> new donors or buyers added, <strong>{summary.matched_people}</strong> matched to people already in the CRM</li>
          <li>
            <strong>{summary.possible_duplicates_flagged}</strong> possible duplicates flagged for review
            {summary.possible_duplicates_flagged > 0 && <> — <Link href="/duplicates" className="font-semibold text-teal-700">review them now</Link></>}
          </li>
        </ul>
        <p className="mt-3 text-sm"><Link href="/in-kind" className="font-semibold text-teal-700">Open the In-Kind tab</Link> to send thank-you letters and receipts.</p>
      </section>
    );

  const { packages: pPreview, items: iPreview } = payload();

  return (
    <section className="card flex flex-col gap-5 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">OneCause auction import</h2>
        <p className="muted text-sm">
          {proceeds && <>Winners and packages from <strong>{proceeds.name}</strong>. </>}
          {itemsRaw && <>Donated items and donors from <strong>{itemsRaw.name}</strong>. </>}
          {!proceeds && "Add the Auction Proceeds report too, so items are matched to the packages they sold in and buyers get receipts. "}
          {!itemsRaw && "Add the Items Report too, so donors are thanked for the items they gave. "}
          Importing these files again later updates what&rsquo;s here instead of adding it twice.
        </p>
      </div>

      {pkgs.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">1. Name each event as it appears in the CRM</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="table">
              <thead><tr><th>OneCause event</th><th>Date</th><th className="text-right">Packages sold</th><th className="text-right">Sales</th><th>Event name in the CRM</th></tr></thead>
              <tbody>
                {ocEvents.map(([k, v]) => (
                  <tr key={k}>
                    <td>{v.name}</td>
                    <td className="whitespace-nowrap">{v.date ? shortDate(v.date) : "—"}</td>
                    <td className="text-right">{v.count}</td>
                    <td className="text-right">{money(v.sales)}</td>
                    <td>
                      <input list="oc-known-events" className="input py-1" value={eventMap[k] ?? ""}
                        onChange={(x) => { edited.current.add(k); setEventMap({ ...eventMap, [k]: x.target.value }); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="oc-known-events">{knownEvents.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
      ) : (
        <div className="max-w-md">
          <label className="label">Event these items were for</label>
          <input list="oc-known-events" className="input mt-1" value={itemsOnlyEvent} onChange={(e) => setItemsOnlyEvent(e.target.value)} placeholder="e.g. Love That Smile 2026" />
          <datalist id="oc-known-events">{knownEvents.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">{pkgs.length ? "2." : "1."} What will be imported</h3>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {pkgs.length > 0 && (
            <li>
              <strong>{pPreview.length}</strong> sold {plural(pPreview.length, "package", "packages")}, totaling <strong>{money(pkgs.reduce((s, p) => s + (p.sold ?? 0), 0))}</strong>, each with its winning
              bidder. They show on the buyer&rsquo;s record under Auction purchases.
              {held.length > 0 && (
                <span className="text-[#b8862e]">
                  {" "}{held.length} {held.length === 1 ? "has" : "have"} no market value in OneCause ({held.slice(0, 4).map((p) => p.title).join("; ")}{held.length > 4 ? "…" : ""}).
                  {held.length === 1 ? " Its receipt waits" : " Their receipts wait"} until you add a value on the In-Kind tab, so no buyer is told an unvalued item was fully deductible.
                </span>
              )}
            </li>
          )}
          {items.length > 0 && (
            <>
              <li>
                <strong>{plan.donorItems}</strong> donated {plural(plan.donorItems, "item", "items")} with a donor. Each becomes an in-kind gift on the donor&rsquo;s record at its
                value. {pkgs.length > 0 && <><strong>{plan.autoLinked}</strong> {plural(plan.autoLinked, "was", "were")} matched to the package {plural(plan.autoLinked, "it", "they")} sold in. </>}
                {review.length > 0 && <><strong>{review.length}</strong> {plural(review.length, "needs", "need")} you to choose below.</>}
              </li>
              {alreadyCount > 0 && (
                <li>
                  <strong>{alreadyCount}</strong> {plural(alreadyCount, "item is", "items are")} already in the CRM from an earlier import. {plural(alreadyCount, "It keeps", "They keep")} the
                  package, event, name and description {plural(alreadyCount, "it has", "they have")} there; donors, values and buyers are updated from OneCause.
                </li>
              )}
              {plan.contents > 0 && <li><strong>{plan.contents}</strong> {plural(plan.contents, "item", "items")} with no donor in OneCause, listed inside their packages so you can see what each package held.</li>}
              <li className="muted">
                Left out: {plan.needsRequested} {plural(plan.needsRequested, "item", "items")} still marked &ldquo;needs requested&rdquo; in OneCause (not received
                {plan.needsRequestedWithDonor > 0 && <>; {plan.needsRequestedWithDonor} of them {plural(plan.needsRequestedWithDonor, "lists", "list")} a donor. If they did arrive, update them in OneCause and import again</>})
                {plan.orphan > 0 && <>, and {plan.orphan} with no donor and no sold package</>}.
              </li>
            </>
          )}
        </ul>
      </div>

      {review.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{pkgs.length ? "3." : "2."} Check these items</h3>
          <p className="muted text-sm">
            {pkgs.length
              ? "OneCause lot numbers repeat from year to year, so these items could belong to more than one package. The CRM picked the likeliest; change any that are wrong. Items that weren’t in a sold package just need the right event."
              : "Choose the event for each item."}
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="table">
              <thead><tr><th>Item</th><th>Donor</th><th className="text-right">Value</th><th>Belongs to</th></tr></thead>
              <tbody>
                {review.map((l) => {
                  const it = items[l.item];
                  return (
                    <tr key={it.key}>
                      <td>{it.title}{it.lot && <div className="muted text-xs">OneCause lot {it.lot}</div>}</td>
                      <td>{it.donorName}</td>
                      <td className="text-right">{it.value === null ? "—" : money(it.value)}</td>
                      <td>
                        <select className="input py-1" value={choiceFor(l)} onChange={(e) => setChoices({ ...choices, [l.item]: e.target.value })}>
                          {l.candidates.length > 0 && (
                            <optgroup label="Sold package">
                              {l.candidates.map((c) => (
                                <option key={c.pkg} value={`pkg:${c.pkg}`}>
                                  {eventOf(pkgs[c.pkg]) || pkgs[c.pkg].ocEvent} · Lot {pkgs[c.pkg].lot} · {pkgs[c.pkg].title.slice(0, 60)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Not in a sold package">
                            {crmEvents.map((e) => <option key={e} value={`event:${e}`}>{e}</option>)}
                          </optgroup>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pkgs.length > 0 && items.length > 0 && (
        <div>
          <button className="text-sm font-semibold text-teal-700" onClick={() => setShowLinked(!showLinked)}>
            {showLinked ? "Hide" : "Show"} the {plan.autoLinked} automatic matches
          </button>
          {showLinked && (
            <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-[var(--border)]">
              <table className="table">
                <thead><tr><th>Item</th><th>Donor</th><th>Package</th></tr></thead>
                <tbody>
                  {links.filter((l) => l.chosen !== null && items[l.item].donor && received(items[l.item])).map((l) => (
                    <tr key={items[l.item].key}>
                      <td>{items[l.item].title}</td>
                      <td>{items[l.item].donorName}</td>
                      <td>{eventOf(pkgs[l.chosen!])} · Lot {pkgs[l.chosen!].lot} · {pkgs[l.chosen!].title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {pkgs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-teal-700">Preview the first packages</summary>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="table">
              <thead><tr><th>Event</th><th>Lot</th><th>Package</th><th>Buyer</th><th className="text-right">Paid</th><th className="text-right">Value</th></tr></thead>
              <tbody>
                {pkgs.slice(0, 8).map((p) => (
                  <tr key={p.key}>
                    <td>{eventOf(p)}</td><td>{p.lot}</td><td>{p.title}</td><td>{name(p.buyer)}</td>
                    <td className="text-right">{p.sold === null ? "—" : money(p.sold)}</td>
                    <td className="text-right">{p.value === null ? <span className="text-[#b8862e]">none</span> : money(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label">Label for this import</label>
          <input className="input mt-1" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy || existing === null || unnamedEvent || (!pPreview.length && !iPreview.length)} onClick={run}>
          {busy ? `Importing… ${progress ?? ""}` : `Import ${pPreview.length ? `${pPreview.length} packages` : ""}${pPreview.length && iPreview.length ? " and " : ""}${iPreview.length ? `${iPreview.length} items` : ""}`}
        </button>
      </div>
      {error && <p className="text-sm text-coral-600">{error}</p>}
    </section>
  );
}
