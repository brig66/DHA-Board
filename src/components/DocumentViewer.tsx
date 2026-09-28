"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { createClient } from "@/lib/supabase/client";
import CommentPin from "@/components/CommentPin";
import type { Comment } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url
).toString();

type Author = { id: string; full_name: string };
type CommentWithAuthor = Comment & { author?: Author };

export default function DocumentViewer({
  documentId,
  fileType,
  signedUrl,
  currentUserId,
  initialComments,
  authors,
}: {
  documentId: string;
  fileType: "pdf" | "image" | "office";
  signedUrl: string;
  currentUserId: string;
  initialComments: CommentWithAuthor[];
  authors: Author[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [comments, setComments] = useState<CommentWithAuthor[]>(initialComments);
  const [numPages, setNumPages] = useState(0);
  const [pinning, setPinning] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ page: number; x: number; y: number } | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [flatText, setFlatText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(680);

  useEffect(() => {
    // Record that this user opened the document (feeds the "came prepared" report).
    supabase.rpc("record_document_view", { p_document_id: documentId });
  }, [documentId, supabase]);

  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        setPageWidth(Math.min(760, containerRef.current.clientWidth));
      }
    }
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  function authorFor(userId: string) {
    return authors.find((a) => a.id === userId)?.full_name ?? "Someone";
  }

  const topLevel = comments
    .filter((c) => !c.parent_id)
    .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0) || a.created_at.localeCompare(b.created_at));

  function repliesFor(id: string) {
    return comments.filter((c) => c.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  function handlePageClick(page: number, e: React.MouseEvent<HTMLDivElement>) {
    if (!pinning) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingPin({ page, x, y });
    setPinning(false);
  }

  async function submitPin() {
    if (!pendingPin || !pendingText.trim()) return;
    const { data, error } = await supabase
      .from("comments")
      .insert({
        document_id: documentId,
        user_id: currentUserId,
        page_number: pendingPin.page,
        x: pendingPin.x,
        y: pendingPin.y,
        body: pendingText.trim(),
      })
      .select("*")
      .single();
    if (!error && data) {
      setComments((prev) => [...prev, data as CommentWithAuthor]);
      setActiveId(data.id);
    }
    setPendingPin(null);
    setPendingText("");
  }

  async function submitFlatComment() {
    if (!flatText.trim()) return;
    const { data, error } = await supabase
      .from("comments")
      .insert({
        document_id: documentId,
        user_id: currentUserId,
        page_number: null,
        x: null,
        y: null,
        body: flatText.trim(),
      })
      .select("*")
      .single();
    if (!error && data) {
      setComments((prev) => [...prev, data as CommentWithAuthor]);
    }
    setFlatText("");
  }

  async function submitReply(parentId: string) {
    const text = replyDrafts[parentId];
    if (!text?.trim()) return;
    const parent = comments.find((c) => c.id === parentId);
    const { data, error } = await supabase
      .from("comments")
      .insert({
        document_id: documentId,
        user_id: currentUserId,
        page_number: parent?.page_number ?? null,
        x: null,
        y: null,
        body: text.trim(),
        parent_id: parentId,
      })
      .select("*")
      .single();
    if (!error && data) {
      setComments((prev) => [...prev, data as CommentWithAuthor]);
    }
    setReplyDrafts((prev) => ({ ...prev, [parentId]: "" }));
  }

  function renderThread(comment: CommentWithAuthor, pinNumber?: number) {
    const isActive = activeId === comment.id;
    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        className={`card p-4 ${isActive ? "border-teal-600" : ""}`}
        onClick={() => setActiveId(comment.id)}
      >
        <div className="flex items-center gap-2 text-xs text-[#8b8676]">
          {pinNumber && <span className="pill pill-bad">#{pinNumber}</span>}
          {comment.page_number && <span>Page {comment.page_number}</span>}
          <span>{authorFor(comment.user_id)}</span>
          <span>&middot;</span>
          <span>{new Date(comment.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        </div>
        <p className="mt-1 text-sm text-ink">{comment.body}</p>
        <div className="mt-2 flex flex-col gap-2 border-l-2 border-[var(--border)] pl-3">
          {repliesFor(comment.id).map((r) => (
            <div key={r.id}>
              <div className="text-xs text-[#8b8676]">
                {authorFor(r.user_id)} &middot;{" "}
                {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric" })}
              </div>
              <p className="text-sm text-ink">{r.body}</p>
            </div>
          ))}
        </div>
        <form
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            submitReply(comment.id);
          }}
          className="mt-2 flex gap-2"
        >
          <input
            className="input text-sm"
            placeholder="Reply…"
            value={replyDrafts[comment.id] ?? ""}
            onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
          />
          <button type="submit" className="btn btn-secondary text-xs">
            Reply
          </button>
        </form>
      </div>
    );
  }

  const supportsPins = fileType === "pdf" || fileType === "image";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        {supportsPins && (
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPinning((p) => !p)}
              className={`btn ${pinning ? "btn-primary" : "btn-secondary"}`}
            >
              {pinning ? "Click on the document to place your comment…" : "+ Add pinned comment"}
            </button>
            {pinning && (
              <button type="button" onClick={() => setPinning(false)} className="btn btn-secondary">
                Cancel
              </button>
            )}
          </div>
        )}

        <div ref={containerRef} className={`card overflow-hidden p-2 ${pinning ? "cursor-crosshair" : ""}`}>
          {fileType === "pdf" && (
            <Document
              file={signedUrl}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              loading={<div className="p-10 text-center text-sm text-[#8b8676]">Loading document…</div>}
              error={<div className="p-10 text-center text-sm text-coral-600">Couldn&rsquo;t load this PDF.</div>}
            >
              {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
                <div key={page} className="relative mb-2" onClick={(e) => handlePageClick(page, e)}>
                  <Page pageNumber={page} width={pageWidth} renderAnnotationLayer={false} />
                  {topLevel
                    .filter((c) => c.page_number === page)
                    .map((c) => {
                      const number = topLevel.findIndex((t) => t.id === c.id) + 1;
                      return (
                        <CommentPin
                          key={c.id}
                          x={Number(c.x)}
                          y={Number(c.y)}
                          number={number}
                          active={activeId === c.id}
                          onClick={() => {
                            setActiveId(c.id);
                            document.getElementById(`comment-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                        />
                      );
                    })}
                  {pendingPin?.page === page && (
                    <div
                      style={{ left: `${pendingPin.x}%`, top: `${pendingPin.y}%` }}
                      className="absolute z-20 w-64 -translate-x-1/2 rounded-lg border border-teal-600 bg-white p-3 shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <textarea
                        autoFocus
                        className="input text-sm"
                        rows={3}
                        placeholder="Leave a comment on this spot…"
                        value={pendingText}
                        onChange={(e) => setPendingText(e.target.value)}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" className="btn btn-secondary text-xs" onClick={() => setPendingPin(null)}>
                          Cancel
                        </button>
                        <button type="button" className="btn btn-primary text-xs" onClick={submitPin}>
                          Post
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Document>
          )}

          {fileType === "image" && (
            <div className="relative" onClick={(e) => handlePageClick(1, e)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signedUrl} alt="Document" className="w-full rounded" />
              {topLevel
                .filter((c) => c.page_number === 1)
                .map((c) => {
                  const number = topLevel.findIndex((t) => t.id === c.id) + 1;
                  return (
                    <CommentPin
                      key={c.id}
                      x={Number(c.x)}
                      y={Number(c.y)}
                      number={number}
                      active={activeId === c.id}
                      onClick={() => setActiveId(c.id)}
                    />
                  );
                })}
              {pendingPin && (
                <div
                  style={{ left: `${pendingPin.x}%`, top: `${pendingPin.y}%` }}
                  className="absolute z-20 w-64 -translate-x-1/2 rounded-lg border border-teal-600 bg-white p-3 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <textarea
                    autoFocus
                    className="input text-sm"
                    rows={3}
                    value={pendingText}
                    onChange={(e) => setPendingText(e.target.value)}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" className="btn btn-secondary text-xs" onClick={() => setPendingPin(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary text-xs" onClick={submitPin}>
                      Post
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {fileType === "office" && (
            <div className="p-8 text-center">
              <p className="text-sm text-[#5c584d]">
                This file type doesn&rsquo;t support in-page previews or pinned comments yet.
                Use the button below to download and view it, and leave general comments in the
                thread to the right.
              </p>
              <a href={signedUrl} target="_blank" rel="noreferrer" className="btn btn-primary mt-4 inline-flex">
                Download to view
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5c584d]">
          Comments ({topLevel.length})
        </h2>
        {fileType === "office" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitFlatComment();
            }}
            className="card flex flex-col gap-2 p-3"
          >
            <textarea
              className="input text-sm"
              rows={2}
              placeholder="Add a comment about this document…"
              value={flatText}
              onChange={(e) => setFlatText(e.target.value)}
            />
            <button type="submit" className="btn btn-primary self-start text-xs">
              Post
            </button>
          </form>
        )}
        {topLevel.length === 0 && (
          <p className="text-sm text-[#8b8676]">No comments yet. Be the first to weigh in.</p>
        )}
        {topLevel.map((c, i) => renderThread(c, supportsPins ? i + 1 : undefined))}
      </div>
    </div>
  );
}
