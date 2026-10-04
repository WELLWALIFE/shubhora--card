import { timingSafeEqual } from "node:crypto";

/** The one-time owner setup link carries SETUP_TOKEN; compare in constant time. */
export function setupTokenOk(t: string | undefined) {
  const want = process.env.SETUP_TOKEN;
  if (!want || !t) return false;
  const a = Buffer.from(want); const b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}
