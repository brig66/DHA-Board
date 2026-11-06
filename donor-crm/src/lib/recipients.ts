// Extra people copied on an outgoing email: more "To" recipients, Cc and Bcc.
// The send-email function checks the same rules again on the server.

export type Copies = { also_to: string; cc: string; bcc: string };
export const NO_COPIES: Copies = { also_to: "", cc: "", bcc: "" };
export const MAX_COPIES = 10;

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

/** "Jo Smith <jo@x.org>, ann@y.com; bob@z.net" -> ["jo@x.org", "ann@y.com", "bob@z.net"] */
export function splitAddresses(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .flatMap((piece) => {
      const inBrackets = piece.match(/<([^>]+)>/);
      return inBrackets ? [inBrackets[1]] : piece.split(/\s+/);
    })
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
}

export type CheckedCopies = {
  also_to: string[];
  cc: string[];
  bcc: string[];
  bad: string[];
  total: number;
  any: boolean;
};

/** Each address once, in the most visible place it was typed (To, then Cc, then Bcc). */
export function checkCopies(c: Copies): CheckedCopies {
  const parts = { also_to: splitAddresses(c.also_to), cc: splitAddresses(c.cc), bcc: splitAddresses(c.bcc) };
  const bad = Array.from(new Set([...parts.also_to, ...parts.cc, ...parts.bcc].filter((a) => !EMAIL.test(a))));
  const good = (xs: string[]) => Array.from(new Set(xs.filter((a) => EMAIL.test(a))));
  const also_to = good(parts.also_to);
  const cc = good(parts.cc).filter((a) => !also_to.includes(a));
  const bcc = good(parts.bcc).filter((a) => !also_to.includes(a) && !cc.includes(a));
  const total = also_to.length + cc.length + bcc.length;
  return { also_to, cc, bcc, bad, total, any: total > 0 };
}

/** What the send-email function expects (empty lists left out). */
export function copiesPayload(c: CheckedCopies): { also_to?: string[]; cc?: string[]; bcc?: string[] } {
  return {
    ...(c.also_to.length ? { also_to: c.also_to } : {}),
    ...(c.cc.length ? { cc: c.cc } : {}),
    ...(c.bcc.length ? { bcc: c.bcc } : {}),
  };
}

/** One line for confirmations: "Copying: also to a@b; Cc c@d; Bcc e@f." */
export function describeCopies(c: CheckedCopies): string {
  const bits = [
    c.also_to.length ? `also to ${c.also_to.join(", ")}` : "",
    c.cc.length ? `Cc ${c.cc.join(", ")}` : "",
    c.bcc.length ? `Bcc ${c.bcc.join(", ")}` : "",
  ].filter(Boolean);
  return bits.length ? `Copying: ${bits.join("; ")}.` : "";
}
