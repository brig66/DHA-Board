// Usage: npx tsx scripts/map-website.ts out.json "Donation History.xlsx"
// Reads the donation website export the same way the Import page does and
// prints what it found (for checking an export before loading it).
import { writeFileSync } from "fs";
import readXlsxFile from "read-excel-file/node";
import { mapRows } from "../src/lib/importMapper";

async function main() {
const [out, file] = process.argv.slice(2);
const rows = await readXlsxFile(file);
const [header, ...body] = rows;
const names = header.map((h) => String(h ?? "").trim());
const res = mapRows(body.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]]))));
const sum = (xs: { amount: number }[]) => xs.reduce((s, r) => s + r.amount, 0).toFixed(2);
console.log("gifts:", res.rows.length, "total:", sum(res.rows));
for (const t of ["Donation", "Event ticket / registration", "In-kind"]) {
  const xs = res.rows.filter((r) => r.gift_type === t);
  console.log(`  ${t}: ${xs.length} = ${sum(xs)}`);
}
console.log("offline (re-entry check):", res.rows.filter((r) => r.check_reentry).length);
const skipped: Record<string, number> = {};
res.skipped.forEach((s) => (skipped[s.reason] = (skipped[s.reason] ?? 0) + 1));
console.log("skipped:", JSON.stringify(skipped));
const ev: Record<string, number> = {};
res.rows.forEach((r) => (ev[r.event_name] = (ev[r.event_name] ?? 0) + 1));
console.log("events:", JSON.stringify(ev, null, 1));
writeFileSync(out, JSON.stringify(res.rows));
}

main();
