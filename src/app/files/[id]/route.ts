import { getAdmin, getMember } from "@/server/auth/session";
import { loadFile } from "@/server/files";
import { n } from "@/server/db";

// Serves an uploaded file to someone allowed to see it: admins see everything, members see their own files
// and the shared downloads.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await loadFile(id);
  if (!f) return new Response("Not found", { status: 404 });
  const admin = await getAdmin();
  if (!admin) {
    const me = await getMember();
    const mine = me && f.member_id !== null && n(f.member_id) === me.id;
    if (!(mine || (me && f.kind === "download"))) return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(f.buf), {
    headers: {
      "content-type": f.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
      "content-disposition": `${f.mime === "application/pdf" || f.kind === "download" ? "inline" : "inline"}; filename="${encodeURIComponent(f.name)}"`,
    },
  });
}
