"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// The donor-facing page behind the "Unsubscribe" link in every email.
// It asks before unsubscribing, so email security scanners that open links
// automatically can't unsubscribe anyone by accident.

const ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/email-events`;
const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" };

export default function UnsubscribePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Unsubscribe />
        </Suspense>
      </div>
    </main>
  );
}

function Unsubscribe() {
  const id = useSearchParams().get("id") ?? "";
  const [state, setState] = useState<"loading" | "ask" | "working" | "done" | "already" | "test" | "error">("loading");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (id === "test") return setState("test");
    fetch(`${ENDPOINT}?a=info&id=${encodeURIComponent(id)}`, { headers })
      .then((r) => r.json())
      .then((r) => {
        if (!r.ok) throw new Error(r.error || "This link didn't work.");
        setEmail(r.email);
        setState(r.unsubscribed ? "already" : "ask");
      })
      .catch((e) => {
        setError(e.message || "This link didn't work.");
        setState("error");
      });
  }, [id]);

  async function confirm() {
    setState("working");
    try {
      const r = await fetch(`${ENDPOINT}?a=unsub&id=${encodeURIComponent(id)}`, { method: "POST", headers }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Something went wrong.");
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  const title = "font-display text-xl font-semibold text-ink";
  switch (state) {
    case "loading":
      return <p className="muted">Loading…</p>;
    case "test":
      return (
        <>
          <h1 className={title}>This was a test email</h1>
          <p className="muted mt-2 text-sm">Unsubscribe links work in the emails donors receive. Nothing was changed.</p>
        </>
      );
    case "ask":
    case "working":
      return (
        <>
          <h1 className={title}>Unsubscribe from Dental Health Arlington emails?</h1>
          <p className="muted mt-2 text-sm">
            We&rsquo;ll stop sending emails to <strong>{email}</strong>.
          </p>
          <button className="btn btn-primary mt-6 w-full" onClick={confirm} disabled={state === "working"}>
            {state === "working" ? "One moment…" : "Yes, unsubscribe me"}
          </button>
          <p className="muted mt-4 text-xs">Changed your mind? Just close this page.</p>
        </>
      );
    case "done":
      return (
        <>
          <h1 className={title}>You&rsquo;re unsubscribed</h1>
          <p className="muted mt-2 text-sm">
            You won&rsquo;t receive any more emails from Dental Health Arlington. Thank you for your support of brighter,
            healthier smiles for children in our community.
          </p>
        </>
      );
    case "already":
      return (
        <>
          <h1 className={title}>You&rsquo;re already unsubscribed</h1>
          <p className="muted mt-2 text-sm">
            <strong>{email}</strong> won&rsquo;t receive any more emails from Dental Health Arlington.
          </p>
        </>
      );
    default:
      return (
        <>
          <h1 className={title}>Sorry, that didn&rsquo;t work</h1>
          <p className="muted mt-2 text-sm">{error}</p>
          <p className="muted mt-2 text-sm">
            You can also reply to the email and ask to be removed, and we&rsquo;ll take care of it.
          </p>
        </>
      );
  }
}
