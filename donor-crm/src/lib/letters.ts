// Email wording for in-kind thank-you letters and auction buyer receipts.
import { escapeHtml } from "../../supabase/functions/_shared/email-html";
import { money } from "./format";
import type { LetterKind } from "./types";

export const LETTER_TEMPLATE_NAME: Record<LetterKind, string> = {
  inkind_ack: "In-kind thank-you letter",
  buyer_receipt: "Auction buyer receipt",
};

export function defaultSubject(kind: LetterKind, event: string): string {
  return kind === "inkind_ack" ? `Thank you for supporting ${event}` : `Your receipt from ${event}`;
}

export function defaultMessage(kind: LetterKind, org: string, signer: string, title: string): string {
  if (kind === "inkind_ack")
    return `Dear {{first_name}},

Thank you for donating {{items}} to {{event}}. {{raised}} Gifts like yours help ${org} provide affordable dental care in our community.

Your acknowledgment letter for your tax records is ready to download:

{{letter_button}}

With gratitude,
${signer}
${title}`;
  return `Dear {{first_name}},

Thank you for your winning bid on {{items}} at {{event}}. Your purchase supports ${org}'s work in our community.

Your receipt is ready to download. It shows the fair market value of what you won and the part of your payment that may be tax-deductible:

{{letter_button}}

With gratitude,
${signer}
${title}`;
}

/** "the Spa day", "the Spa day and the Wine basket", "3 items: A, B and C" */
export function itemList(titles: string[]): string {
  const t = titles.map((x) => x.trim()).filter(Boolean);
  if (t.length === 0) return "your donation";
  if (t.length === 1) return t[0];
  if (t.length === 2) return `${t[0]} and ${t[1]}`;
  return `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
}

export type LetterVars = { first_name: string; items: string; event: string; raised: string };

/** What the donor's gift raised: on its own, or as part of an auction package. */
export function raisedSentence(soldTotal: number, packages: { title: string; sold: number }[] = []): string {
  if (soldTotal > 0) return `Your donation raised ${money(soldTotal)} at the auction. `;
  if (packages.length === 1) return `Your gift was part of \u201c${packages[0].title}\u201d, which raised ${money(packages[0].sold)} at the auction. `;
  if (packages.length > 1) return `Your gifts were part of auction packages that raised ${money(packages.reduce((s, p) => s + p.sold, 0))}. `;
  return "";
}

/** Fills {{…}} placeholders in a subject line (plain text). */
export function fillText(text: string, v: LetterVars): string {
  return text
    .replace(/\{\{\s*(first_name|items|event|raised)\s*\}\}/g, (_m, k: keyof LetterVars) => v[k])
    .replace(/\{\{\s*letter_button\s*\}\}/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Turns the message into email HTML, with the download button where {{letter_button}} is. */
export function messageHtml(text: string, v: LetterVars, url: string, buttonLabel: string): string {
  const button = `<p data-email-button="" style="margin:8px 0 18px;text-align:center"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;background:#1f6f8b;color:#ffffff;font-weight:bold;font-size:16px;padding:12px 28px;border-radius:6px;text-decoration:none;font-family:Arial,Helvetica,sans-serif">${escapeHtml(buttonLabel)}</a></p>`;
  let placed = false;
  const paras = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      if (/^\s*\{\{\s*letter_button\s*\}\}\s*$/.test(p)) {
        placed = true;
        return button;
      }
      const html = escapeHtml(p.trim())
        .replace(/\{\{\s*(first_name|items|event|raised)\s*\}\}/g, (_m, k: keyof LetterVars) => escapeHtml(v[k]))
        .replace(/\{\{\s*letter_button\s*\}\}/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n/g, "<br>");
      return `<p>${html}</p>`;
    });
  if (!placed) paras.push(button);
  return paras.join("");
}
