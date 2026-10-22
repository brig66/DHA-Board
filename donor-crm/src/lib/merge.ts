import { fillMerge } from "../../supabase/functions/_shared/email-html";
import type { ContactSummary } from "./types";

/** Same merge fields as the sending function, so the preview matches what donors receive. */
export function fillMergeFields(text: string, c: ContactSummary | undefined, html = false): string {
  return fillMerge(text, c, html);
}
