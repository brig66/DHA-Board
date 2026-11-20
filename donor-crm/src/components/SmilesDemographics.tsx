// Demographic totals on the SMILES tab: who returned permission forms this school year.
// Totals for the whole program only, read live from the DHA website and never saved.
import type { SmilesDemographics as Demographics, SmilesDemographicGroup } from "@/lib/smiles";

const whole = new Intl.NumberFormat("en-US");

function pct(n: number, of: number) {
  if (!of) return "—";
  const p = (n / of) * 100;
  return `${p > 0 && p < 1 ? "<1" : Math.round(p)}%`;
}

function GroupTable({ group, base }: { group: SmilesDemographicGroup; base: Demographics["base"] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pb-2 pt-4">
        <h3 className="font-display text-base font-semibold">{group.label}</h3>
        {group.note && <p className="muted text-xs">{group.note}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>&nbsp;</th>
              <th className="text-right">Forms returned</th>
              <th className="text-right">%</th>
              <th className="text-right">Permission yes</th>
              <th className="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.label}>
                <td className={r.label === "Not given" ? "muted italic" : ""}>{r.label}</td>
                <td className="whitespace-nowrap text-right">{whole.format(r.returned)}</td>
                <td className="muted whitespace-nowrap text-right">{pct(r.returned, base.returned)}</td>
                <td className="whitespace-nowrap text-right">{whole.format(r.yes)}</td>
                <td className="muted whitespace-nowrap text-right">{pct(r.yes, base.yes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SmilesDemographics({ data }: { data: Demographics | null }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Who returned forms</h2>
        <p className="muted text-sm">
          Demographics from the permission forms for the whole program this school year: one form per child, the same
          forms counted in &ldquo;Forms returned&rdquo;. Percentages are out of{" "}
          {data ? (
            <>
              {whole.format(data.base.returned)} forms returned and {whole.format(data.base.yes)} with permission yes.
            </>
          ) : (
            <>the forms returned.</>
          )}{" "}
          Totals only; no child or school is shown.
        </p>
      </div>
      {!data ? (
        <div className="card p-4">
          <p className="muted text-sm">
            The website isn&rsquo;t sending demographics yet. They appear here once the DHA SMILES Entries plugin
            (version 2.1 or later) is active on the DHA website.
          </p>
        </div>
      ) : data.base.returned === 0 ? (
        <div className="card p-4">
          <p className="muted text-sm">No permission forms for this school year yet.</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {data.groups.map((g) => (
            <GroupTable key={g.key} group={g} base={data.base} />
          ))}
        </div>
      )}
    </section>
  );
}
