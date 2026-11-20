// SMILES totals from the DHA website (the SMILES Data plugin's summary feed).
// Server-only: SMILES_API_KEY is a secret and must never reach the browser, so it
// has no NEXT_PUBLIC_ prefix and this file can't be imported by client code.
// Children's records never leave the website. The feed sends totals only, and the
// CRM shows them without saving them anywhere.
import "server-only";

export const DEFAULT_SMILES_FEED = "https://dentalhealtharlington.org/wp-json/smiles/v1/summary";

export const SMILES_FIELDS = [
  "forms_sent_home",
  "forms_returned",
  "consent_yes",
  "consent_no",
  "screened",
  "sealant_children",
  "teeth_sealed",
  "fluoride",
  "decay_none",
  "decay_early",
  "decay_urgent",
  "volunteers",
  "volunteer_hours",
] as const;
export type SmilesField = (typeof SMILES_FIELDS)[number];

/** null = hidden for privacy (only ever in the by-school numbers) */
export type SmilesNumbers = Record<SmilesField, number | null>;

/** One category (e.g. "3rd grade") and how many forms fall in it. */
export type SmilesDemographicRow = { label: string; returned: number; yes: number };
export type SmilesDemographicGroup = { key: string; label: string; note: string; rows: SmilesDemographicRow[] };
/**
 * Demographic totals for the whole program in one school year, sent by the website's
 * DHA SMILES Entries plugin. Totals only: never a child, never a school breakdown.
 */
export type SmilesDemographics = {
  base: { returned: number; yes: number };
  groups: SmilesDemographicGroup[];
};

export type SmilesSummary = {
  school_year: string;
  generated_at: string | null;
  last_form_at: string | null;
  visits: number;
  totals: SmilesNumbers;
  by_month: (SmilesNumbers & { month: string })[];
  by_school: (SmilesNumbers & { school: string })[];
  links: { import: string; settings: string };
  /** null when the website doesn't send demographics (DHA SMILES Entries 2.1+ not installed) */
  demographics: SmilesDemographics | null;
};

export type SmilesResult = { ok: true; data: SmilesSummary } | { ok: false; problem: string };

/** "2026-2027" for any day from July 2026 through June 2027 (Texas time). */
export function currentSchoolYear(now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

export function isSchoolYear(s: unknown): s is string {
  const m = typeof s === "string" ? s.match(/^(\d{4})-(\d{4})$/) : null;
  return !!m && Number(m[2]) === Number(m[1]) + 1 && Number(m[1]) >= 2000 && Number(m[1]) < 2100;
}

/** The feed address: SMILES_API_URL if set (https, or http on this computer for testing), else the website. */
function feedUrl(): URL | null {
  const raw = (process.env.SMILES_API_URL || "").trim() || DEFAULT_SMILES_FEED;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? u : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function numbers(o: unknown, hidable: boolean): SmilesNumbers {
  const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const out = {} as SmilesNumbers;
  for (const f of SMILES_FIELDS) {
    const n = num(src[f]);
    // only the by-school numbers are ever hidden; a missing total is shown as 0
    out[f] = n === null && !hidable ? 0 : n;
  }
  return out;
}

/** A website link from the feed, kept only if it's an ordinary link on the website itself. */
function siteLink(v: unknown, feed: URL, fallbackPage: string): string {
  try {
    const u = new URL(String(v ?? ""));
    if ((u.protocol === "https:" || u.protocol === "http:") && u.host === feed.host) return u.toString();
  } catch {
    // fall through to the standard admin page
  }
  return `${feed.origin}/wp-admin/tools.php?page=${fallbackPage}`;
}

const count = (v: unknown): number => {
  const n = num(v);
  return n === null || n < 0 ? 0 : Math.round(n);
};

/** Demographic totals from the feed, or null if missing or not in the expected shape. */
function demographics(raw: unknown): SmilesDemographics | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const base = (d.base && typeof d.base === "object" ? d.base : null) as Record<string, unknown> | null;
  if (!base || !Array.isArray(d.groups)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  const groups: SmilesDemographicGroup[] = [];
  for (const g of d.groups.slice(0, 20)) {
    if (!g || typeof g !== "object") continue;
    const gr = g as Record<string, unknown>;
    const label = str(gr.label);
    if (!label || !Array.isArray(gr.rows)) continue;
    const rows = gr.rows
      .slice(0, 50)
      .filter((r) => r && typeof r === "object" && str((r as { label?: unknown }).label))
      .map((r) => {
        const rr = r as Record<string, unknown>;
        return { label: str(rr.label), returned: count(rr.returned), yes: count(rr.yes) };
      });
    groups.push({ key: str(gr.key) || label, label, note: str(gr.note), rows });
  }
  return { base: { returned: count(base.returned), yes: count(base.yes) }, groups };
}

function tidy(raw: unknown, feed: URL): SmilesSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isSchoolYear(r.school_year) || !r.totals || typeof r.totals !== "object") return null;
  const links = (r.links && typeof r.links === "object" ? r.links : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    school_year: r.school_year,
    generated_at: text(r.generated_at),
    last_form_at: text(r.last_form_at),
    visits: num(r.visits) ?? 0,
    totals: numbers(r.totals, false),
    by_month: (Array.isArray(r.by_month) ? r.by_month : [])
      .filter((m) => m && typeof m === "object" && /^\d{4}-\d{2}$/.test(String((m as { month?: unknown }).month)))
      .map((m) => ({ month: String((m as { month: string }).month), ...numbers(m, false) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    by_school: (Array.isArray(r.by_school) ? r.by_school : [])
      .filter((s) => s && typeof s === "object" && text((s as { school?: unknown }).school))
      .map((s) => ({ school: text((s as { school: string }).school)!, ...numbers(s, true) })),
    links: {
      import: siteLink(links.import, feed, "smiles-import"),
      settings: siteLink(links.settings, feed, "smiles-settings"),
    },
    demographics: demographics(r.demographics),
  };
}

/** Reads one school year's totals (the current one when none is given). Never throws. */
export async function getSmilesSummary(schoolYear?: string): Promise<SmilesResult> {
  const key = (process.env.SMILES_API_KEY || "").trim();
  if (!key)
    return { ok: false, problem: "SMILES isn't connected yet: the website's SMILES key hasn't been added to the CRM." };
  const feed = feedUrl();
  if (!feed) return { ok: false, problem: "The SMILES feed address set for the CRM isn't a secure (https) web address." };

  const url = new URL(feed);
  if (isSchoolYear(schoolYear)) url.searchParams.set("school_year", schoolYear);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error("SMILES feed unreachable:", (e as Error).name);
    return { ok: false, problem: "The website didn't answer. It may be busy or down; try again in a few minutes." };
  }

  if (!res.ok) {
    console.error("SMILES feed status", res.status);
    const problem =
      res.status === 401
        ? "The website didn't accept the CRM's SMILES key. A new key needs to be created on the website and added to the CRM."
        : res.status === 403
          ? "The SMILES feed is turned off on the website (Tools → SMILES Settings)."
          : res.status === 404
            ? "The SMILES feed isn't on the website yet. It starts working once the SMILES Data plugin is installed there."
            : `The website answered with an error (${res.status}). Try again in a few minutes.`;
    return { ok: false, problem };
  }

  const data = tidy(await res.json().catch(() => null), feed);
  if (!data) return { ok: false, problem: "The website sent something the CRM couldn't read as SMILES totals." };
  return { ok: true, data };
}
