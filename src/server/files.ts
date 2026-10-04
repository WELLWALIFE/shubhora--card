import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./index";
import { maybeOne } from "./db";

// Uploaded files live on disk outside the app folder (deploys never touch them); the database keeps who owns what.
const DIR = () => process.env.UPLOAD_DIR || join(process.cwd(), ".data/uploads");

export type FileKind = "photo" | "kyc_pan" | "kyc_bank" | "kyc_aadhaar_front" | "kyc_aadhaar_back" | "ticket" | "download" | "company" | "payment";
export const MEMBER_KINDS: FileKind[] = ["photo", "kyc_pan", "kyc_bank", "kyc_aadhaar_front", "kyc_aadhaar_back", "ticket", "payment"];
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Largest file accepted per kind. Images are shrunk in the browser first, so real uploads are far smaller. */
export const LIMITS: Record<FileKind, { bytes: number; pdf: boolean }> = {
  photo: { bytes: 1_500_000, pdf: false }, kyc_pan: { bytes: 2_000_000, pdf: true }, kyc_bank: { bytes: 2_000_000, pdf: true },
  kyc_aadhaar_front: { bytes: 2_000_000, pdf: false }, kyc_aadhaar_back: { bytes: 2_000_000, pdf: false },
  ticket: { bytes: 2_000_000, pdf: true }, payment: { bytes: 2_000_000, pdf: true }, download: { bytes: 15_000_000, pdf: true }, company: { bytes: 2_000_000, pdf: false },
};

export async function saveFile(p: { buf: Buffer; kind: FileKind; name: string; mime: string; memberId: number | null; adminId: number | null }) {
  const id = randomBytes(16).toString("hex");
  await mkdir(DIR(), { recursive: true });
  await writeFile(join(DIR(), id), p.buf, { mode: 0o600 });
  await (await db()).query(
    "insert into files (id, member_id, kind, name, mime, size_bytes, created_by_admin) values ($1, $2, $3, $4, $5, $6, $7)",
    [id, p.memberId, p.kind, p.name.slice(0, 120), p.mime, p.buf.length, p.adminId]);
  return id;
}

export async function loadFile(id: string) {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const meta = await maybeOne<{ member_id: unknown; kind: FileKind; name: string; mime: string }>(await db(),
    "select member_id, kind, name, mime from files where id = $1", [id]);
  if (!meta) return null;
  const buf = await readFile(join(DIR(), id)).catch(() => null);
  return buf ? { ...meta, buf } : null;
}

/** Only accept a file id the member really uploaded (stops one member attaching another's file). */
export async function ownsFile(id: string | null | undefined, memberId: number, kind: FileKind): Promise<string | null> {
  if (!id) return null;
  const r = await maybeOne(await db(), "select 1 from files where id = $1 and member_id = $2 and kind = $3", [id, memberId, kind]);
  return r ? id : null;
}
