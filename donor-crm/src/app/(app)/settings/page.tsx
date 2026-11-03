"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { shortDate } from "@/lib/format";
import type { Profile, Settings } from "@/lib/types";

export default function SettingsPage() {
  const [me, setMe] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const [{ data: ps }, { data: s }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    setPeople((ps ?? []) as Profile[]);
    setMe(((ps ?? []) as Profile[]).find((p) => p.id === auth.user?.id) ?? null);
    setSettings(s as Settings);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updatePerson(p: Profile, changes: Partial<Profile>) {
    setError(null);
    const { error } = await createClient().from("profiles").update(changes).eq("id", p.id);
    if (error) return setError(error.message);
    load();
  }

  async function removePerson(p: Profile) {
    if (!confirm(`Remove ${p.full_name}'s access? They will no longer be able to sign in to the CRM.`)) return;
    const { error } = await createClient().from("profiles").delete().eq("id", p.id);
    if (error) return setError(error.message);
    load();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaved(false);
    setError(null);
    const { error } = await createClient()
      .from("settings")
      .update({
        sender_name: settings.sender_name.trim(),
        sender_email: settings.sender_email.trim(),
        reply_to: settings.reply_to?.trim() || null,
        email_footer: settings.email_footer,
      })
      .eq("id", 1);
    if (error) return setError(error.message);
    setSaved(true);
  }

  const [hourValue, setHourValue] = useState("");
  const [hourSaved, setHourSaved] = useState(false);
  useEffect(() => {
    if (settings) setHourValue(settings.volunteer_hour_value === null ? "" : String(settings.volunteer_hour_value));
  }, [settings?.volunteer_hour_value]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveHourValue(e: React.FormEvent) {
    e.preventDefault();
    setHourSaved(false);
    setError(null);
    const cleaned = hourValue.replace(/[^0-9.]/g, "");
    const value = cleaned === "" ? null : Math.round(parseFloat(cleaned) * 100) / 100;
    if (value !== null && isNaN(value)) return setError("Enter a dollar amount (numbers only), or leave it blank.");
    const { error } = await createClient().from("settings").update({ volunteer_hour_value: value }).eq("id", 1);
    if (error) return setError(error.message);
    setHourValue(value === null ? "" : String(value));
    setHourSaved(true);
  }

  if (!me) return <p className="muted">Loading…</p>;
  if (me.role !== "admin") return <p className="muted">Only admins can change settings.</p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>
      {error && <p className="text-sm text-coral-600">{error}</p>}

      <section className="card overflow-hidden">
        <div className="p-4">
          <h2 className="font-display text-lg font-semibold">Staff access</h2>
          <p className="muted text-sm">
            New sign-ups wait here until you activate them. Admins can also change these settings and manage access.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Signed up</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.full_name}</td>
                  <td>{p.email}</td>
                  <td>{shortDate(p.created_at)}</td>
                  <td>
                    <select
                      className="input w-auto py-1"
                      value={p.role}
                      disabled={p.id === me.id}
                      onChange={(e) => updatePerson(p, { role: e.target.value as Profile["role"] })}
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <button
                      disabled={p.id === me.id}
                      onClick={() => updatePerson(p, { is_active: !p.is_active })}
                      className={`pill ${p.is_active ? "pill-good" : "pill-warn"}`}
                      title={p.id === me.id ? "" : "Click to change"}
                    >
                      {p.is_active ? "Active" : "Pending — click to activate"}
                    </button>
                  </td>
                  <td className="text-right">
                    {p.id !== me.id && (
                      <button className="text-xs font-semibold text-coral-600" onClick={() => removePerson(p)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {settings && (
        <section className="card p-5">
          <h2 className="font-display text-lg font-semibold">Email sending</h2>
          <p className="muted text-sm">
            Donor emails come from this name and address. The address&rsquo;s domain must be verified in the SMTP2GO
            account (see the setup guide). Replies go to the reply-to address, or to whichever staff member sent the
            email if it&rsquo;s left blank.
          </p>
          <form onSubmit={saveSettings} className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">From name</label>
              <input className="input mt-1" required value={settings.sender_name}
                onChange={(e) => setSettings({ ...settings, sender_name: e.target.value })} />
            </div>
            <div>
              <label className="label">From email address</label>
              <input type="email" className="input mt-1" required value={settings.sender_email}
                onChange={(e) => setSettings({ ...settings, sender_email: e.target.value })} />
            </div>
            <div>
              <label className="label">Reply-to address (optional)</label>
              <input type="email" className="input mt-1" value={settings.reply_to ?? ""}
                onChange={(e) => setSettings({ ...settings, reply_to: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Footer added to every email</label>
              <textarea rows={2} className="input mt-1" value={settings.email_footer}
                onChange={(e) => setSettings({ ...settings, email_footer: e.target.value })} />
            </div>
            <div className="flex items-center gap-3">
              <button className="btn btn-primary">Save email settings</button>
              {saved && <span className="text-sm text-teal-700">Saved.</span>}
            </div>
          </form>
        </section>
      )}

      {settings && (
        <section className="card p-5">
          <h2 className="font-display text-lg font-semibold">Volunteer time</h2>
          <p className="muted text-sm">
            Optional. Enter what one volunteer hour is worth to DHA, and each volunteer&rsquo;s page will show the
            dollar value of their logged time, which is useful for grant reports. Leave it blank to show hours only.
          </p>
          <form onSubmit={saveHourValue} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="hour-value">Value of one volunteer hour ($)</label>
              <input id="hour-value" inputMode="decimal" className="input mt-1 w-40" placeholder="Blank" value={hourValue}
                onChange={(e) => setHourValue(e.target.value)} />
            </div>
            <button className="btn btn-primary">Save</button>
            {hourSaved && <span className="text-sm text-teal-700">Saved.</span>}
          </form>
        </section>
      )}
    </div>
  );
}
