export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "staff";
  is_active: boolean;
  created_at: string;
};

export type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  alt_emails: string[];
  phone: string | null;
  alt_phones: string[];
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  notes: string | null;
  do_not_email: boolean;
  do_not_call: boolean;
  do_not_mail: boolean;
  is_anonymous: boolean;
  organization: string | null;
  is_board_member: boolean;
  is_volunteer: boolean;
  info_date: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactSummary = Contact & {
  total_given: number;
  gift_count: number;
  first_gift_date: string | null;
  last_gift_date: string | null;
  last_gift_amount: number | null;
  last_gift_event: string | null;
  events: string;
  gift_years: number[];
  last_emailed_at: string | null;
  events_attended: string;
  unsubscribed_at: string | null;
  unsubscribe_reason: string | null;
  volunteer_hours: number;
  volunteer_entries: number;
  last_volunteer_date: string | null;
  auction_purchases: number;
  auction_purchases_total: number;
};

export type VolunteerHours = {
  id: string;
  contact_id: string;
  work_date: string;
  hours: number;
  activity: string;
  notes: string | null;
  source: string | null;
  created_at: string;
};

export type Donation = {
  id: string;
  contact_id: string;
  tracking_no: string | null;
  gift_date: string;
  gift_time: string | null;
  amount: number;
  net_amount: number | null;
  event_name: string;
  gift_type: GiftType;
  payment_method: string | null;
  fundraiser_page: string | null;
  recognition_name: string | null;
  dedication: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  /** when, how and by whom the donor was thanked for this gift */
  thanked_on: string | null;
  thanked_method: string | null;
  thanked_by_name: string | null;
  thanked_note: string | null;
};

export const GIFT_TYPES = ["Donation", "Event ticket / registration", "In-kind"] as const;
export type GiftType = (typeof GIFT_TYPES)[number];

export type EventAttendance = {
  id: string;
  contact_id: string;
  event_name: string;
  source: string | null;
  created_at: string;
};

export type EmailLog = {
  id: string;
  contact_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  body_html: string | null;
  template_name: string | null;
  batch_id: string | null;
  provider_id: string | null;
  delivery_status: "sent" | "delivered" | "bounced" | "rejected" | "spam" | null;
  delivery_detail: string | null;
  delivered_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  unsubscribed_at: string | null;
  sent_by_name: string | null;
  status: "sent" | "failed";
  error: string | null;
  sent_at: string;
};

export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  body_html: string | null;
  updated_at: string;
};

export type Settings = {
  id: number;
  sender_name: string;
  sender_email: string;
  reply_to: string | null;
  email_footer: string;
  /** Dollar value of one volunteer hour, set by an admin. Blank shows no dollar values. */
  volunteer_hour_value: number | null;
  /** the CRM address donors can open without signing in (used in letter links) */
  site_url: string | null;
  org_legal_name: string;
  org_display_name: string;
  org_ein: string;
  org_address: string;
  org_city_line: string;
  org_phone: string;
  letter_signer_name: string;
  letter_signer_title: string;
};

export const THANK_METHODS = ["Letter", "Card", "Phone call", "In person", "Email outside the CRM", "Other"] as const;

export type Channel = "email" | "call" | "mail";
export const CHANNEL_LABELS: Record<Channel, string> = { email: "Email", call: "Calls", mail: "Mail" };
export const OPT_OUT_METHODS = ["Phone call", "In person", "Mail", "Email reply", "Other"] as const;

export type PreferenceLog = {
  id: string;
  contact_id: string;
  channel: Channel;
  action: "opt_out" | "opt_in";
  method: string | null;
  note: string | null;
  by_name: string | null;
  created_at: string;
};

export type OutreachNote = {
  id: string;
  contact_id: string;
  note: string;
  by_name: string | null;
  created_at: string;
};

export const SALE_TYPES = ["Silent auction", "Live auction", "Raffle", "Not auctioned"] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export type InkindItem = {
  id: string;
  event_name: string;
  item_number: string | null;
  title: string;
  description: string | null;
  sale_type: SaleType | null;
  is_service: boolean;
  donor_contact_id: string | null;
  fair_market_value: number | null;
  received_date: string | null;
  buyer_contact_id: string | null;
  bidder_number: string | null;
  sold_amount: number | null;
  sold_date: string | null;
  notes: string | null;
  donation_id: string | null;
  source: string | null;
  donor_letter_sent_at: string | null;
  buyer_receipt_sent_at: string | null;
  /** an auction lot made up of several donated items (it has a buyer, not a donor) */
  is_package: boolean;
  /** the package this donated item was sold in */
  package_id: string | null;
  procurement_status: string | null;
  created_at: string;
  updated_at: string;
};

export type LetterKind = "inkind_ack" | "buyer_receipt";

/** What a letter said when it was made (kept so it never changes later). */
export type LetterSnapshot = {
  kind: LetterKind;
  letter_date: string;
  org: {
    legal_name: string;
    display_name: string;
    ein: string;
    address: string;
    city_line: string;
    phone: string;
    signer_name: string;
    signer_title: string;
  };
  recipient: {
    first_name: string;
    last_name: string;
    organization: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  items: {
    title: string;
    description: string | null;
    item_number: string | null;
    event_name: string;
    is_service: boolean;
    sale_type: string | null;
    received_date: string | null;
    fair_market_value: number | null;
    sold_amount: number | null;
    deductible: number;
  }[];
};
