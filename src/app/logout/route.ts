import { redirect } from "next/navigation";
import { endSession } from "@/server/auth/session";
import { suiteOrigin } from "@/server/suite";

// Ends the panel session. The Shubhora app calls POST here when the person logs out of the app, so one logout
// covers both (a shared phone must not keep the earnings pages open). GET is the same for a plain link.
export async function POST() {
  await endSession("member");
  return new Response(null, { status: 204 });
}

export async function GET() {
  await endSession("member");
  const suite = suiteOrigin();
  redirect(suite ? `${suite}/login` : "/login?legacy=1");
}
