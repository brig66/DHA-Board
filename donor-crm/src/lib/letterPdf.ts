// Builds the PDF for thank-you acknowledgments (in-kind donors) and receipts
// (auction buyers) from the copy of each letter saved when it was created.
// Runs on the server when someone opens a letter link.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { DHA_LOGO_JPEG_BASE64, DHA_LOGO_SIZE } from "./dhaLogo";
import type { LetterSnapshot } from "./types";

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN_X = 64;
const TOP = 56;
const BOTTOM = 78; // room for the footer
const NAVY = rgb(0.11, 0.15, 0.42);
const SOFT = rgb(0.63, 0.69, 0.89);
const INK = rgb(0.13, 0.12, 0.1);
const GRAY = rgb(0.38, 0.37, 0.33);
const BODY = 11.5;
const LEADING = 15.5;

// Characters the built-in PDF fonts can print (Windows-1252)
const EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function printable(s: string | null | undefined): string {
  return Array.from(String(s ?? "").replace(/\s+/g, " "))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRAS.includes(ch)) return ch;
      const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      if (plain && Array.from(plain).every((p) => p.codePointAt(0)! >= 0x20 && p.codePointAt(0)! <= 0x7e)) return plain;
      return "";
    })
    .join("")
    .trim();
}

const money = (n: number | null | undefined) =>
  "$" + Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDate = (d: string | null | undefined) =>
  d
    ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

const longDate = (d: string | null | undefined) =>
  d
    ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of printable(text).split("\n")) {
    const words = para.split(" ").filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // a single word longer than the line (a long web address) is split
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

type Fonts = { serif: PDFFont; serifBold: PDFFont; sans: PDFFont; sansBold: PDFFont };

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private f: Fonts,
    private logo: PDFImage,
    private s: LetterSnapshot
  ) {}

  get contentWidth() {
    return PAGE_W - MARGIN_X * 2;
  }

  newPage(first: boolean) {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.footer();
    if (first) this.letterhead();
    else {
      this.y = PAGE_H - TOP;
      this.text(`${printable(this.s.org.legal_name)} (continued)`, { font: this.f.sans, size: 9, color: GRAY });
      this.y -= 10;
    }
  }

  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage(false);
  }

  letterhead() {
    const o = this.s.org;
    const logoW = 84;
    const logoH = (logoW * DHA_LOGO_SIZE.height) / DHA_LOGO_SIZE.width;
    const top = PAGE_H - TOP;
    this.page.drawImage(this.logo, { x: MARGIN_X, y: top - logoH, width: logoW, height: logoH });
    const right = PAGE_W - MARGIN_X;
    const lines: [string, PDFFont, number, ReturnType<typeof rgb>][] = [
      [o.legal_name, this.f.sansBold, 11, NAVY],
      [o.address, this.f.sans, 9.5, INK],
      [o.city_line, this.f.sans, 9.5, INK],
      [o.phone, this.f.sans, 9.5, INK],
      [`Federal tax ID (EIN) ${o.ein}`, this.f.sans, 9, GRAY],
    ];
    let y = top - 12;
    for (const [t, font, size, color] of lines) {
      const s = printable(t);
      if (!s) continue;
      this.page.drawText(s, { x: right - font.widthOfTextAtSize(s, size), y, size, font, color });
      y -= size + 4;
    }
    const ruleY = Math.min(top - logoH, y) - 12;
    this.page.drawRectangle({ x: MARGIN_X, y: ruleY, width: this.contentWidth, height: 1.6, color: NAVY });
    this.page.drawRectangle({ x: MARGIN_X, y: ruleY - 3, width: this.contentWidth, height: 0.8, color: SOFT });
    this.y = ruleY - 24;
  }

  footer() {
    const o = this.s.org;
    const line1 = printable(`${o.legal_name}  ·  ${o.address}, ${o.city_line}  ·  ${o.phone}`);
    const line2 = "A 501(c)(3) nonprofit organization. Please keep this letter for your tax records.";
    const size = 8;
    for (const [i, t] of [line1, line2].entries()) {
      const w = this.f.sans.widthOfTextAtSize(t, size);
      this.page.drawText(t, { x: (PAGE_W - w) / 2, y: 44 - i * 11, size, font: this.f.sans, color: GRAY });
    }
  }

  text(t: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const font = opts.font ?? this.f.serif;
    const size = opts.size ?? BODY;
    const lead = size === BODY ? LEADING : size * 1.35;
    for (const line of wrap(t, font, size, this.contentWidth)) {
      this.ensure(lead);
      this.page.drawText(line, { x: MARGIN_X, y: this.y, size, font, color: opts.color ?? INK });
      this.y -= lead;
    }
    this.y -= opts.gap ?? 0;
  }

  paragraph(t: string) {
    this.text(t, { gap: 6 });
  }

  /** A simple ruled table; cells wrap, and long tables continue on the next page. */
  table(headers: string[], widths: number[], rows: string[][], align: ("left" | "right")[], boldLast = false) {
    const size = 9.5;
    const pad = 5;
    const total = widths.reduce((a, b) => a + b, 0);
    const cols = widths.map((w) => (w / total) * this.contentWidth);
    const drawRow = (cells: string[], header: boolean, bold: boolean) => {
      const font = header || bold ? this.f.sansBold : this.f.sans;
      const wrapped = cells.map((c, i) => wrap(c, font, size, cols[i] - pad * 2));
      const h = Math.max(...wrapped.map((w) => w.length)) * (size + 3) + pad * 2;
      this.ensure(h + 2);
      if (header) this.page.drawRectangle({ x: MARGIN_X, y: this.y - h + size, width: this.contentWidth, height: h, color: rgb(0.94, 0.95, 0.99) });
      let x = MARGIN_X;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, j) => {
          const w = font.widthOfTextAtSize(line, size);
          const tx = align[i] === "right" ? x + cols[i] - pad - w : x + pad;
          this.page.drawText(line, { x: tx, y: this.y - pad + 2 - j * (size + 3), size, font, color: header ? NAVY : INK });
        });
        x += cols[i];
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN_X, y: this.y + size - 1 },
        end: { x: MARGIN_X + this.contentWidth, y: this.y + size - 1 },
        thickness: header ? 0.9 : 0.4,
        color: header ? NAVY : rgb(0.82, 0.81, 0.76),
      });
    };
    drawRow(headers, true, false);
    rows.forEach((r, i) => drawRow(r, false, boldLast && i === rows.length - 1));
    this.y -= 12;
  }

  signature() {
    const o = this.s.org;
    this.ensure(LEADING * 4 + 18);
    this.text("With gratitude,", { gap: 18 });
    this.text(o.signer_name, { font: this.f.serifBold });
    this.text(o.signer_title);
    this.text(o.legal_name);
  }
}

function recipientLines(s: LetterSnapshot): string[] {
  const r = s.recipient;
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
  const lines = [name];
  if (r.organization && r.organization !== name && r.organization !== r.last_name) lines.push(r.organization);
  if (r.address) lines.push(r.address);
  const cityLine = [r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  return lines.filter(Boolean);
}

function greetingName(s: LetterSnapshot): string {
  const r = s.recipient;
  return printable(r.first_name || r.organization || r.last_name || "Friend");
}

function eventPhrase(s: LetterSnapshot): string {
  const events = Array.from(new Set(s.items.map((i) => i.event_name).filter((e) => e && e !== "In-kind donation")));
  return events.length === 1 ? events[0] : "";
}

function writeAcknowledgment(w: Writer, s: LetterSnapshot) {
  const o = s.org;
  const many = s.items.length > 1;
  const ev = eventPhrase(s);
  const anyGoods = s.items.some((i) => !i.is_service);
  const anyService = s.items.some((i) => i.is_service);

  w.paragraph(`Dear ${greetingName(s)},`);
  w.paragraph(
    `Thank you for your generous in-kind donation to ${o.display_name}${ev ? ` for ${ev}` : ""}. Your generosity helps ${o.display_name} provide affordable dental care in our community.`
  );
  w.paragraph(`This letter is your written acknowledgment that ${o.legal_name} received the following ${many ? "donations" : "donation"}:`);
  w.table(
    ["Donation", "Description", "Received"],
    [3, 4.3, 1.3],
    s.items.map((i) => [
      `${i.item_number ? `#${i.item_number} ` : ""}${i.title}${i.is_service ? " (service)" : ""}`,
      i.description ?? "",
      shortDate(i.received_date),
    ]),
    ["left", "left", "left"]
  );
  w.paragraph("No goods or services were provided to you in exchange for this donation.");
  if (anyGoods)
    w.paragraph(
      `${o.legal_name} does not assign a value to donated items. Please keep this letter with your tax records; your tax advisor can help you determine the amount you may deduct.`
    );
  if (anyService)
    w.paragraph(
      `Under IRS rules, the value of donated services is not tax-deductible. We are no less grateful for your time and talent${anyGoods ? " on the services listed above" : ""}.`
    );
  w.paragraph(
    `${o.legal_name} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our federal tax identification number (EIN) is ${o.ein}.`
  );
  w.signature();
}

function writeReceipt(w: Writer, s: LetterSnapshot) {
  const o = s.org;
  const many = s.items.length > 1;
  const ev = eventPhrase(s);
  const paid = s.items.reduce((a, i) => a + Number(i.sold_amount ?? 0), 0);
  const value = s.items.reduce((a, i) => a + Number(i.fair_market_value ?? 0), 0);
  const deductible = s.items.reduce((a, i) => a + Number(i.deductible ?? 0), 0);

  w.paragraph(`Dear ${greetingName(s)},`);
  w.paragraph(
    `Thank you for supporting ${o.display_name}${ev ? ` at ${ev}` : ""}. This is your receipt for the ${many ? "items" : "item"} you purchased.`
  );
  const rows = s.items.map((i) => [
    `${i.item_number ? `#${i.item_number} ` : ""}${i.title}`,
    money(i.sold_amount),
    money(i.fair_market_value),
    money(i.deductible),
  ]);
  if (many) rows.push(["Total", money(paid), money(value), money(deductible)]);
  w.table(["Item", "Amount paid", "Fair market value", "May be deductible"], [3.6, 1.3, 1.5, 1.5], rows, ["left", "right", "right", "right"], many);
  w.paragraph(
    `Under federal tax law, the part of your payment that may be deductible as a charitable contribution is limited to the amount by which your payment exceeds the fair market value of what you received. The fair market values above are ${o.legal_name}'s good-faith estimates.`
  );
  if (deductible <= 0)
    w.paragraph(
      `Because the amount you paid did not exceed the fair market value of what you received, no part of this payment is deductible as a charitable contribution.`
    );
  w.paragraph(
    `${o.legal_name} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our federal tax identification number (EIN) is ${o.ein}.`
  );
  w.signature();
}

export async function buildLettersPdf(letters: LetterSnapshot[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(letters.length === 1 && letters[0].kind === "buyer_receipt" ? "Auction receipt" : "Donation acknowledgment");
  doc.setAuthor(printable(letters[0]?.org.legal_name ?? "Dental Health For Arlington, Inc."));
  const fonts: Fonts = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await doc.embedJpg(Buffer.from(DHA_LOGO_JPEG_BASE64, "base64"));

  for (const s of letters) {
    const w = new Writer(doc, fonts, logo, s);
    w.newPage(true);
    w.text(longDate(s.letter_date), { gap: 10 });
    for (const line of recipientLines(s)) w.text(line);
    w.y -= 12;
    if (s.kind === "buyer_receipt") writeReceipt(w, s);
    else writeAcknowledgment(w, s);
  }
  return doc.save();
}

/** "DHA letter - Jane Smith.pdf" */
export function letterFileName(letters: LetterSnapshot[]): string {
  if (letters.length !== 1) return "DHA letters.pdf";
  const r = letters[0].recipient;
  const who = printable([r.first_name, r.last_name].filter(Boolean).join(" ") || r.organization || "donor").replace(/[^A-Za-z0-9 .'-]/g, "");
  return `DHA ${letters[0].kind === "buyer_receipt" ? "receipt" : "letter"} - ${who}.pdf`;
}
