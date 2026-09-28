import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single<Profile>();

  const canManage = profile?.role === "admin" || profile?.role === "staff";

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, meeting_date")
    .order("meeting_date", { ascending: false });

  const { data: documents } = await supabase
    .from("documents")
    .select("id, meeting_id");

  const { data: views } = await supabase
    .from("document_views")
    .select("document_id")
    .eq("user_id", user!.id);

  const viewedDocIds = new Set((views ?? []).map((v) => v.document_id));
  const docsByMeeting = new Map<string, string[]>();
  (documents ?? []).forEach((d) => {
    const list = docsByMeeting.get(d.meeting_id) ?? [];
    list.push(d.id);
    docsByMeeting.set(d.meeting_id, list);
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Board Meetings</h1>
          <p className="text-sm text-[#5c584d]">Review packets and leave comments before each meeting.</p>
        </div>
        {canManage && (
          <Link href="/meetings/new" className="btn btn-primary">
            + New meeting
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {(meetings ?? []).length === 0 && (
          <div className="card p-6 text-sm text-[#5c584d]">
            No meetings yet.{canManage ? " Create the first one above." : ""}
          </div>
        )}
        {(meetings ?? []).map((m) => {
          const docIds = docsByMeeting.get(m.id) ?? [];
          const viewedCount = docIds.filter((id) => viewedDocIds.has(id)).length;
          const isUpcoming = m.meeting_date >= today;
          const allViewed = docIds.length > 0 && viewedCount === docIds.length;
          return (
            <Link
              key={m.id}
              href={`/meetings/${m.id}`}
              className="card flex items-center justify-between p-5 transition hover:border-teal-600"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-ink">{m.title}</h2>
                  {isUpcoming && <span className="pill pill-good">Upcoming</span>}
                </div>
                <p className="text-sm text-[#5c584d]">
                  {new Date(m.meeting_date + "T00:00:00").toLocaleDateString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div className="text-right">
                {docIds.length === 0 ? (
                  <span className="text-sm text-[#8b8676]">No documents yet</span>
                ) : (
                  <span className={`pill ${allViewed ? "pill-good" : "pill-warn"}`}>
                    {viewedCount} / {docIds.length} reviewed
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
