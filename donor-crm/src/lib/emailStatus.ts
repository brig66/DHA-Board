import type { EmailLog } from "./types";

export type DeliveryKind = "delivered" | "sent" | "untracked" | "bad";

/** Plain-English delivery result for one email, and whether it is good news. */
export function deliveryOf(m: Pick<EmailLog, "status" | "delivery_status" | "provider_id" | "error" | "delivery_detail">): {
  label: string;
  kind: DeliveryKind;
  detail: string | null;
} {
  if (m.status === "failed") return { label: "Not sent", kind: "bad", detail: m.error };
  switch (m.delivery_status) {
    case "delivered":
      return { label: "Delivered", kind: "delivered", detail: null };
    case "bounced":
      return { label: "Bounced", kind: "bad", detail: m.delivery_detail };
    case "rejected":
      return { label: "Rejected", kind: "bad", detail: m.delivery_detail };
    case "spam":
      return { label: "Marked as spam", kind: "bad", detail: null };
  }
  // emails sent before tracking started have no delivery reports
  if (!m.provider_id) return { label: "Sent", kind: "untracked", detail: null };
  return { label: "Sent, awaiting report", kind: "sent", detail: null };
}

// opens aren't tracked when other people were on the donor's email (To or Cc)
export const isTracked = (m: Pick<EmailLog, "provider_id" | "also_to" | "cc">) =>
  !!m.provider_id && !(m.also_to?.length || m.cc?.length);

/** "Also to a@b · Cc c@d · Bcc e@f", or "" when nobody was copied. */
export const copiedLine = (m: Pick<EmailLog, "also_to" | "cc" | "bcc">) =>
  [
    m.also_to?.length ? `Also to ${m.also_to.join(", ")}` : "",
    m.cc?.length ? `Cc ${m.cc.join(", ")}` : "",
    m.bcc?.length ? `Bcc ${m.bcc.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
export const notDelivered = (m: Parameters<typeof deliveryOf>[0]) => deliveryOf(m).kind === "bad";
