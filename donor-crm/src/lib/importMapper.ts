// Turns rows from a donor spreadsheet (North Texas Giving Day export, or any
// sheet with columns like "First Name", "Email", "Amount", "Date") into clean
// gift rows that the database's import_donations() function understands.

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
  phone: ["phoneid7302", "phonenumberid7887", "phone", "phonenumber", "donorphone", "mobile", "cell", "cellphone", "homephone"],
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
    if (!anonymous && !firstName && !lastName) {
      const full = get(r, "full_name");
      if (full) {
        const parts = full.split(" ");
        lastName = properCase(parts.length > 1 ? parts.pop()! : "");
        firstName = cleanFirstName(parts.join(" "));
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
    });
  });

  return result;
}
