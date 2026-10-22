// Shared by the Email page preview (Next.js) and the send-email function
// (Deno), so the preview shows exactly what donors receive. No imports, so it
// runs in both places.

// deno-lint-ignore no-explicit-any
type Donor = any;

const money = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === ""
    ? ""
    : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDate = (d: string | null | undefined) =>
  d
    ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

export function mergeValues(c: Donor): Record<string, string> {
  return {
    first_name: c.first_name || "Friend",
    last_name: c.last_name || "",
    full_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Friend",
    email: c.email || "",
    last_gift_amount: money(c.last_gift_amount),
    last_gift_date: longDate(c.last_gift_date),
    last_gift_event: c.last_gift_event || "",
    total_given: money(c.total_given),
    gift_count: String(c.gift_count ?? ""),
    first_gift_year: c.first_gift_date ? String(c.first_gift_date).slice(0, 4) : "",
  };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Replaces {{first_name}} and friends. In HTML, the donor's details are escaped. */
export function fillMerge(text: string, c: Donor | undefined, html = false): string {
  if (!c) return text;
  const values = mergeValues(c);
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) =>
    k in values ? (html ? escapeHtml(values[k]) : values[k]) : m
  );
}

/** Older plain-text messages and templates, turned into paragraphs. */
export function textToHtml(text: string): string {
  return escapeHtml(text.trim())
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Removes anything that has no place in an email (scripts, forms, event handlers). */
export function cleanHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|form|button|select|textarea|title|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|select|textarea|meta|link|base|html|head|body|title)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript):[^"']*\2/gi, '$1="#"');
}

const FONT = "Arial,Helvetica,sans-serif";
const LINK = "#1f6f8b";

function addStyle(tag: string, style: string): string {
  // keep any style the editor already set (alignment, color) and add ours first
  if (/\sstyle\s*=\s*"/i.test(tag)) return tag.replace(/\sstyle\s*=\s*"/i, ` style="${style};`);
  return tag.replace(/^<([a-z0-9]+)/i, `<$1 style="${style}"`);
}

/** Inline styles, because many email programs ignore style sheets. */
export function styleForEmail(html: string): string {
  return html
    .replace(/<p\b[^>]*>/gi, (t) => (/data-email-button/i.test(t) ? t : addStyle(t, "margin:0 0 14px")))
    .replace(/<h1\b[^>]*>/gi, (t) => addStyle(t, "margin:0 0 14px;font-size:26px;line-height:1.25"))
    .replace(/<h2\b[^>]*>/gi, (t) => addStyle(t, "margin:0 0 12px;font-size:21px;line-height:1.3"))
    .replace(/<h3\b[^>]*>/gi, (t) => addStyle(t, "margin:0 0 10px;font-size:18px;line-height:1.3"))
    .replace(/<(ul|ol)\b[^>]*>/gi, (t) => addStyle(t, "margin:0 0 14px;padding-left:24px"))
    .replace(/<li\b[^>]*>/gi, (t) => addStyle(t, "margin:0 0 4px"))
    .replace(/<li([^>]*)>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, "<li$1>$2</li>")
    .replace(/<hr\b[^>]*>/gi, '<hr style="border:none;border-top:1px solid #dcd8cc;margin:20px 0">')
    .replace(/<a\b[^>]*>/gi, (t) => (/\sstyle\s*=/i.test(t) ? t : addStyle(t, `color:${LINK};text-decoration:underline`)))
    .replace(/<img\b[^>]*>/gi, (t) => {
      const w = Number((t.match(/\swidth\s*=\s*"?(\d+)/i) || [])[1]) || 0;
      let out = addStyle(t, `display:block;margin:0 auto 14px;max-width:100%;height:auto;border:0${w ? `;width:${w}px` : ""}`);
      if (!/\salt\s*=/i.test(out)) out = out.replace(/^<img/i, '<img alt=""');
      return out;
    });
}

/** The full email: centered 600px card on a light background, with the footer. */
export function buildEmailHtml(contentHtml: string, footer: string): string {
  const footerHtml = footer
    ? `<tr><td style="padding:16px 24px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#77736a;text-align:center">${escapeHtml(footer).replace(/\n/g, "<br>")}</td></tr>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title></title></head>
<body style="margin:0;padding:0;background:#f2f1ec">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f1ec"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="background:#ffffff;padding:24px;font-family:${FONT};font-size:16px;line-height:1.5;color:#22201b;border-radius:6px">${styleForEmail(cleanHtml(contentHtml))}</td></tr>
${footerHtml}
</table></td></tr></table></body></html>`;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Plain-text copy sent alongside the formatted email (and kept on the donor's history). */
export function htmlToText(html: string): string {
  return decode(
    cleanHtml(html)
      .replace(/<img\b[^>]*>/gi, (t) => {
        const alt = (t.match(/\salt\s*=\s*"([^"]*)"/i) || [])[1];
        return alt ? `[${alt}]\n` : "";
      })
      .replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
        const label = inner.replace(/<[^>]+>/g, "").trim();
        if (!label) return href === "#" ? "" : `${href}\n`;
        if (label === href || href === "#") return label;
        return `${label} (${href})`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|h[1-6]|div|ul|ol|table|tr)>/gi, "\n\n")
      .replace(/<hr\b[^>]*>/gi, "\n----------\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the message has something in it besides empty paragraphs. */
export function hasContent(html: string): boolean {
  return /<img\b/i.test(html) || htmlToText(html).length > 0;
}
