// Sends donor emails through SMTP2GO and logs every message on the donor's
// record. Runs on Supabase's servers so the email API key is never exposed
// to the browser. Only signed-in, activated DHA staff can call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildEmailHtml, cleanHtml, fillMerge, hasContent, htmlToText, textToHtml } from "../_shared/email-html.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  contact_ids: string[];
  subject: string;
  body: string;
  body_html?: string | null; // formatted message from the editor
  template_name?: string | null;
  batch_id?: string | null; // one id for every donor in the same mailing
  test_to?: string | null; // send one preview to this address instead of donors
};

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
  // formatted messages come from the editor; older callers send plain text
  const bodyHtml = cleanHtml((payload.body_html || "").trim() || textToHtml(payload.body || ""));
  if (!subject || !hasContent(bodyHtml)) return json({ error: "Subject and message are both required." }, 400);
  const ids = Array.isArray(payload.contact_ids) ? payload.contact_ids.slice(0, 500) : [];
  if (!ids.length) return json({ error: "Pick at least one donor." }, 400);

  const { data: apiKey } = await admin.rpc("get_secret", { secret_name: "smtp2go_api_key" });
  if (!apiKey) return json({ error: "The email service key has not been set up yet." }, 500);
  const { data: settings } = await admin.from("settings").select("*").eq("id", 1).single();
  const senderName = settings?.sender_name || "Dental Health Arlington";
  const senderEmail = settings?.sender_email || "info@dentalhealtharlington.org";
  const replyTo = settings?.reply_to || profile.email;
  const footer = settings?.email_footer || "";
  // links in the email point back to the CRM site that sent it
  const site = (req.headers.get("origin") || settings?.site_url || "").replace(/\/$/, "");
  const fnBase = `${url}/functions/v1/email-events`;
  const batchId = payload.batch_id && /^[0-9a-f-]{36}$/i.test(payload.batch_id) ? payload.batch_id : crypto.randomUUID();

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
    const subj = (isTest ? "[TEST] " : "") + fillMerge(subject, c);
    const content = fillMerge(bodyHtml, c, true);
    const text = htmlToText(content);
    // each email gets its own record number, used for its open and unsubscribe links
    const logId = crypto.randomUUID();
    const unsubscribeUrl = site ? `${site}/unsubscribe?id=${isTest ? "test" : logId}` : "";
    const oneClickUrl = `${fnBase}?a=unsub&id=${logId}`;
    const headers = [
      ...(replyTo ? [{ header: "Reply-To", value: replyTo }] : []),
      ...(isTest
        ? []
        : [
            { header: "List-Unsubscribe", value: `<${oneClickUrl}>` },
            { header: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
          ]),
    ];
    let providerId: string | null = null;

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
          text_body: [text, [footer, unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ""].filter(Boolean).join("\n")]
            .filter(Boolean)
            .join("\n\n--\n"),
          html_body: buildEmailHtml(content, footer, {
            unsubscribeUrl,
            openPixelUrl: isTest ? undefined : `${fnBase}?a=open&id=${logId}`,
          }),
          custom_headers: headers,
        }),
      });
      const out = await res.json().catch(() => ({}));
      providerId = out?.data?.email_id ?? null;
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
        id: logId,
        batch_id: batchId,
        provider_id: providerId,
        delivery_status: status === "sent" ? "sent" : null,
        contact_id: c.id,
        to_email: to,
        subject: subj,
        body: text,
        body_html: content,
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
