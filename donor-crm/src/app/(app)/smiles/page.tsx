// SMILES tab: totals for DHA's school program (screenings, fluoride and sealants for
// 2nd–4th graders), read live from the DHA website. Children's records stay on the
// website; this page only shows totals and saves nothing.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SchoolYearPicker from "@/components/SchoolYearPicker";
import {
  currentSchoolYear,
  getSmilesSummary,
  isSchoolYear,
  type SmilesField,
  type SmilesNumbers,
} from "@/lib/smiles";

export const dynamic = "force-dynamic";

const COLUMNS: [SmilesField, string][] = [
  ["forms_sent_home", "Forms sent home"],
  ["forms_returned", "Forms returned"],
  ["consent_yes", "Permission: yes"],
  ["consent_no", "Permission: no"],
  ["screened", "Screened"],
  ["sealant_children", "Children with sealants"],
  ["teeth_sealed", "Teeth sealed"],
  ["fluoride", "Fluoride"],
  ["decay_none", "No decay"],
  ["decay_early", "Early decay"],
  ["decay_urgent", "Urgent decay"],
  ["volunteers", "Volunteers"],
  ["volunteer_hours", "Volunteer hours"],
];

const whole = new Intl.NumberFormat("en-US");
const hours = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const fmt = (field: SmilesField, n: number) => (field === "volunteer_hours" ? hours : whole).format(n);

function when(iso: string | null, withTime = false) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** A number cell. In the by-school table a missing number was hidden for privacy (a count from 1 to 4). */
function Cell({ field, n }: { field: SmilesField; n: number | null }) {
  if (n === null)
    return (
      <td className="muted whitespace-nowrap text-right italic" title="Hidden for privacy: a count from 1 to 4">
        1–4
      </td>
    );
  return <td className="whitespace-nowrap text-right">{fmt(field, n)}</td>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-teal-700">{value}</div>
    </div>
  );
}

function NumbersTable({
  first,
  rows,
  total,
}: {
  first: string;
  rows: { name: string; n: SmilesNumbers }[];
  total?: SmilesNumbers;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{first}</th>
            {COLUMNS.map(([f, label]) => (
              <th key={f} className="text-right">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="whitespace-nowrap font-semibold">{r.name}</td>
              {COLUMNS.map(([f]) => (
                <Cell key={f} field={f} n={r.n[f]} />
              ))}
            </tr>
          ))}
          {total && (
            <tr className="bg-[#faf8f3]">
              <td className="font-semibold">Total</td>
              {COLUMNS.map(([f]) => (
                <td key={f} className="whitespace-nowrap text-right font-semibold">
                  {fmt(f, total[f] ?? 0)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function SmilesPage({ searchParams }: { searchParams: { year?: string } }) {
  // the same sign-in and activation check as the rest of the CRM (done here too, so the
  // website is only ever asked for totals on behalf of active staff)
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", user.id).single();
  if (!profile?.is_active) redirect("/dashboard");

  const asked = isSchoolYear(searchParams.year) ? searchParams.year : undefined;
  const result = await getSmilesSummary(asked);
  const shown = result.ok ? result.data.school_year : asked ?? currentSchoolYear();

  const thisYear = Number(currentSchoolYear().slice(0, 4));
  const years = Array.from({ length: 4 }, (_, i) => `${thisYear - i}-${thisYear - i + 1}`);
  if (!years.includes(shown)) years.push(shown);
  years.sort().reverse();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-display text-2xl font-semibold">SMILES</h1>
          <p className="muted text-sm">
            Free dental screenings, fluoride and sealants for 2nd–4th graders. Totals only: children&rsquo;s records
            stay on the DHA website and are never copied into the CRM.
          </p>
        </div>
        <SchoolYearPicker years={years} value={shown} />
      </div>

      {!result.ok ? (
        <div className="card p-6">
          <h2 className="font-display text-lg font-semibold">Couldn&rsquo;t load SMILES totals from the website.</h2>
          <p className="muted mt-1 text-sm">{result.problem}</p>
        </div>
      ) : (
        <SmilesTotals data={result.data} />
      )}
    </div>
  );
}

function SmilesTotals({ data }: { data: import("@/lib/smiles").SmilesSummary }) {
  const t = data.totals;
  const lastForm = when(data.last_form_at);
  const updated = when(data.generated_at, true);
  const formsOnly = data.visits === 0 && !t.screened && !t.volunteer_hours;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Forms returned" value={fmt("forms_returned", t.forms_returned ?? 0)} />
          <Stat label="Permission yes" value={fmt("consent_yes", t.consent_yes ?? 0)} />
          <Stat label="Screened" value={fmt("screened", t.screened ?? 0)} />
          <Stat label="Children with sealants" value={fmt("sealant_children", t.sealant_children ?? 0)} />
          <Stat label="School visits" value={whole.format(data.visits)} />
          <Stat label="Volunteer hours" value={fmt("volunteer_hours", t.volunteer_hours ?? 0)} />
        </div>
        <p className="muted text-sm">
          {lastForm ? <>Last permission form received {lastForm}. </> : <>No permission forms received yet this school year. </>}
          {updated && <>Totals as of {updated}.</>}
        </p>
        {formsOnly && (
          <p className="text-sm text-[#b8862e]">
            Screenings, sealants and volunteer hours show up here once staff enter school visits on the website.
          </p>
        )}
      </div>

      <section className="card overflow-hidden">
        <div className="p-4">
          <h2 className="font-display text-lg font-semibold">By month</h2>
          <p className="muted text-sm">
            Forms count in the month they came in. Visits, screenings and volunteers count in the month of the visit.
          </p>
        </div>
        {data.by_month.length ? (
          <NumbersTable
            first="Month"
            rows={data.by_month.map((m) => ({ name: monthName(m.month), n: m }))}
            total={t}
          />
        ) : (
          <p className="muted border-t border-[var(--border)] p-4 text-sm">Nothing yet for this school year.</p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="p-4">
          <h2 className="font-display text-lg font-semibold">By school</h2>
          <p className="muted text-sm">
            To protect children&rsquo;s privacy, the website hides any school count from 1 to 4, along with any number
            that would give one away. Those show here as &ldquo;1–4&rdquo;.
          </p>
        </div>
        {data.by_school.length ? (
          <NumbersTable first="School" rows={data.by_school.map((s) => ({ name: s.school, n: s }))} />
        ) : (
          <p className="muted border-t border-[var(--border)] p-4 text-sm">No schools yet for this school year.</p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-display text-lg font-semibold">Children&rsquo;s records</h2>
        <p className="muted text-sm">
          Importing permission forms and correcting a child&rsquo;s record happen on the DHA website. These open in a new
          tab, where you sign in to WordPress.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a className="btn btn-primary" href={data.links.import} target="_blank" rel="noopener noreferrer">
            Import permission forms ↗
          </a>
          <a className="btn btn-secondary" href={data.links.settings} target="_blank" rel="noopener noreferrer">
            SMILES settings ↗
          </a>
        </div>
      </section>
    </>
  );
}
