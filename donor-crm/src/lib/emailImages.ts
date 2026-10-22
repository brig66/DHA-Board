import { createClient } from "@/lib/supabase/client";

export const EMAIL_IMAGE_BUCKET = "email-images";
/** Widest an image can show inside the 600px email (600 minus 24px padding each side). */
export const EMAIL_CONTENT_WIDTH = 552;

const MAX_PIXELS_WIDE = 1200; // twice the display size, so it stays sharp on phones
const MAX_BYTES = 1_500_000;

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not prepare the image."))), type, quality)
  );

/**
 * Shrinks large pictures (a Canva export is often 2–5 MB) so emails load fast,
 * then stores the picture where every email program can reach it.
 * Returns the public web address and the width to show it at in the email.
 */
export async function uploadEmailImage(file: Blob): Promise<{ url: string; width: number }> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not a picture.");
  if (file.size > 20_000_000) throw new Error("That picture is over 20 MB. Please export a smaller one.");

  const img = await loadImage(file);
  let out: Blob = file;
  let type = file.type;
  const isGif = file.type === "image/gif"; // leave animated GIFs alone

  if (!isGif && (img.naturalWidth > MAX_PIXELS_WIDE || file.size > MAX_BYTES || !["image/png", "image/jpeg"].includes(type))) {
    const scale = Math.min(1, MAX_PIXELS_WIDE / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = await toBlob(canvas, "image/png");
    type = "image/png";
    if (out.size > MAX_BYTES) {
      // photos and big graphics: JPEG on a white background is far smaller
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      out = await toBlob(canvas, "image/jpeg", 0.9);
      type = "image/jpeg";
    }
  }

  const ext = type === "image/jpeg" ? "jpg" : type === "image/gif" ? "gif" : "png";
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(EMAIL_IMAGE_BUCKET)
    .upload(path, out, { contentType: type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Could not upload the picture: ${error.message}`);
  const { data } = supabase.storage.from(EMAIL_IMAGE_BUCKET).getPublicUrl(path);

  // show small graphics (logos) at their own size, big ones at full email width
  const width = Math.min(EMAIL_CONTENT_WIDTH, Math.round(img.naturalWidth / (img.naturalWidth > EMAIL_CONTENT_WIDTH * 1.5 ? 2 : 1)));
  return { url: data.publicUrl, width: Math.max(width, 1) };
}
