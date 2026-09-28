"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { classifyFileType } from "@/lib/types";

export default function UploadDocument({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setError(null);
    setUploading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in.");
      setUploading(false);
      return;
    }

    const fileType = classifyFileType(file.name);
    const path = `${meetingId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("board-documents")
      .upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: insertError } = await supabase.from("documents").insert({
      meeting_id: meetingId,
      title: title || file.name,
      file_path: path,
      file_type: fileType,
      uploaded_by: user.id,
    });

    setUploading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTitle("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold text-ink">Upload a report</h3>
      <input
        placeholder="Document title (e.g. Clinic Report — September 2026)"
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
        className="text-sm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {error && <p className="text-sm text-coral-600">{error}</p>}
      <button type="submit" disabled={uploading} className="btn btn-primary self-start">
        {uploading ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
