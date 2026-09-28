import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminUserRow from "@/components/AdminUserRow";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: me } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single<Profile>();

  if (me?.role !== "admin") {
    redirect("/meetings");
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const boardMembers = (profiles ?? []).filter((p) => p.is_active);

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, meeting_date")
    .order("meeting_date", { ascending: false })
    .limit(8);

  const { data: documents } = await supabase.from("documents").select("id, meeting_id");
  const { data: views } = await supabase.from("document_views").select("document_id, user_id");

  const docsByMeeting = new Map<string, string[]>();
  (documents ?? []).forEach((d) => {
    const list = docsByMeeting.get(d.meeting_id) ?? [];
    list.push(d.id);
    docsByMeeting.set(d.meeting_id, list);
  });

  const viewedSet = new Set((views ?? []).map((v) => `${v.user_id}:${v.document_id}`));

  function prepFor(userId: string, meetingId: string) {
    const docIds = docsByMeeting.get(meetingId) ?? [];
    if (docIds.length === 0) return null;
    const viewed = docIds.filter((id) => viewedSet.has(`${userId}:${id}`)).length;
    return { viewed, total: docIds.length };
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Utilization &amp; Access</h1>
        <p className="text-sm text-[#5c584d]">
          See which board members reviewed each meeting&rsquo;s packet before the meeting, and manage
          who has access.
        </p>
      </div>

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c584d]">
          Packet review by meeting
        </h2>
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[#8b8676]">
              <th className="py-2 pr-4">Board member</th>
              {(meetings ?? []).map((m) => (
                <th key={m.id} className="px-2 py-2 text-center">
                  {new Date(m.meeting_date + "T00:00:00").toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boardMembers.map((bm) => (
              <tr key={bm.id} className="border-b border-[var(--border)] last:border-0">
                <td className="py-2 pr-4 font-medium text-ink">{bm.full_name}</td>
                {(meetings ?? []).map((m) => {
                  const prep = prepFor(bm.id, m.id);
                  if (!prep) {
                    return (
                      <td key={m.id} className="px-2 py-2 text-center text-[#8b8676]">
                        —
                      </td>
                    );
                  }
                  const full = prep.viewed === prep.total;
                  const none = prep.viewed === 0;
                  return (
                    <td key={m.id} className="px-2 py-2 text-center">
                      <span className={`pill ${full ? "pill-good" : none ? "pill-bad" : "pill-warn"}`}>
                        {prep.viewed}/{prep.total}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(meetings ?? []).length === 0 && (
          <p className="mt-3 text-sm text-[#8b8676]">No meetings yet.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#5c584d]">
          People &amp; access
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[#8b8676]">
              <th className="py-2 pr-4">Person</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p) => (
              <AdminUserRow key={p.id} profile={p} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
