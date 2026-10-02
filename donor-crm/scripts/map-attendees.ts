// Usage: npx tsx scripts/map-attendees.ts out.json list.csv
// Reads an attendee list the same way the Import page does.
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import { mapAttendees } from "../src/lib/importMapper";

const [out, file] = process.argv.slice(2);
const parsed = Papa.parse<Record<string, string>>(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true });
const res = mapAttendees(parsed.data);
console.log(file.split("/").pop(), "| people:", res.rows.length, "| skipped:", JSON.stringify(res.skipped));
writeFileSync(out, JSON.stringify(res.rows));
