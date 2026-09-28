import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DocumentViewer from "@/components/DocumentViewer";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, file_path, file_type, meeting_id")
    .eq("id", params.id)
    .single();

  if (!doc) notFound();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title")
    .eq("id", doc.meeting_id)
    .single();

  const { data: signed } = await supabase.storage
    .from("board-documents")
    .createSignedUrl(doc.file_path, 60 * 60);

  const { data: comments } = await supabase
    .from("comments")
    .select("*")
    .eq("document_id", doc.id)
    .order("created_at", { ascending: true });

  const { data: profiles } = await supabase.from("profiles").select("id, full_name");

  return (
    <div className="flex flex-col gap-4">
      <div>
        {meeting && (
          <Link href={`/meetings/${meeting.id}`} className="text-sm text-teal-700">
            &larr; {meeting.title}
          </Link>
        )}
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{doc.title}</h1>
      </div>

      {!signed?.signedUrl ? (
        <div className="card p-6 text-sm text-coral-600">
          Couldn&rsquo;t generate a link to this file. It may have been removed from storage.
        </div>
      ) : (
        <DocumentViewer
          documentId={doc.id}
          fileType={doc.file_type as "pdf" | "image" | "office"}
          signedUrl={signed.signedUrl}
          currentUserId={user!.id}
          initialComments={comments ?? []}
          authors={profiles ?? []}
        />
      )}
    </div>
  );
}
