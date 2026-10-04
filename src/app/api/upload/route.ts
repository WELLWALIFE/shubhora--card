import { getAdmin, getMember } from "@/server/auth/session";
import { IMAGE_TYPES, LIMITS, MEMBER_KINDS, saveFile, type FileKind } from "@/server/files";

// One upload endpoint for members (their own photo, KYC documents, ticket pictures) and admins (downloads, company files).
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "") as FileKind;
  if (!(file instanceof File) || !(kind in LIMITS)) return Response.json({ error: "Choose a file." }, { status: 400 });
  const member = MEMBER_KINDS.includes(kind) ? await getMember() : null;
  const admin = await getAdmin();
  if (!member && !admin) return Response.json({ error: "Please log in again." }, { status: 401 });
  if (!MEMBER_KINDS.includes(kind) && !admin) return Response.json({ error: "Not allowed." }, { status: 403 });
  const lim = LIMITS[kind];
  const okType = IMAGE_TYPES.includes(file.type) || (lim.pdf && file.type === "application/pdf");
  if (!okType) return Response.json({ error: lim.pdf ? "Upload a photo (JPG or PNG) or a PDF." : "Upload a photo (JPG or PNG)." }, { status: 400 });
  if (file.size > lim.bytes) return Response.json({ error: `The file is too large. Maximum ${(lim.bytes / 1_000_000).toFixed(1)} MB.` }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const id = await saveFile({ buf, kind, name: file.name || kind, mime: file.type, memberId: member?.id ?? null, adminId: admin?.id ?? null });
  return Response.json({ id, name: file.name, size: buf.length });
}
