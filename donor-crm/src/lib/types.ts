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
  payment_method: string | null;
  fundraiser_page: string | null;
  recognition_name: string | null;
  dedication: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
};

export type EmailLog = {
  id: string;
  contact_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  template_name: string | null;
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
  updated_at: string;
};

export type Settings = {
  id: number;
  sender_name: string;
  sender_email: string;
  reply_to: string | null;
  email_footer: string;
};
