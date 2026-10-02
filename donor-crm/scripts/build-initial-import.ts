// Reads the original Giving Day spreadsheets in /data and writes the cleaned
// gift rows to data/initial-import.json (used once to load the database).
import { readFileSync, readdirSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { mapRows, type GiftRow } from "../src/lib/importMapper";

const dir = new URL("../data/", import.meta.url).pathname;
const all: GiftRow[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
  const parsed = Papa.parse<Record<string, string>>(readFileSync(dir + f, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  const res = mapRows(parsed.data);
  console.log(f, "rows:", res.rows.length, "skipped:", JSON.stringify(res.skipped));
  all.push(...res.rows);
}
writeFileSync(dir + "initial-import.json", JSON.stringify(all));
console.log("total", all.length);
