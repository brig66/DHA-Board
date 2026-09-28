"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NewMeetingPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in.");
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("meetings")
      .insert({ title, meeting_date: date, created_by: user.id })
      .select("id")
      .single();
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/meetings/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-2xl font-semibold text-ink">New meeting</h1>
      <form onSubmit={handleSubmit} className="card mt-6 flex flex-col gap-4 p-6">
        <div>
          <label className="label" htmlFor="title">Meeting title</label>
          <input
            id="title"
            required
            placeholder="e.g. October 2026 Board Meeting"
            className="input mt-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="date">Meeting date</label>
          <input
            id="date"
            type="date"
            required
            className="input mt-1"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-coral-600">{error}</p>}
        <button type="submit" disabled={loading} className="btn btn-primary mt-2">
          {loading ? "Creating…" : "Create meeting"}
        </button>
      </form>
    </div>
  );
}
