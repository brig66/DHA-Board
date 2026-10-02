// Turns rows from a donor spreadsheet (North Texas Giving Day export, the
// donation website's "Donation History" export, or any sheet with columns like
// "First Name", "Email", "Amount", "Date") into clean gift rows that the
// database's import_donations() function understands. Attendee lists (names
// and contact details, no amounts) are read by mapAttendees().

export type GiftRow = {
  tracking_no: string | null;
  gift_date: string; // YYYY-MM-DD
  gift_time: string | null; // HH:MM:SS
  amount: number;
  net_amount: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  event_name: string;
  payment_method: string | null;
  fundraiser_page: string | null;
  recognition_name: string | null;
  dedication: string | null;
  anonymous: boolean;
  notes: string | null;
  organization: string | null;
  gift_type: GiftType;
  // offline entries that may repeat a gift already recorded online
  check_reentry: boolean;
};

export type GiftType = "Donation" | "Event ticket / registration" | "In-kind";

export type AttendeeRow = {
  first_name: string;
  last_name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
};

export type AttendeeResult = {
  rows: AttendeeRow[];
  skipped: { line: number; reason: string }[];
  recognized: string[];
};

export type MapResult = {
  rows: GiftRow[];
  skipped: { line: number; reason: string }[];
  recognized: string[]; // which of our fields were found in the sheet
};

type RawRow = Record<string, unknown>;

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// For each field, the column headings we accept (first one found wins).
const ALIASES: Record<string, string[]> = {
  tracking_no: ["tracking", "trackingno", "trackingnumber", "transactionid", "donationid", "giftid"],
  first_name: ["donorfirstname", "firstname", "first", "givenname"],
  last_name: ["donorlastname", "lastname", "last", "surname", "familyname"],
  full_name: ["donorname", "name", "fullname", "donor"],
  email: ["email", "emailaddress", "donoremail", "email1"],
  phone: ["phoneid7302", "phonenumberid7887", "phone", "phonenumber", "donorphone", "mobile", "mobilephone", "cell", "cellphone", "homephone"],
  address: ["address", "streetaddress", "address1", "mailingaddress", "street"],
  address2: ["address2", "apt", "suite", "unit"],
  city: ["city", "town"],
  state: ["state", "st", "province"],
  zip: ["zip", "zipcode", "postalcode", "postcode"],
  country: ["country"],
  gift_date: ["date", "giftdate", "donationdate", "datereceived", "datedonated"],
  gift_time: ["timecentral", "time"],
  amount: ["amount", "giftamount", "donationamount", "total"],
  net_amount: ["netamount"],
  event_name: ["givingeventname", "event", "eventname", "campaign", "appeal", "fund"],
  payment_method: ["paymentmethod", "payment", "method"],
  donation_site: ["donationsite"],
  page_creator: ["pagecreator", "fundraiser"],
  fundraiser_source: ["source"],
  repeats: ["repeats", "recurring", "frequency"],
  recognition_name: ["recognitionnamesid7888", "recognitionnameid7639", "recognitionname"],
  dedication_type: ["dedicationtype"],
  dedication_name: ["dedicationname"],
  fully_anonymous: ["fullyanonymous", "anonymous"],
  notes: ["notesid7921", "notes", "comments", "note"],
  organization: ["organizationname", "organization", "company", "companyname", "business", "businessname"],
  volunteer: ["interestedinvolunteering", "volunteerinterestid7638"],
  refund: ["refund"],
};

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(/\s+/g, " ").trim();
}

function isAnon(v: string) {
  return v.toLowerCase() === "anonymous";
}

/** "brandon" -> "Brandon", "MCKINZIE" -> "McKinzie". Mixed-case input is kept as typed. */
export function properCase(s: string, isName = true): string {
  if (!s) return s;
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  if (hasLower && hasUpper) return s;
  let out = s
    .toLowerCase()
    .replace(/(^|[\s\-'\/(])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  if (isName) {
    out = out.replace(/\bMc([a-z])/g, (_m, c) => "Mc" + c.toUpperCase());
    // initials such as "AJ" or "JR" stay capitalized
    if (/^[A-Z]{2}$/.test(s.trim())) out = s.trim();
  } else {
    // keep PO Box, directions and unit abbreviations readable in addresses
    out = out
      .replace(/\bP\.?\s?O\.?\s?Box\b/gi, "PO Box")
      .replace(/\b(Ne|Nw|Se|Sw|N|S|E|W)\b(?=[\s.,]|$)/g, (m) => m.toUpperCase());
  }
  return out;
}

function cleanFirstName(s: string): string {
  return properCase(
    s
      .replace(/\(.*?\)/g, "") // "Sarah (Sally)" -> "Sarah"
      .replace(/\s+(and|&)$/i, "") // "Maureen and" -> "Maureen"
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function formatPhone(raw: string): string | null {
  if (!raw || isAnon(raw)) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw.trim() || null;
}

function cleanZip(raw: string): string | null {
  const z = raw.replace(/[^0-9-]/g, "");
  if (!z) return null;
  if (/^\d{4}$/.test(z)) return "0" + z; // spreadsheet dropped a leading zero
  return z;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const neg = /^\(.*\)$/.test(raw.trim()) || raw.includes("-");
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

function parseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = str(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  if (/^\d{5}$/.test(s)) {
    // Excel serial date number
    const d = new Date(Date.UTC(1899, 11, 30) + parseInt(s, 10) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseTime(raw: string): string | null {
  const m = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[4]) {
    const pm = m[4].toLowerCase() === "pm";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

/** Gives every gift a readable event name, filling in ones the platform left blank. */
export function normalizeEvent(
  event: string,
  date: string,
  site: string,
  repeats: string
): string {
  const e = event.trim();
  const ntx = e.match(/north texas giving day\s*'?(\d{2,4})\b/i) || e.match(/ntx giving day\s*'?(\d{2,4})\b/i);
  if (ntx) {
    const y = ntx[1].length === 2 ? "20" + ntx[1] : ntx[1];
    return `NTX Giving Day ${y}`;
  }
  if (e) return e;
  if (repeats) return "Monthly recurring gift";
  if (/north texas giving day/i.test(site)) {
    // #GivingTuesdayNow (May 5, 2020) ran on the North Texas Giving Day site
    if (date >= "2020-04-28" && date <= "2020-05-06") return "#GivingTuesdayNow 2020";
    return "Online gift (NTX Giving Day website)";
  }
  return "General donation";
}

function buildLookup(headers: string[]) {
  const byKey = new Map<string, string>();
  for (const h of headers) {
    const k = key(h);
    if (!byKey.has(k)) byKey.set(k, h);
  }
  const found: Record<string, string[]> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const cols: string[] = [];
    for (const a of aliases) {
      const h = byKey.get(a);
      if (h) cols.push(h);
    }
    if (cols.length) found[field] = cols;
  }
  return found;
}

export function mapRows(raw: RawRow[]): MapResult {
  const result: MapResult = { rows: [], skipped: [], recognized: [] };
  if (!raw.length) return result;

  const headers = Array.from(new Set(raw.flatMap((r) => Object.keys(r))));
  if (isDonationWebsiteExport(headers)) return mapDonationWebsite(raw, headers);
  const cols = buildLookup(headers);
  result.recognized = Object.keys(cols);

  // first non-empty, non-"Anonymous" value among the matching columns
  const get = (r: RawRow, field: string, allowAnon = false): string => {
    for (const c of cols[field] ?? []) {
      const v = str(r[c]);
      if (v && (allowAnon || !isAnon(v))) return v;
    }
    return "";
  };

  raw.forEach((r, i) => {
    const line = i + 2; // +1 for header row, +1 for 1-based numbering
    const first = get(r, "first_name", true);
    const last = get(r, "last_name", true);
    const anonymous =
      get(r, "fully_anonymous").toLowerCase() === "yes" ||
      get(r, "fully_anonymous").toLowerCase() === "true" ||
      (isAnon(first) && isAnon(last));

    let firstName = anonymous ? "" : cleanFirstName(first);
    let lastName = anonymous ? "" : properCase(last.replace(/\s+/g, " ").trim());
    let organization = anonymous ? null : cleanOrganization(get(r, "organization"));
    if (!anonymous && !firstName && !lastName) {
      const full = get(r, "full_name");
      if (full) {
        const n = parseName(full);
        firstName = n.first;
        lastName = n.last;
        organization = n.organization ?? organization;
      } else if (organization) {
        // a business or foundation with no contact person
        lastName = organization;
      }
    }

    const dateCell = (cols.gift_date ?? []).map((c) => r[c]).find((v) => str(v));
    const gift_date = parseDate(dateCell);
    if (!gift_date) {
      result.skipped.push({ line, reason: "No donation date" });
      return;
    }
    const amount = parseAmount(get(r, "amount"));
    if (amount === null) {
      result.skipped.push({ line, reason: "No donation amount" });
      return;
    }
    const email = anonymous ? null : get(r, "email").toLowerCase() || null;
    if (!anonymous && !firstName && !lastName && !email) {
      result.skipped.push({ line, reason: "No donor name or email" });
      return;
    }

    const addr1 = anonymous ? "" : get(r, "address");
    const addr2 = anonymous ? "" : get(r, "address2");
    const address = [addr1, addr2].filter(Boolean).join(", ").replace(/\s+,/g, ",");

    const pageCreator = get(r, "page_creator");
    const fundraiserSource = get(r, "fundraiser_source");
    const fundraiser_page = pageCreator
      ? `${pageCreator}${fundraiserSource ? ` (${fundraiserSource} page)` : ""}`
      : null;

    const dedType = get(r, "dedication_type");
    const dedName = get(r, "dedication_name");
    const dedication = dedType || dedName ? [dedType, dedName].filter(Boolean).join(": ") : null;

    const noteParts = [get(r, "notes")];
    const vol = get(r, "volunteer");
    if (vol && /^yes$/i.test(vol)) noteParts.push("Interested in volunteering");
    const refund = get(r, "refund");
    if (refund) noteParts.push(`Refund: ${refund}`);

    result.rows.push({
      tracking_no: get(r, "tracking_no") || null,
      gift_date,
      gift_time: parseTime(get(r, "gift_time")),
      amount,
      net_amount: parseAmount(get(r, "net_amount")),
      first_name: firstName,
      last_name: lastName,
      email,
      phone: anonymous ? null : formatPhone(get(r, "phone")),
      address: address ? properCase(address, false) : null,
      city: anonymous ? null : properCase(get(r, "city"), false) || null,
      state: anonymous ? null : get(r, "state").toUpperCase() || null,
      zip: anonymous ? null : cleanZip(get(r, "zip")),
      country: anonymous ? null : get(r, "country") || null,
      event_name: normalizeEvent(get(r, "event_name"), gift_date, get(r, "donation_site"), get(r, "repeats")),
      payment_method: get(r, "payment_method") || null,
      fundraiser_page,
      recognition_name: anonymous ? null : get(r, "recognition_name") || null,
      dedication,
      anonymous,
      notes: noteParts.filter(Boolean).join(" · ") || null,
      organization,
      gift_type: "Donation",
      check_reentry: false,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Names: people, couples and businesses
// ---------------------------------------------------------------------------

// Words that mark a "name" as a business rather than a person (mostly the
// restaurants and shops that donated to Love That Smile auctions).
const BUSINESS =
  /\b(inc|llc|pllc|l\.?l\.?p|corp|corporation|company|foundation|bank|ministries|museum|theatre|theater|school|chamber of commerce|restaurant|resturant|brewery|brewhouse|grill|tacos?|taco shop|cafe|coffee|starbucks|potbelly|chick-fil-a|gnc|smallcakes|pie shoppe|lone star park|amazing lash|melting pot|music & arts|thrift ?for ?good|board and brush|hand and stone|kendra scott|raising cane'?s|mcalister'?s|houlihans|billy bob'?s|bone daddy'?s|alley cats|sugar bee'?s|painting with a twist|fish city|urban alchemy|rockfish|legal draft|studio movie|paul mitchell|henry schein|midwest dental|torchy'?s|black eyed pea|cidercade|back 9)\b|contact unknown|unknown donor/i;

// Organization values that aren't really an organization
const NOT_AN_ORG = /^(individual|anonymous|n\/?a|none|self|dha|dental health arlington|discover)$/i;

const UNKNOWN_CONTACT = /\s*(contact unknown|unknown donor|\d+ tickets?)\s*$/i;

function cleanOrganization(raw: string): string | null {
  const o = raw.replace(/\s+/g, " ").trim();
  if (!o || NOT_AN_ORG.test(o)) return null;
  return o;
}

/** "Mansfield Board and Brush Mansfield Board and Brush" -> "Mansfield Board and Brush" */
function dedupeRepeat(s: string): string {
  const words = s.split(" ");
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    if (words.slice(0, half).join(" ").toLowerCase() === words.slice(half).join(" ").toLowerCase()) {
      return words.slice(0, half).join(" ");
    }
  }
  // "Burke Burke" -> "Burke"
  return words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase()).join(" ");
}

export type ParsedName = {
  first: string;
  last: string;
  organization: string | null;
  contactNote: string | null; // person named alongside a business
  guest: boolean; // "Guest of …", no real name to record
};

/**
 * Splits a single "Name" cell. Handles "Dr. Jane Smith", "Shad Hattaway, DDS",
 * couples ("Ben & Mary Doskocil" -> Ben Doskocil), "Gary Rice Jr", and
 * businesses ("Melting Pot  Dave Hatala, Mgr" -> business "Melting Pot").
 */
export function parseName(rawName: string, orgColumn = ""): ParsedName {
  const raw = String(rawName ?? "").replace(/\t/g, " ").trim();
  const flat = raw.replace(/\s+/g, " ");
  const org = cleanOrganization(orgColumn);
  const out: ParsedName = { first: "", last: "", organization: org, contactNote: null, guest: false };
  if (!flat) return out;

  if (/^(guest|husband|wife|spouse|plus one|\+1)\b/i.test(flat)) {
    out.guest = true;
    return out;
  }

  // someone who typed their own name as the organization isn't a business
  if (org && org.toLowerCase() === flat.toLowerCase()) out.organization = null;
  const isBusiness = BUSINESS.test(flat);
  if (isBusiness) {
    // "Business  Contact person" or "Business / Contact person"
    const m = raw.match(/^(.*?)(?:\s{2,}|\s*\/\s*)(.+)$/);
    let name = flat;
    if (m && BUSINESS.test(m[1].replace(UNKNOWN_CONTACT, "")) && !UNKNOWN_CONTACT.test(m[1])) {
      name = m[1].replace(/\s+/g, " ").trim();
      const contact = m[2].replace(/\s+/g, " ").trim();
      if (contact && !UNKNOWN_CONTACT.test(" " + contact)) out.contactNote = contact;
    }
    name = dedupeRepeat(name.replace(UNKNOWN_CONTACT, "").trim());
    out.last = name;
    out.organization = name;
    return out;
  }

  let s = flat
    .replace(/^(dr|mr|mrs|ms|miss)\.?\s+/i, "")
    .replace(/,?\s+(dds|dmd|rdh|md|phd|cpa)\b.*$/i, "")
    .replace(/\s+guest$/i, "")
    .trim();
  s = dedupeRepeat(s);
  const words = s.split(" ");
  let last = words.length > 1 ? words.pop()! : "";
  if (/^(jr|sr|ii|iii|iv)\.?$/i.test(last) && words.length > 1) last = `${words.pop()} ${last}`;
  if (/^\d+$/.test(last)) {
    // "Back 9" is a business name, not a person
    words.push(last);
    last = "";
  }
  // couples: "Ben & Mary", "Jim/Barb", "Larry and Jill" -> first person
  const firstPart = words.join(" ").split(/\s*(?:&|\/|\band\b)\s*/i)[0];
  out.first = cleanFirstName(firstPart);
  out.last = properCase(last.replace(/^[^A-Za-z]+/, ""));
  return out;
}

// ---------------------------------------------------------------------------
// Donation website "Donation History" export
// ---------------------------------------------------------------------------

function isDonationWebsiteExport(headers: string[]) {
  const keys = new Set(headers.map(key));
  return keys.has("donationid") && keys.has("category") && keys.has("title") && keys.has("status");
}

/** Readable event names for the donation website's page titles. */
export function websiteEvent(title: string, date: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  const y = date.slice(0, 4);
  const rules: [RegExp, string][] = [
    [/^no preference$/i, "General donation"],
    [/^smiles\b/i, "SMILES program"],
    [/^dha dental services$/i, "DHA Dental Services"],
    [/^give kids a smile/i, `Give Kids A Smile ${y}`],
    [/^1st annual "?love that smile/i, "Love That Smile 2017"],
    [/love that smile.*(20\d\d)/i, "Love That Smile $1"],
    [/love that smile/i, `Love That Smile ${y}`],
    [/summer seminar (20\d\d)/i, "DHA Summer Seminar $1"],
    [/summer (seminar|ce)/i, `DHA Summer Seminar ${y}`],
    [/golf tournament/i, `DHA Golf Tournament ${y}`],
    [/panoramic x-?ray/i, "Panoramic X-ray Machine campaign"],
    [/capital needs\s*-\s*server/i, "Capital Needs (server)"],
    [/^capital campaign$/i, "Capital Campaign"],
    [/^your gift\s*-\s*their smile.*(20\d\d)/i, "Your Gift – Their Smile year-end campaign $1"],
    [/year\s*-?\s*end|end of year/i, "Year-End Campaign"],
    [/^#givingtuesday$/i, `#GivingTuesday ${y}`],
    [/^chamber campaign$/i, `Chamber Campaign ${y}`],
    [/^ed 10 year recognition$/i, "Executive Director 10-Year Recognition"],
    [/suds for smiles/i, `SUDS for SMILES ${y}`],
  ];
  for (const [re, name] of rules) {
    const m = t.match(re);
    if (m) return name.replace("$1", m[1] ?? "");
  }
  return t || "General donation";
}

function mapDonationWebsite(raw: RawRow[], headers: string[]): MapResult {
  const result: MapResult = { rows: [], skipped: [], recognized: [] };
  const col = (k: string) => headers.find((h) => key(h) === k) ?? "";
  const C = {
    id: col("donationid"), when: col("datetime"), name: col("name"), org: col("organizationname"),
    email: col("email"), phone: col("phonenumber"), address: col("address"), city: col("city"),
    state: col("state"), zip: col("zipcode"), category: col("category"), title: col("title"),
    payment: col("paymenttype"), donation: col("donationamount"), registration: col("registrationamount"),
    net: col("netamount"), status: col("status"), tribute: col("inhonorofinmemoryof"),
    referred: col("referredby"), comments: col("comments"),
  };
  result.recognized = ["full_name", "email", "phone", "address", "city", "state", "zip", "gift_date", "amount", "event_name", "tracking_no", "payment_method"];

  raw.forEach((r, i) => {
    const line = i + 2;
    const v = (c: string) => (c ? str(r[c]) : "");
    const status = v(C.status);
    if (status && !/^approved$/i.test(status)) {
      result.skipped.push({ line, reason: `Payment ${status.toLowerCase()}` });
      return;
    }
    const whenCell = C.when ? r[C.when] : "";
    const gift_date = parseDate(whenCell);
    if (!gift_date) {
      result.skipped.push({ line, reason: "No donation date" });
      return;
    }
    const amount = (parseAmount(v(C.donation)) ?? 0) + (parseAmount(v(C.registration)) ?? 0);
    if (!amount) {
      result.skipped.push({ line, reason: "No donation amount" });
      return;
    }

    const category = v(C.category);
    const payment = v(C.payment);
    const offline = /^offline/i.test(category);
    const gift_type: GiftType = /registration/i.test(category)
      ? "Event ticket / registration"
      : /in-?kind/i.test(payment)
        ? "In-kind"
        : "Donation";

    const rawName = C.name ? String(r[C.name] ?? "") : "";
    const email = v(C.email).toLowerCase() || null;
    const anonymous = (!str(rawName) && !email) || /^anonymous(\s+anonymous)?$/i.test(str(rawName));
    const n = anonymous ? null : parseName(rawName, v(C.org));

    const tribute = Array.from(new Set(v(C.tribute).split(";").map((x) => x.trim()).filter(Boolean))).join("; ");
    const notes = [
      n?.contactNote ? `Contact: ${n.contactNote}` : "",
      v(C.comments),
      v(C.referred) ? `Referred by ${v(C.referred)}` : "",
    ].filter(Boolean);

    result.rows.push({
      tracking_no: v(C.id) ? `${offline ? "DWO" : "DW"}-${v(C.id)}` : null,
      gift_date,
      gift_time: parseTime(str(whenCell)),
      amount,
      net_amount: parseAmount(v(C.net)),
      first_name: n?.first ?? "",
      last_name: n?.last ?? "",
      email: anonymous ? null : email,
      phone: anonymous ? null : formatPhone(v(C.phone)),
      address: anonymous || !v(C.address) ? null : properCase(v(C.address), false),
      city: anonymous ? null : properCase(v(C.city), false) || null,
      state: anonymous ? null : v(C.state).toUpperCase() || null,
      zip: anonymous ? null : cleanZip(v(C.zip)),
      country: null,
      event_name: websiteEvent(v(C.title), gift_date),
      payment_method: payment || null,
      fundraiser_page: null,
      recognition_name: null,
      dedication: tribute ? (/^in (honor|memory)/i.test(tribute) ? tribute : `In honor/memory of: ${tribute}`) : null,
      anonymous,
      notes: notes.join(" · ") || null,
      organization: anonymous ? null : (n?.organization ?? null),
      gift_type,
      check_reentry: offline && gift_type === "Donation",
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Attendee lists (no amounts): event guests, seminar registrants
// ---------------------------------------------------------------------------

/** True when a sheet has people but no gift amounts, so it's an attendee list. */
export function looksLikeAttendeeList(raw: RawRow[]): boolean {
  if (!raw.length) return false;
  const headers = Array.from(new Set(raw.flatMap((r) => Object.keys(r))));
  const cols = buildLookup(headers);
  if (isDonationWebsiteExport(headers)) return false;
  return !cols.amount && !!(cols.full_name || cols.first_name || cols.email);
}

export function mapAttendees(raw: RawRow[]): AttendeeResult {
  const result: AttendeeResult = { rows: [], skipped: [], recognized: [] };
  if (!raw.length) return result;
  const headers = Array.from(new Set(raw.flatMap((r) => Object.keys(r))));
  const cols = buildLookup(headers);
  result.recognized = Object.keys(cols);
  const get = (r: RawRow, field: string): string => {
    for (const c of cols[field] ?? []) {
      const v = str(r[c]);
      if (v) return v;
    }
    return "";
  };
  const rawGet = (r: RawRow, field: string): string => {
    for (const c of cols[field] ?? []) {
      const v = String(r[c] ?? "").trim();
      if (v) return v;
    }
    return "";
  };

  raw.forEach((r, i) => {
    const line = i + 2;
    let first = cleanFirstName(get(r, "first_name"));
    let last = properCase(get(r, "last_name"));
    let organization = cleanOrganization(get(r, "organization"));
    if (!first && !last) {
      const n = parseName(rawGet(r, "full_name"), get(r, "organization"));
      if (n.guest) {
        result.skipped.push({ line, reason: "Unnamed guest" });
        return;
      }
      first = n.first;
      last = n.last;
      organization = n.organization ?? organization;
    }
    const email = get(r, "email").toLowerCase() || null;
    if (!first && !last && !email) {
      result.skipped.push({ line, reason: "No name or email" });
      return;
    }
    const addr = [get(r, "address"), get(r, "address2")].filter(Boolean).join(", ");
    result.rows.push({
      first_name: first,
      last_name: last,
      organization,
      email,
      phone: formatPhone(get(r, "phone")),
      address: addr ? properCase(addr, false) : null,
      city: properCase(get(r, "city"), false) || null,
      state: get(r, "state").toUpperCase() || null,
      zip: cleanZip(get(r, "zip")),
      country: get(r, "country") || null,
    });
  });
  return result;
}
