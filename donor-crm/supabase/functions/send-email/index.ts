// Sends donor emails through SMTP2GO and logs every message on the donor's
// record. Runs on Supabase's servers so the email API key is never exposed
// to the browser. Only signed-in, activated DHA staff can call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  contact_ids: string[];
  subject: string;
  body: string;
  template_name?: string | null;
  test_to?: string | null; // send one preview to this address instead of donors
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? ""
    : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDate = (d: string | null) =>
  d
    ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

// deno-lint-ignore no-explicit-any
function fill(text: string, c: any): string {
  const values: Record<string, string> = {
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
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in values ? values[k] : m));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toHtml(text: string, footer: string): string {
  const paras = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#22201b;max-width:600px">${paras}<hr style="border:none;border-top:1px solid #e0dccd;margin:24px 0 12px"><p style="font-size:12px;color:#77736a;margin:0">${escapeHtml(footer)}</p></div>`;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // who is sending?
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: "Please sign in again." }, 401);
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, email, is_active")
    .eq("id", user.id)
    .single();
  if (!profile?.is_active) return json({ error: "Your account is not active." }, 403);

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const subject = (payload.subject || "").trim();
  const bodyText = (payload.body || "").trim();
  if (!subject || !bodyText) return json({ error: "Subject and message are both required." }, 400);
  const ids = Array.isArray(payload.contact_ids) ? payload.contact_ids.slice(0, 500) : [];
  if (!ids.length) return json({ error: "Pick at least one donor." }, 400);

  const { data: apiKey } = await admin.rpc("get_secret", { secret_name: "smtp2go_api_key" });
  if (!apiKey) return json({ error: "The email service key has not been set up yet." }, 500);
  const { data: settings } = await admin.from("settings").select("*").eq("id", 1).single();
  const senderName = settings?.sender_name || "Dental Health Arlington";
  const senderEmail = settings?.sender_email || "info@dentalhealtharlington.org";
  const replyTo = settings?.reply_to || profile.email;
  const footer = settings?.email_footer || "";

  const { data: contacts, error } = await admin.from("contact_summary").select("*").in("id", ids);
  if (error) return json({ error: error.message }, 500);

  const results: { contact_id: string; name: string; email: string | null; status: string; error?: string }[] = [];
  const isTest = !!payload.test_to;
  const targets = isTest ? (contacts || []).slice(0, 1) : contacts || [];

  for (const c of targets) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
    const to = isTest ? payload.test_to! : c.email;
    if (!isTest && (c.is_anonymous || c.do_not_email || !c.email)) {
      results.push({
        contact_id: c.id,
        name,
        email: c.email,
        status: "skipped",
        error: c.do_not_email ? "Marked do-not-email" : "No email address",
      });
      continue;
    }
    const subj = (isTest ? "[TEST] " : "") + fill(subject, c);
    const text = fill(bodyText, c);

    let status = "sent";
    let errMsg: string | undefined;
    try {
      const res = await fetch("https://api.smtp2go.com/v3/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey },
        body: JSON.stringify({
          api_key: apiKey,
          sender: `${senderName} <${senderEmail}>`,
          to: [isTest ? to : `${name} <${to}>`],
          subject: subj,
          text_body: footer ? `${text}\n\n--\n${footer}` : text,
          html_body: toHtml(text, footer),
          custom_headers: replyTo ? [{ header: "Reply-To", value: replyTo }] : [],
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out?.data?.succeeded) {
        status = "failed";
        errMsg =
          out?.data?.error ||
          out?.data?.failures?.[0] ||
          out?.data?.field_validation_errors?.message ||
          `Email service returned ${res.status}`;
      }
    } catch (e) {
      status = "failed";
      errMsg = String(e);
    }

    if (!isTest) {
      await admin.from("email_log").insert({
        contact_id: c.id,
        to_email: to,
        subject: subj,
        body: text,
        template_name: payload.template_name || null,
        sent_by: user.id,
        sent_by_name: profile.full_name,
        status,
        error: errMsg || null,
      });
    }
    results.push({ contact_id: c.id, name, email: to, status, error: errMsg });
  }

  return json({
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  });
});
