// Opens a thank-you letter or receipt as a PDF. This page is public, like the
// unsubscribe page, because donors open it from their email. Each link holds
// the letter's random record number, so letters can't be guessed; several can
// be joined with commas to print a batch.
import { createClient } from "@supabase/supabase-js";
import { buildLettersPdf, letterFileName } from "@/lib/letterPdf";
import type { LetterSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function notFound() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Letter not found</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;color:#22201b;background:#f7f5f0">
<h1 style="font-size:22px">We couldn't find that letter</h1>
<p>The link may be incomplete. Please contact Dental Health Arlington at 817-277-1165 and we'll send you a new copy.</p>
</body></html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ids = Array.from(new Set(decodeURIComponent(params.id).split(",").map((x) => x.trim()).filter(isId))).slice(0, 100);
  if (!ids.length) return notFound();

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const letters: LetterSnapshot[] = [];
  for (const id of ids) {
    const { data } = await supabase.rpc("get_letter", { p_letter: id });
    const snap = (data as { snapshot?: LetterSnapshot } | null)?.snapshot;
    if (snap) letters.push(snap);
  }
  if (!letters.length) return notFound();

  const pdf = await buildLettersPdf(letters);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${letterFileName(letters)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
