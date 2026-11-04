// Reads OneCause's two exports and links them:
//   * Auction Proceeds (Reports -> Auction Proceeds): one row per sold lot, with
//     the event, auction, lot number, winning bid, market value and buyer.
//   * Items Report (Reports -> Items Report): one row per donated item, with
//     its value, donor and the lot number it was put into.
// Lot numbers repeat across events (and between the silent and live auction
// of one event), so each item is matched to the right package using its
// donor and its name, and anything uncertain is left for staff to choose.

import { BUSINESS, cleanZip, formatPhone, parseName, properCase, str, type AttendeeRow } from "./importMapper";

export type RawRow = Record<string, unknown>;

export type OcFileKind = "proceeds" | "items" | "bids" | null;

const has = (headers: string[], ...names: string[]) =>
  names.every((n) => headers.some((h) => h.trim().toLowerCase() === n.toLowerCase()));

export function detectOneCause(raw: RawRow[]): OcFileKind {
  const headers = Array.from(new Set(raw.flatMap((r) => Object.keys(r))));
  if (has(headers, "Lot #", "Lot Name", "Winning Bid Amount")) return "proceeds";
  // OneCause's own column names, so an ordinary spreadsheet of items isn't mistaken for this report
  if (has(headers, "Item Name", "Procurement Status") || has(headers, "Item Name", "Assigned To Lot")) return "items";
  if (has(headers, "Lot Name", "Bid Amount", "Winning Bid")) return "bids";
  return null;
}

const get = (r: RawRow, h: string) => str(r[h]);
const money = (s: string) => {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
};
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const STOP = new Set(["the", "and", "with", "for", "from", "your", "inc", "llc", "dds", "dmd", "of", "to", "a", "an", "at", "in", "on", "plus", "set", "pack", "card", "gift"]);
export const tokens = (s: string) =>
  new Set((s.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).map((t) => t.replace(/'s$|'/g, "")).filter((t) => !STOP.has(t)));

// Words only a business, school, team or organization has in its name
const ORG_STRONG =
  /\b(company|inc|llc|pllc|corp|corporation|foundation|orchestra|symphony|rangers|cowboys|mavericks|waterpark|museum|theatre|theater|chamber of commerce|services|motorcars|motors|jewelry|jewelers|credit union|spa|salon|salons|dental|dentistry|orthodontics|massage|distilling|distillery|winery|brewery|bakery|cafe|grill|tacos?|restaurant|roadhouse|cidercade|school|university|department|cinema|cinemas|hotel|resort|academy|association|networking|council|center|centre|group|community|pizza|pizzeria|steakhouse|smokehouse|bbq|barbecue|bistro|tavern|cantina|pub|donuts?|cupcakes?|creamery|boutique|florist|realty|realtors?|insurance|fitness|gym|yoga|pilates|pharmacy|clinic|hospital|medical|chiropractic|optometry|veterinary|barbershop|beauty|cosmetics|apparel|clothing|studios|bowling|arcade|trampoline|zoo|aquarium|stadium|flags|adventures?|entertainment|productions|photography|marketing|solutions|holdings|enterprises|industries|international|logistics|construction|roofing|plumbing|landscaping|cleaning|catering|spirits|liquors?|cellars|vineyards?|nursery|ministries)\b|\bco\.?$|^back 9$|^the\s|'s\b|chicken n pickle/i;
// Business words that are also surnames ("Susan Waters", "Maria Arena", "Tom Flowers"): they make a
// name a business only when it doesn't read like a person's
const ORG_WEAK = /\b(waters|house|inn|gardens?|pie|crawling|pickle|market|shop|studio|air|bowl|golf|wings|stars|network|church|park|street|ranch|arena|flowers|kitchen|gallery|lanes|lash|coffee|farms?|club|bank|mall|nails|media|partners|events|designs?|wines?|electric|dallas|fort worth|arlington|texas|grand prairie|mansfield)\b/gi;

// Common first names, to tell "Mary Ann Church" (a person) from "Main Street Market" (a business)
const FIRST_NAMES = new Set(
  ("aaron adam alan albert alex maria marie rosa ana alexander alice allison amanda amber amy andrea andrew angela ann anna anne annie anthony april ashley " +
   "barbara becky ben benjamin beth betty beverly bill billy bob bobby bonnie brad bradley brandon brenda brian brittany bruce bryan " +
   "carl carla carol carolyn carrie catherine cathy charles charlie cheryl chris christina christine christopher cindy claire connie craig crystal cynthia " +
   "dale dan daniel danielle darlene dave david dawn dean debbie deborah debra denise dennis diana diane don donald donna doris dorothy doug douglas " +
   "ed eddie edward eileen elizabeth ellen emily emma eric erica erin eugene evelyn frances frank fred gail gary george gerald gina glenda gloria grace greg gregory " +
   "hannah harold harry heather heidi helen henry holly howard jack jacob jacqueline james jamie jan jane janet janice jason jean jeff jeffrey jennifer jenny jeremy jerry " +
   "jessica jill jim jimmy jo joan joann joe joel john johnny jon jonathan joseph josh joshua joy joyce juan judith judy julia julie justin karen kate katherine kathleen kathy " +
   "katie kay keith kelly ken kenneth kevin kim kimberly kristen kristin kyle larry laura lauren lea lee leslie linda lisa lori louis lucy lynn " +
   "marcus margaret maria marie marilyn mark martha martin mary matt matthew megan melanie melissa michael michelle mike nancy natalie nathan nicholas nicole norma " +
   "pam pamela pat patricia patrick paul paula peggy peter phil philip phyllis rachel ralph randy ray raymond rebecca regina richard rick rita rob robert robin rodney roger ron ronald rose ruby russell ruth " +
   "sally sam samantha samuel sandra sandy sara sarah scott sean sharon shawn sheila shirley stacy stephanie stephen steve steven sue susan tammy tara ted teresa terry theresa thomas tim timothy tina todd tom tommy tony tracy travis troy " +
   "valerie vanessa vicki victoria vincent virginia walter wanda wayne wendy william willie").split(" ")
);

export function isOrganizationName(n: string): boolean {
  if (ORG_STRONG.test(n) || BUSINESS.test(n)) return true;
  const weak = (n.match(ORG_WEAK) ?? []).length;
  if (weak === 0) return false;
  const words = n.replace(/^(dr|mr|mrs|ms|miss)\.?\s+/i, "").split(" ");
  // Two words are a person ("Min Park", "Olivia Waters") unless both are business signs ("Dallas Wings").
  // A wrong guess here doesn't add anyone twice: the import checks the other reading before adding a contact.
  if (words.length <= 2) return weak >= 2;
  // Longer names with a business word are a business ("Main Street Market") unless they read like a
  // person ("Mary Ann Church", "Robert E. House", "Dr. Mark Church", "John & Jane Waters")
  const personLike =
    /^(dr|mr|mrs|ms|miss)\.?\s/i.test(n) ||
    words.slice(1, -1).some((w) => /^[a-z]\.?$/i.test(w)) ||
    FIRST_NAMES.has(words[0].toLowerCase().replace(/[^a-z]/g, "")) ||
    /&|\band\b/i.test(n);
  return !personLike;
}

export function personFromName(name: string, email: string): AttendeeRow | null {
  const n = name.replace(/\s+/g, " ").trim();
  const e = email.trim().toLowerCase() || null;
  if (!n && !e) return null;
  const words = n.split(" ");
  // "Michael Jacobson Jacobson" -> "Michael Jacobson"
  const deduped = words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase()).join(" ");
  const base = { email: e, phone: null, address: null, city: null, state: null, zip: null, country: null };
  if (deduped && isOrganizationName(deduped)) {
    return { ...base, first_name: "", last_name: deduped, organization: deduped };
  }
  const p = parseName(deduped);
  return { ...base, first_name: p.first, last_name: p.last, organization: p.organization };
}

/** "15 Jun 24 18:00 CDT" -> "2024-06-15". Also takes a date cell from an .xlsx file. */
export function ocDate(v: unknown): string | null {
  // spreadsheet date cells arrive as midnight UTC, so read them in UTC (local time would be a day early)
  if (v instanceof Date && !isNaN(v.getTime()))
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  const s = str(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) return `${us[3].length === 2 ? "20" + us[3] : us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})/);
  if (!m) return null;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  return `${y}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** "Love That Smile Casino Night 2024" -> "Love That Smile 2024" */
export function suggestEventName(ocName: string, date: string | null): string {
  const year = ocName.match(/20\d\d/)?.[0] ?? date?.slice(0, 4) ?? "";
  if (/love\s*that\s*smile/i.test(ocName)) return `Love That Smile ${year}`.trim();
  return ocName.replace(/\s+/g, " ").trim();
}

export const saleType = (auction: string) =>
  /live/i.test(auction) ? "Live auction" : /raffle/i.test(auction) ? "Raffle" : "Silent auction";

export type OcPackage = {
  key: string;
  ocEvent: string;
  eventDate: string | null;
  auction: string;
  lot: string;
  title: string;
  value: number | null; // null when OneCause shows 0 (no market value entered)
  sold: number | null;
  paddle: string | null;
  paid: string;
  donorsListed: string; // "Item Donor" names, de-duplicated
  buyer: AttendeeRow | null;
};

export type OcItem = {
  key: string;
  baseKey: string; // the key before any suffix that tells same-named rows apart
  title: string;
  value: number | null;
  quantity: number;
  status: string;
  lot: string;
  donorName: string;
  donorEmail: string;
  description: string;
  donor: AttendeeRow | null;
};

function cleanAddress(a: string): string | null {
  const s = a.replace(/,?\s*apt, suite, floor, etc\.?/i, "").replace(/\s+/g, " ").trim();
  return s ? properCase(s, false) : null;
}

/**
 * Gives rows that would share a key a suffix taken from what's in them (not their
 * order in the file), so a later export with the rows in another order still
 * updates the same records.
 */
function settleKeys<T extends { key: string }>(rows: T[], extra: (r: T) => string): void {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    const used = new Map<string, number>();
    for (const r of g) {
      const base = `${r.key}|${normKey(extra(r)) || "x"}`;
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      r.key = n > 1 ? `${base}|${n}` : base;
    }
  }
}

export function parseProceeds(raw: RawRow[]): OcPackage[] {
  const out: OcPackage[] = [];
  for (const r of raw) {
    const title = get(r, "Lot Name");
    if (!title) continue;
    const ocEvent = get(r, "Event Name").replace(/\s+/g, " ");
    const auction = get(r, "Auction Name");
    const lot = get(r, "Lot #");
    const eventDate = ocDate(r["Event Date"]);
    // the event date is part of the key, so an event named the same every year stays separate
    const key = `oc-lot|${normKey(ocEvent)}|${eventDate ?? ""}|${normKey(auction)}|${lot || normKey(title)}`;
    const value = money(get(r, "Value"));
    const first = get(r, "First Name");
    const last = get(r, "Last Name");
    const email = get(r, "Supporter Email").toLowerCase();
    const donors = Array.from(new Set(get(r, "Item Donor").split(",").map((d) => d.trim()).filter(Boolean)));
    out.push({
      key,
      ocEvent,
      eventDate,
      auction,
      lot,
      title,
      value: value && value > 0 ? value : null,
      sold: money(get(r, "Winning Bid Amount")),
      paddle: get(r, "Paddle Number") || null,
      paid: get(r, "Payment Status"),
      donorsListed: donors.join(", "),
      buyer:
        first || last || email
          ? {
              first_name: properCase(first.trim()),
              last_name: properCase(last.trim()),
              organization: null,
              email: email || null,
              phone: formatPhone(get(r, "Supporter Phone")),
              address: cleanAddress(get(r, "Supporter Address")),
              city: properCase(get(r, "Supporter City"), false) || null,
              state: get(r, "Supporter State").toUpperCase() || null,
              zip: cleanZip(get(r, "Supporter Zip")),
              country: null,
            }
          : null,
    });
  }
  // a lot sold more than once (several winners) is told apart by bidder
  settleKeys(out, (p) => `${p.paddle ?? ""} ${p.buyer?.email ?? ""} ${p.buyer?.last_name ?? ""}`);
  return out;
}

export function parseItems(raw: RawRow[]): OcItem[] {
  const out: OcItem[] = [];
  for (const r of raw) {
    const title = get(r, "Item Name");
    if (!title) continue;
    const lot = get(r, "Lot Number");
    const donorName = get(r, "Donor Name");
    const donorEmail = get(r, "Donor Contact").includes("@") ? get(r, "Donor Contact").toLowerCase() : "";
    const key = `oc-item|${normKey(title)}|${lot}|${normKey(donorName)}`;
    const qty = Math.max(1, parseInt(get(r, "Quantity") || "1", 10) || 1);
    const unit = money(get(r, "Value"));
    out.push({
      key,
      baseKey: key,
      title: qty > 1 ? `${title} (${qty})` : title,
      value: unit && unit > 0 ? Math.round(unit * qty * 100) / 100 : null,
      quantity: qty,
      status: get(r, "Procurement Status").toLowerCase(),
      lot,
      donorName,
      donorEmail,
      description: String(r["Description"] ?? "").replace(/\s+/g, " ").trim(),
      donor: donorName || donorEmail ? personFromName(donorName, donorEmail) : null,
    });
  }
  // the same item, lot and donor in two different years is told apart by its value and description
  settleKeys(out, (i) => `${i.value ?? ""} ${i.quantity} ${i.description.slice(0, 80)}`);
  return out;
}

/**
 * An item that was the only one of its name in an earlier export keeps the key it was saved
 * under, even after a same-named item from a later year shows up. Takes the keys already in
 * the CRM, with each one's market value, and gives the bare key back to the matching row.
 */
export function keepEarlierKeys(items: OcItem[], existing: Map<string, number | null>): OcItem[] {
  const groups = new Map<string, OcItem[]>();
  for (const it of items) groups.set(it.baseKey, [...(groups.get(it.baseKey) ?? []), it]);
  const owners = new Set<OcItem>();
  for (const [base, g] of Array.from(groups.entries())) {
    if (g.length < 2 || !existing.has(base)) continue;
    // rows already saved under their own suffixed key keep it; the bare key goes to one of the rest
    const rest = g.filter((x) => x.key === base || !existing.has(x.key));
    if (!rest.length) continue;
    const v = existing.get(base) ?? null;
    owners.add(rest.find((x) => x.value === v) ?? rest[0]);
  }
  return items.map((it) => (owners.has(it) ? { ...it, key: it.baseKey } : it));
}

export type Candidate = { pkg: number; score: number; why: string };
export type Link = { item: number; candidates: Candidate[]; chosen: number | null; sure: boolean };

/** Match each item to the package it went into. */
export function linkItems(items: OcItem[], pkgs: OcPackage[]): Link[] {
  const byLot = new Map<string, number[]>();
  pkgs.forEach((p, i) => {
    if (!p.lot) return;
    byLot.set(p.lot, [...(byLot.get(p.lot) ?? []), i]);
  });
  return items.map((it, idx) => {
    const cands = it.lot ? byLot.get(it.lot) ?? [] : [];
    const dTok = tokens(it.donorName);
    const tTok = tokens(it.title.replace(/\(\d+\)$/, ""));
    const scored: Candidate[] = cands.map((pi) => {
      const p = pkgs[pi];
      const pd = tokens(p.donorsListed);
      const pt = tokens(p.title);
      const donorHits = Array.from(dTok).filter((t) => pd.has(t)).length;
      const titleHits = Array.from(tTok).filter((t) => pt.has(t)).length;
      const titleShare = tTok.size ? titleHits / tTok.size : 0;
      let score = 0;
      const why: string[] = [];
      if (donorHits) { score += 2 + donorHits; why.push("donor listed"); }
      if ((titleShare >= 0.5 && titleHits >= 2) || (titleShare === 1 && titleHits >= 1)) { score += 3; why.push("name matches"); }
      else if (titleHits) { score += titleHits; why.push("name partly matches"); }
      return { pkg: pi, score, why: why.join(", ") };
    });
    scored.sort((a, b) => b.score - a.score);
    let chosen: number | null = null;
    let sure = false;
    // Linked without asking only on a strong match: the donor is listed on the package, or most of
    // the item's name is in the package's name. One shared word isn't enough.
    if (scored.length >= 1 && scored[0].score >= 3 && (scored.length === 1 || scored[0].score - scored[1].score >= 2)) {
      chosen = scored[0].pkg;
      sure = true;
    } else if (scored.length === 1 && !it.donor) {
      // no donor to thank: it's only listed inside the package, so the one lot with its number will do
      chosen = scored[0].pkg;
    }
    return { item: idx, candidates: scored, chosen, sure };
  });
}

/** True when the IRS acknowledgment deadline for a gift made on this date has passed (Oct 15 of the next year). */
export function ackDeadlinePassed(giftDate: string | null, today: string): boolean {
  if (!giftDate) return false;
  const y = parseInt(giftDate.slice(0, 4), 10);
  return today > `${y + 1}-10-15`;
}

/** One OneCause event: its name plus its date, since a name can repeat from year to year. */
export const ocEventKey = (p: Pick<OcPackage, "ocEvent" | "eventDate">) => `${p.ocEvent}|${p.eventDate ?? ""}`;

export type BuildInput = {
  pkgs: OcPackage[];
  items: OcItem[];
  links: Link[];
  eventMap: Record<string, string>; // ocEventKey -> CRM event name
  choices: Record<number, string>; // item index -> "pkg:<i>" | "event:<name>" for items staff placed by hand
  itemsOnlyEvent: string; // event for items when there's no Auction Proceeds file
};

export const isReceived = (it: OcItem) => it.status !== "needs requested";

/** The default for an item the CRM couldn't place: its likeliest package, or the most recent event. */
export function defaultChoice(l: Link, latestEvent: string): string {
  return l.candidates[0] && l.candidates[0].score > 0 ? `pkg:${l.candidates[0].pkg}` : `event:${latestEvent}`;
}

export function crmEventsOf(pkgs: OcPackage[], eventMap: Record<string, string>): { name: string; date: string | null }[] {
  const m = new Map<string, string | null>();
  for (const p of [...pkgs].sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""))) {
    const n = (eventMap[ocEventKey(p)] ?? "").trim();
    if (n && !m.has(n)) m.set(n, p.eventDate);
  }
  return Array.from(m.entries()).map(([name, date]) => ({ name, date }));
}

/** What import_onecause() receives. */
export function buildOneCausePayload(x: BuildInput) {
  const eventOf = (p: OcPackage) => (x.eventMap[ocEventKey(p)] ?? "").trim();
  const evs = crmEventsOf(x.pkgs, x.eventMap);
  const latest = evs[0]?.name ?? x.itemsOnlyEvent.trim();
  const dateOf = (name: string) => evs.find((e) => e.name === name)?.date ?? null;
  const packages = x.pkgs.map((p) => ({
    key: p.key,
    event_name: eventOf(p),
    sale_type: saleType(p.auction),
    item_number: p.lot,
    title: p.title,
    fair_market_value: p.value,
    sold_amount: p.sold,
    sold_date: p.eventDate,
    bidder_number: p.paddle,
    notes:
      [
        p.donorsListed && `Item donors listed in OneCause: ${p.donorsListed}.`,
        p.paid && p.paid.toLowerCase() !== "paid" && `OneCause payment status: ${p.paid}.`,
        p.value === null && "OneCause shows no market value. Add one before sending the buyer's receipt.",
      ]
        .filter(Boolean)
        .join(" ") || null,
    buyer: p.buyer,
  }));
  const items: Record<string, unknown>[] = [];
  for (const l of x.links) {
    const it = x.items[l.item];
    if (!isReceived(it)) continue;
    let pkg: OcPackage | null = l.chosen !== null ? x.pkgs[l.chosen] : null;
    let event = pkg ? eventOf(pkg) : x.pkgs.length ? "" : x.itemsOnlyEvent.trim();
    if (it.donor && l.chosen === null) {
      const c = x.choices[l.item] ?? defaultChoice(l, latest);
      if (c.startsWith("pkg:")) pkg = x.pkgs[parseInt(c.slice(4), 10)] ?? null;
      event = pkg ? eventOf(pkg) : c.startsWith("event:") ? c.slice(6) : event;
    }
    if (!it.donor && !pkg) continue; // no one to thank and no package to show it in
    if (!event) event = latest;
    items.push({
      key: it.key,
      title: it.title,
      description: it.description || null,
      fair_market_value: it.value,
      procurement_status: it.status || null,
      donor: it.donor,
      package_key: pkg?.key ?? null,
      event_name: event,
      received_date: pkg?.eventDate ?? dateOf(event),
      notes: it.status === "committed" ? "OneCause status: committed (promised; check that it was received)." : null,
      // staff changed where it belongs on the review list, so later imports leave its package alone
      reviewed: x.pkgs.length > 0 && !!it.donor && l.chosen === null && x.choices[l.item] !== undefined,
    });
  }
  return { packages, items, latest };
}
