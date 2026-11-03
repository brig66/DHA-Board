// Spreadsheet imports where Glenda can see and change which column feeds
// which field: volunteer lists, people lists and auction/in-kind item lists
// (for example a OneCause item export). The column guesses come from the
// headings; she can correct any of them before importing.

import {
  cleanFirstName,
  cleanOrganization,
  cleanZip,
  formatPhone,
  parseAmount,
  parseDate,
  parseName,
  properCase,
  str,
  type AttendeeRow,
} from "./importMapper";

export type ImportKind = "volunteers" | "people" | "auction";
export type RawRow = Record<string, unknown>;
export type FieldDef = { field: string; label: string; aliases: string[]; group?: string };
export type ColumnMap = Record<string, string>; // field -> column heading ("" = not used)

/** "Item #" -> "itemnumber", "Bidder No." -> "biddernumber", "E-mail" -> "email" */
export const headingKey = (h: string) =>
  h
    .toLowerCase()
    .replace(/#/g, "number")
    .replace(/\bno\.(?=\s|$)/g, "number")
    .replace(/[^a-z0-9]/g, "");

const person = (prefix: string, group: string, extra: Partial<Record<string, string[]>> = {}): FieldDef[] => {
  const p = (xs: string[]) => xs.map((x) => prefix + x);
  return [
    { field: `${group}first_name`, label: "First name", group, aliases: [...p(["firstname", "first"]), ...(extra.first_name ?? [])] },
    { field: `${group}last_name`, label: "Last name", group, aliases: [...p(["lastname", "last", "surname"]), ...(extra.last_name ?? [])] },
    { field: `${group}full_name`, label: "Full name", group, aliases: [...p(["name", "fullname", "contact", "contactname"]), ...(extra.full_name ?? [])] },
    { field: `${group}organization`, label: "Business", group, aliases: [...p(["company", "business", "organization", "organisation", "companyname", "businessname"]), ...(extra.organization ?? [])] },
    { field: `${group}email`, label: "Email", group, aliases: [...p(["email", "emailaddress", "email1"]), ...(extra.email ?? [])] },
    { field: `${group}phone`, label: "Phone", group, aliases: [...p(["phone", "phonenumber", "mobile", "mobilephone", "cell", "cellphone", "homephone"]), ...(extra.phone ?? [])] },
    { field: `${group}address`, label: "Street address", group, aliases: [...p(["address", "address1", "streetaddress", "street", "mailingaddress"]), ...(extra.address ?? [])] },
    { field: `${group}city`, label: "City", group, aliases: [...p(["city"]), ...(extra.city ?? [])] },
    { field: `${group}state`, label: "State", group, aliases: [...p(["state", "st"]), ...(extra.state ?? [])] },
    { field: `${group}zip`, label: "Zip", group, aliases: [...p(["zip", "zipcode", "postalcode"]), ...(extra.zip ?? [])] },
  ];
};

const PLAIN_PERSON = person("", "", {
  full_name: ["donorname", "membername", "person"],
  email: ["emailaddress"],
});

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  volunteers: [
    ...PLAIN_PERSON.filter((f) => f.field !== "full_name"),
    { field: "full_name", label: "Full name", aliases: ["name", "fullname", "volunteername", "volunteer", "person", "contact"] },
    { field: "work_date", label: "Date worked", aliases: ["date", "workdate", "servicedate", "shiftdate", "datevolunteered", "datesserved", "dateofservice", "eventdate"] },
    { field: "hours", label: "Hours", aliases: ["hours", "hoursworked", "volunteerhours", "totalhours", "hrs", "numberofhours", "time"] },
    { field: "activity", label: "What they did", aliases: ["activity", "role", "task", "event", "shift", "position", "assignment", "program", "description"] },
    { field: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment"] },
  ],
  people: [
    ...PLAIN_PERSON,
    { field: "is_board_member", label: "Board member (yes/no)", aliases: ["boardmember", "board", "isboardmember", "onboard"] },
    { field: "is_volunteer", label: "Volunteer (yes/no)", aliases: ["isvolunteer", "volunteers", "volunteer"] },
    { field: "do_not_email", label: "Do not email (yes/no)", aliases: ["donotemail", "noemail", "noemails", "emailoptout", "optoutemail", "unsubscribed", "optedout", "optout"] },
    { field: "do_not_call", label: "Do not call (yes/no)", aliases: ["donotcall", "nocall", "nocalls", "nophone", "phoneoptout"] },
    { field: "do_not_mail", label: "Do not mail (yes/no)", aliases: ["donotmail", "nomail", "mailoptout"] },
    { field: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment"] },
  ],
  auction: [
    { field: "item_number", label: "Item #", aliases: ["itemnumber", "itemno", "itemid", "itemcode", "lotnumber", "lot", "packagenumber", "packageno", "packageid", "number"] },
    { field: "title", label: "Item name", aliases: ["itemname", "itemtitle", "title", "packagename", "packagetitle", "name", "item", "package"] },
    { field: "description", label: "Description", aliases: ["description", "itemdescription", "packagedescription", "details", "longdescription"] },
    { field: "sale_type", label: "Silent / live", aliases: ["auctiontype", "saletype", "itemtype", "type", "auction", "format"] },
    { field: "is_service", label: "Service (yes/no)", aliases: ["service", "isservice"] },
    { field: "fair_market_value", label: "Market value", aliases: ["fairmarketvalue", "fmv", "marketvalue", "retailvalue", "itemvalue", "value", "estimatedvalue", "appraisedvalue", "valueofitem"] },
    { field: "received_date", label: "Date received", aliases: ["datereceived", "receiveddate", "donationdate", "dateprocured", "procureddate"] },
    ...person("donor", "donor_", {
      full_name: ["donor", "donatedby", "procuredfrom", "provider", "providedby", "solicitedfrom", "itemdonor"],
      organization: ["donorbusinessname", "donorcompanyname"],
    }).map((f) => ({ ...f, label: `Donor ${f.label.toLowerCase()}` })),
    { field: "bidder_number", label: "Bidder #", aliases: ["biddernumber", "winningbiddernumber", "winnerbiddernumber", "bidderno", "paddlenumber", "paddle", "buyerbiddernumber"] },
    ...person("winner", "buyer_", {
      first_name: ["winningbidderfirstname", "bidderfirstname", "buyerfirstname", "purchaserfirstname"],
      last_name: ["winningbidderlastname", "bidderlastname", "buyerlastname", "purchaserlastname"],
      full_name: ["winningbidder", "winningbiddername", "winner", "buyer", "buyername", "purchaser", "purchasername", "biddername", "bidder", "soldto", "wonby"],
      organization: ["buyercompany", "biddercompany"],
      email: ["winningbidderemail", "bidderemail", "buyeremail", "purchaseremail"],
      phone: ["winningbidderphone", "bidderphone", "buyerphone", "purchaserphone"],
      address: ["bidderaddress", "buyeraddress", "purchaseraddress"],
      city: ["biddercity", "buyercity"],
      state: ["bidderstate", "buyerstate"],
      zip: ["bidderzip", "buyerzip"],
    }).map((f) => ({ ...f, label: `Buyer ${f.label.toLowerCase()}` })),
    { field: "sold_amount", label: "Sold for", aliases: ["winningbid", "soldamount", "soldprice", "soldfor", "saleprice", "salesprice", "purchaseprice", "purchaseamount", "amountpaid", "finalbid", "highbid", "highestbid", "winningamount", "price", "amount"] },
    { field: "sold_date", label: "Date sold", aliases: ["solddate", "datesold", "purchasedate", "datepurchased", "closedate", "closingdate"] },
    { field: "notes", label: "Notes (staff only)", aliases: ["notes", "note", "comments", "internalnotes"] },
  ],
};

export function headersOf(raw: RawRow[]): string[] {
  return Array.from(new Set(raw.flatMap((r) => Object.keys(r)))).filter((h) => h.trim() !== "");
}

/** First pass at which column feeds each field; each column is used once. */
export function guessColumns(kind: ImportKind, headers: string[]): ColumnMap {
  const byKey = new Map<string, string>();
  for (const h of headers) if (!byKey.has(headingKey(h))) byKey.set(headingKey(h), h);
  const used = new Set<string>();
  const map: ColumnMap = {};
  // more specific headings first ("Donor Email" before "Email"), so check longer aliases first
  const defs = FIELDS[kind];
  const pairs = defs.flatMap((d) => d.aliases.map((a, i) => ({ d, a, i })));
  pairs.sort((x, y) => y.a.length - x.a.length || x.i - y.i);
  for (const { d, a } of pairs) {
    if (map[d.field]) continue;
    const h = byKey.get(a);
    if (h && !used.has(h)) {
      map[d.field] = h;
      used.add(h);
    }
  }
  for (const d of defs) map[d.field] ??= "";
  return map;
}

const NO = /^(no|n|false|0|-|none|opted in|subscribed|active)$/i;
export const truthy = (v: string) => !!v && !NO.test(v.trim());

/** "3.5", "3 hrs", "2:30" (two and a half hours) */
export function parseHours(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const hm = s.match(/^(\d+):(\d{2})$/);
  if (hm) return parseInt(hm[1], 10) + parseInt(hm[2], 10) / 60;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function saleType(v: string): string | null {
  const s = v.toLowerCase();
  if (!s) return null;
  if (s.includes("live")) return "Live auction";
  if (s.includes("silent")) return "Silent auction";
  if (s.includes("raffle")) return "Raffle";
  if (/not auctioned|donation only|in-kind|inkind|supplies/.test(s)) return "Not auctioned";
  return null;
}

type Getter = (field: string) => string;

function personFrom(get: Getter, rawGet: Getter, group: string): AttendeeRow | null {
  let first = cleanFirstName(get(`${group}first_name`));
  let last = properCase(get(`${group}last_name`));
  let organization = cleanOrganization(get(`${group}organization`));
  if (!first && !last) {
    const n = parseName(rawGet(`${group}full_name`), get(`${group}organization`));
    if (!n.guest) {
      first = n.first;
      last = n.last;
      organization = n.organization ?? organization;
    }
  }
  // a business on its own is stored with its name as the last name
  if (!first && !last && organization) last = organization;
  const email = get(`${group}email`).toLowerCase() || null;
  if (!first && !last && !email) return null;
  return {
    first_name: first,
    last_name: last,
    organization,
    email,
    phone: formatPhone(get(`${group}phone`)),
    address: get(`${group}address`) ? properCase(get(`${group}address`), false) : null,
    city: properCase(get(`${group}city`), false) || null,
    state: get(`${group}state`).toUpperCase() || null,
    zip: cleanZip(get(`${group}zip`)),
    country: null,
  };
}

export type VolunteerRow = AttendeeRow & {
  work_date: string | null; hours: number | null; activity: string | null; notes: string | null; dup_index: number | null;
};
export type PeopleRow = AttendeeRow & {
  is_board_member: boolean; is_volunteer: boolean; do_not_email: boolean; do_not_call: boolean; do_not_mail: boolean; notes: string | null;
};
export type AuctionRow = {
  item_number: string | null;
  title: string;
  description: string | null;
  sale_type: string | null;
  is_service: boolean | null;
  fair_market_value: number | null;
  received_date: string | null;
  bidder_number: string | null;
  sold_amount: number | null;
  sold_date: string | null;
  notes: string | null;
  dup_index: number | null;
  donor: AttendeeRow | null;
  buyer: AttendeeRow | null;
};

export type Defaults = {
  work_date?: string; // volunteers: date for rows without one
  activity?: string; // volunteers: activity for rows without one
  everyone_board?: boolean; // people: mark everyone
  everyone_volunteer?: boolean;
  sale_type?: string; // auction: type for rows without one
};

export type Built<T> = { rows: T[]; skipped: { line: number; reason: string }[]; notes: string[] };

function getters(r: RawRow, map: ColumnMap): { get: Getter; rawGet: Getter } {
  return {
    get: (f) => (map[f] ? str(r[map[f]]) : ""),
    rawGet: (f) => (map[f] ? String(r[map[f]] ?? "").trim() : ""),
  };
}

export function buildVolunteers(raw: RawRow[], map: ColumnMap, d: Defaults): Built<VolunteerRow> {
  const out: Built<VolunteerRow> = { rows: [], skipped: [], notes: [] };
  let noDate = 0;
  const seen = new Map<string, number>();
  raw.forEach((r, i) => {
    const { get, rawGet } = getters(r, map);
    const p = personFrom(get, rawGet, "");
    if (!p) return out.skipped.push({ line: i + 2, reason: "No name or email" });
    const hours = parseHours(get("hours"));
    const date = (map.work_date ? parseDate(r[map.work_date]) : null) ?? (d.work_date || null);
    if (hours && !date) noDate++;
    const activity = get("activity") || d.activity || null;
    // two identical shifts in one file (same person, day, task and hours) are both kept
    const k = [p.email ?? `${p.first_name} ${p.last_name}|${p.phone ?? ""}`, date, activity, hours].join("|").toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.rows.push({
      ...p,
      work_date: date,
      hours,
      activity,
      notes: get("notes") || null,
      dup_index: n > 1 ? n : null,
    });
  });
  if (noDate)
    out.notes.push(`${noDate} row${noDate === 1 ? " has" : "s have"} hours but no date, so ${noDate === 1 ? "that person is" : "those people are"} marked as a volunteer without logging the hours. Enter a date below to log them.`);
  return out;
}

export function buildPeople(raw: RawRow[], map: ColumnMap, d: Defaults): Built<PeopleRow> {
  const out: Built<PeopleRow> = { rows: [], skipped: [], notes: [] };
  raw.forEach((r, i) => {
    const { get, rawGet } = getters(r, map);
    const p = personFrom(get, rawGet, "");
    if (!p) return out.skipped.push({ line: i + 2, reason: "No name or email" });
    out.rows.push({
      ...p,
      is_board_member: !!d.everyone_board || truthy(get("is_board_member")),
      is_volunteer: !!d.everyone_volunteer || truthy(get("is_volunteer")),
      do_not_email: truthy(get("do_not_email")),
      do_not_call: truthy(get("do_not_call")),
      do_not_mail: truthy(get("do_not_mail")),
      notes: get("notes") || null,
    });
  });
  return out;
}

export function buildAuction(raw: RawRow[], map: ColumnMap, d: Defaults): Built<AuctionRow> {
  const out: Built<AuctionRow> = { rows: [], skipped: [], notes: [] };
  const seen = new Map<string, number>();
  raw.forEach((r, i) => {
    const { get, rawGet } = getters(r, map);
    const title = get("title");
    if (!title) {
      // OneCause exports end with blank or total lines
      if (Object.values(r).some((v) => str(v))) out.skipped.push({ line: i + 2, reason: "No item name" });
      return;
    }
    const itemNo = get("item_number") || null;
    const k = (itemNo ? `#${itemNo}` : `t:${title}`).toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    const money = (f: string) => {
      const v = parseAmount(get(f));
      return v === null || v < 0 ? null : Math.round(v * 100) / 100;
    };
    const sold = money("sold_amount");
    const buyer = personFrom(get, rawGet, "buyer_");
    out.rows.push({
      item_number: itemNo,
      title,
      description: get("description") || null,
      sale_type: saleType(get("sale_type")) ?? (d.sale_type || null),
      // a blank Service cell leaves what staff set alone
      is_service: map.is_service && get("is_service") ? truthy(get("is_service")) : null,
      fair_market_value: money("fair_market_value"),
      received_date: map.received_date ? parseDate(r[map.received_date]) : null,
      bidder_number: get("bidder_number") || null,
      // a $0 "winning bid" on an unsold item isn't a sale
      sold_amount: sold && sold > 0 ? sold : null,
      sold_date: map.sold_date ? parseDate(r[map.sold_date]) : null,
      notes: get("notes") || null,
      dup_index: n > 1 ? n : null,
      donor: personFrom(get, rawGet, "donor_"),
      buyer: sold && sold > 0 ? buyer : null,
    });
  });
  const dups = out.rows.filter((r) => r.dup_index).length;
  if (dups)
    out.notes.push(
      `${dups} item${dups === 1 ? " shares" : "s share"} a name${map.item_number ? " or item #" : ""} with another row, so ${dups === 1 ? "it is" : "they are"} kept as separate items. Re-importing this same file later updates them in the same order.`
    );
  const noDonor = out.rows.filter((r) => !r.donor).length;
  if (noDonor) out.notes.push(`${noDonor} item${noDonor === 1 ? " has" : "s have"} no donor in the file. You can add the donor on the In-Kind tab.`);
  return out;
}

/** A blank sheet with the headings each import expects, plus an example row. */
export function templateFor(kind: ImportKind): { name: string; header: string[]; sample: string[][] } {
  if (kind === "volunteers")
    return {
      name: "DHA volunteer import template.csv",
      header: ["First Name", "Last Name", "Email", "Phone", "Date", "Hours", "Activity", "Notes"],
      sample: [
        ["Jane", "Smith", "jane@example.com", "817-555-0100", "3/14/2026", "4", "Love That Smile setup", ""],
        ["Luis", "Garcia", "luis@example.com", "", "", "", "", "New volunteer, no hours yet"],
      ],
    };
  if (kind === "people")
    return {
      name: "DHA people import template.csv",
      header: ["First Name", "Last Name", "Business", "Email", "Phone", "Address", "City", "State", "Zip", "Board Member", "Volunteer", "Do Not Email", "Do Not Call", "Do Not Mail", "Notes"],
      sample: [["Jane", "Smith", "", "jane@example.com", "817-555-0100", "123 Main St", "Arlington", "TX", "76010", "Yes", "", "", "Yes", "", "Asked by phone not to be called"]],
    };
  return {
    name: "DHA auction item import template.csv",
    header: ["Item #", "Item Name", "Description", "Type", "Fair Market Value", "Donor Name", "Donor Company", "Donor Email", "Donor Phone", "Bidder #", "Winning Bidder", "Winner Email", "Winning Bid", "Notes"],
    sample: [["101", "Teeth whitening package", "In-office whitening at Smile Dental", "Silent", "450", "Dr. Ana Lopez", "Smile Dental", "ana@example.com", "817-555-0101", "212", "John Doe", "john@example.com", "500", ""]],
  };
}
