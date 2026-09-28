import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import UploadDocument from "@/components/UploadDocument";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILE_ICON: Record<string, string> = {
  pdf: "PDF",
  image: "IMG",
  office: "DOC",
};

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
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

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, meeting_date")
    .eq("id", params.id)
    .single();

  if (!meeting) notFound();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, title, file_type, created_at")
    .eq("meeting_id", params.id)
    .order("created_at", { ascending: true });

  const { data: myViews } = await supabase
    .from("document_views")
    .select("document_id")
    .eq("user_id", user!.id);
  const viewedIds = new Set((myViews ?? []).map((v) => v.document_id));

  // For staff/admin: how many active board members have viewed each doc, out of how many.
  let boardTotal = 0;
  let viewCountByDoc = new Map<string, number>();
  if (canManage && documents && documents.length > 0) {
    const { data: boardMembers } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_active", true);
    boardTotal = boardMembers?.length ?? 0;

    const { data: allViews } = await supabase
      .from("document_views")
      .select("document_id")
      .in("document_id", documents.map((d) => d.id));
    (allViews ?? []).forEach((v) => {
      viewCountByDoc.set(v.document_id, (viewCountByDoc.get(v.document_id) ?? 0) + 1);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/meetings" className="text-sm text-teal-700">&larr; All meetings</Link>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{meeting.title}</h1>
        <p className="text-sm text-[#5c584d]">
          {new Date(meeting.meeting_date + "T00:00:00").toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {canManage && <UploadDocument meetingId={meeting.id} />}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c584d]">
          Board packet ({(documents ?? []).length})
        </h2>
        {(documents ?? []).length === 0 && (
          <div className="card p-6 text-sm text-[#5c584d]">No documents uploaded yet.</div>
        )}
        {(documents ?? []).map((doc) => (
          <Link
            key={doc.id}
            href={`/documents/${doc.id}`}
            className="card flex items-center justify-between p-4 transition hover:border-teal-600"
          >
            <div className="flex items-center gap-3">
              <span className="pill pill-warn font-mono">{FILE_ICON[doc.file_type] ?? "FILE"}</span>
              <span className="font-medium text-ink">{doc.title}</span>
            </div>
            <div className="flex items-center gap-3">
              {viewedIds.has(doc.id) && <span className="pill pill-good">You&rsquo;ve reviewed this</span>}
              {canManage && boardTotal > 0 && (
                <span className="text-xs text-[#8b8676]">
                  {viewCountByDoc.get(doc.id) ?? 0} / {boardTotal} board members viewed
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
