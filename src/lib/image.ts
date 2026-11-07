import { supabase } from "./supabase";

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
  if (webp && webp.type === "image/webp") return webp;
  // Older Safari can't encode WebP.
  return (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality)))!;
}

/**
 * Shrinks a phone photo (often 4–8 MB) to ~150–300 KB WebP plus a small thumbnail,
 * then uploads both to the user's folder. Returns the storage path of the full image.
 */
export async function uploadPhoto(file: File, folder: "shops" | "sarees" | "requests" | "replies"): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo (JPG, PNG or WebP).");
  if (file.size > 25 * 1024 * 1024) throw new Error("That photo is too large. Please pick one under 25 MB.");
  const { data } = await supabase().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error("Please sign in again.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    throw new Error("This photo format isn't supported. Please use JPG or PNG.");
  }
  const [full, thumb] = await Promise.all([encode(bitmap, 1600, 0.82), encode(bitmap, 480, 0.78)]);
  bitmap.close();
  const ext = full.type === "image/webp" ? "webp" : "jpg";
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${uid}/${folder}/${id}.${ext}`;
  const thumbPath = `${uid}/${folder}/${id}_t.${ext}`;
  const store = supabase().storage.from("media");
  const opts = { contentType: full.type, cacheControl: "31536000", upsert: false };
  const [a, b] = await Promise.all([store.upload(path, full, opts), store.upload(thumbPath, thumb, opts)]);
  if (a.error || b.error) throw new Error(`Upload failed: ${(a.error ?? b.error)!.message}`);
  return path;
}
