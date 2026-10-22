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

export const isTracked = (m: Pick<EmailLog, "provider_id">) => !!m.provider_id;
export const notDelivered = (m: Parameters<typeof deliveryOf>[0]) => deliveryOf(m).kind === "bad";
