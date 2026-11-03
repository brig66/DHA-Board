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
};
