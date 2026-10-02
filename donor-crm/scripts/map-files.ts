// Usage: npx tsx scripts/map-files.ts out.json file1.csv file2.csv ...
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { mapRows, type GiftRow } from "../src/lib/importMapper";

const [out, ...files] = process.argv.slice(2);
const all: GiftRow[] = [];
for (const f of files) {
  const parsed = Papa.parse<Record<string, string>>(readFileSync(f, "utf8"), { header: true, skipEmptyLines: true });
  const res = mapRows(parsed.data);
  const total = res.rows.reduce((s, r) => s + r.amount, 0);
  console.log(f.split("/").pop(), "| gifts:", res.rows.length, "| total:", total.toFixed(2), "| skipped:", JSON.stringify(res.skipped));
  const ev: Record<string, number> = {};
  res.rows.forEach((r) => (ev[r.event_name] = (ev[r.event_name] ?? 0) + 1));
  console.log("   events:", JSON.stringify(ev));
  all.push(...res.rows);
}
writeFileSync(out, JSON.stringify(all));
