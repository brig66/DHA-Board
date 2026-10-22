// Public endpoint for things that happen after an email leaves the CRM:
//   GET  ?a=open&id=…      the invisible picture that records an open
//   GET  ?a=info&id=…      what the unsubscribe page shows ("you@… will be removed")
//   POST ?a=unsub&id=…     unsubscribe (from the CRM's page or the email program's
//                          own "Unsubscribe" button)
//   POST ?a=webhook&key=…  delivery reports from SMTP2GO (delivered, bounced, spam…)
// The id is the email's own random record number, so it can't be guessed.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// 1×1 transparent GIF
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const pixel = () =>
  new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });

const isId = (s: string | null) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function recordOpen(id: string) {
  const { data: log } = await admin.from("email_log").select("id, open_count, first_opened_at").eq("id", id).maybeSingle();
  if (!log) return;
  const now = new Date().toISOString();
  await admin
    .from("email_log")
    .update({ open_count: (log.open_count ?? 0) + 1, first_opened_at: log.first_opened_at ?? now, last_opened_at: now })
    .eq("id", id);
}

/** Marks the donor do-not-email and flags them for staff to review. */
async function unsubscribe(logId: string, reason: string) {
  const { data: log } = await admin.from("email_log").select("id, contact_id, unsubscribed_at").eq("id", logId).maybeSingle();
  if (!log) return { ok: false, error: "We couldn't find that email." };
  const now = new Date().toISOString();
  if (!log.unsubscribed_at) await admin.from("email_log").update({ unsubscribed_at: now }).eq("id", logId);
  if (!log.contact_id) return { ok: true };
  const { data: c } = await admin
    .from("contacts")
    .select("id, do_not_email, unsubscribed_at")
    .eq("id", log.contact_id)
    .maybeSingle();
  if (!c) return { ok: true };
  if (c.do_not_email && c.unsubscribed_at) return { ok: true, already: true };
  await admin
    .from("contacts")
    .update({
      do_not_email: true,
      unsubscribed_at: now,
      unsubscribe_reason: reason,
      unsubscribe_reviewed_at: null,
      updated_at: now,
    })
    .eq("id", c.id);
  return { ok: true };
}

const mask = (email: string | null) => {
  if (!email) return "";
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}`;
};

// deno-lint-ignore no-explicit-any
async function handleEvent(e: any) {
  const event = String(e.event ?? e.type ?? "").toLowerCase();
  const providerId = String(e.email_id ?? e.emailId ?? e["email-id"] ?? "");
  if (!event || !providerId) return;

  let { data: log } = await admin
    .from("email_log")
    .select("id, delivery_status")
    .eq("provider_id", providerId)
    .maybeSingle();
  if (!log) {
    // the report can arrive a moment before the send is written down
    await new Promise((r) => setTimeout(r, 2500));
    ({ data: log } = await admin.from("email_log").select("id, delivery_status").eq("provider_id", providerId).maybeSingle());
  }
  if (!log) return;

  const when = e.time ? new Date(e.time).toISOString() : new Date().toISOString();
  const detail = [e.bounce ? `${e.bounce} bounce` : "", e.context ?? e.message ?? e.reason ?? e.response ?? ""]
    .map((x: unknown) => String(x).trim())
    .filter(Boolean)
    .join(": ")
    .slice(0, 500);
  const final = ["bounced", "spam", "rejected"].includes(log.delivery_status ?? "");

  if (event === "delivered") {
    if (!final) await admin.from("email_log").update({ delivery_status: "delivered", delivered_at: when }).eq("id", log.id);
  } else if (event === "bounce" || event === "bounced" || event === "hard_bounce" || event === "soft_bounce") {
    await admin.from("email_log").update({ delivery_status: "bounced", delivery_detail: detail || null }).eq("id", log.id);
  } else if (event === "reject" || event === "rejected") {
    await admin.from("email_log").update({ delivery_status: "rejected", delivery_detail: detail || null }).eq("id", log.id);
  } else if (event === "spam" || event === "spam_complaint" || event === "complaint") {
    await admin.from("email_log").update({ delivery_status: "spam" }).eq("id", log.id);
    await unsubscribe(log.id, "Marked the email as spam");
  } else if (event === "unsubscribe" || event === "unsubscribed") {
    await unsubscribe(log.id, "Unsubscribed through the email service");
  } else if (event === "open" || event === "opened") {
    await recordOpen(log.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const id = url.searchParams.get("id");

  try {
    if (a === "open") {
      if (isId(id)) await recordOpen(id!).catch(() => {});
      return pixel();
    }

    if (a === "info") {
      if (!isId(id)) return json({ ok: false, error: "This link is not complete." }, 400);
      const { data: log } = await admin.from("email_log").select("to_email, unsubscribed_at, contact_id").eq("id", id!).maybeSingle();
      if (!log) return json({ ok: false, error: "We couldn't find that email." }, 404);
      let unsubscribed = !!log.unsubscribed_at;
      if (log.contact_id) {
        const { data: c } = await admin.from("contacts").select("do_not_email").eq("id", log.contact_id).maybeSingle();
        unsubscribed = unsubscribed || !!c?.do_not_email;
      }
      return json({ ok: true, email: mask(log.to_email), unsubscribed });
    }

    if (a === "unsub" && req.method === "POST") {
      if (!isId(id)) return json({ ok: false, error: "This link is not complete." }, 400);
      // the email program's own one-click button sends "List-Unsubscribe=One-Click"
      const body = await req.text().catch(() => "");
      const reason = /List-Unsubscribe=One-Click/i.test(body)
        ? "Used the unsubscribe button in their email program"
        : "Clicked unsubscribe in the email";
      return json(await unsubscribe(id!, reason));
    }

    if (a === "webhook" && req.method === "POST") {
      const { data: secret } = await admin.rpc("get_secret", { secret_name: "email_webhook_secret" });
      if (!secret || url.searchParams.get("key") !== secret) return json({ ok: false }, 401);
      const type = req.headers.get("content-type") ?? "";
      // deno-lint-ignore no-explicit-any
      let events: any[] = [];
      if (type.includes("json")) {
        const body = await req.json();
        events = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
      } else {
        const form = await req.formData();
        events = [Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]))];
      }
      for (const e of events) await handleEvent(e).catch((err) => console.error("event failed", err));
      return json({ ok: true });
    }
  } catch (e) {
    console.error(e);
    return a === "open" ? pixel() : json({ ok: false, error: "Something went wrong." }, 500);
  }

  return json({ ok: false, error: "Unknown request" }, 400);
});
