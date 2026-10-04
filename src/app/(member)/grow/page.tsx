import QRCode from "qrcode";
import { headers } from "next/headers";
import { BASE } from "@/lib/base";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { maybeOne } from "@/server/db";
import { suiteOrigin } from "@/server/suite";
import { ShareLink } from "@/components/share-link";
import { Notice, PageHead } from "@/components/ui";

export const metadata = { title: "Grow" };

async function origin() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}${BASE}`;
}

export default async function GrowPage({ searchParams }: { searchParams: Promise<{ parent?: string; leg?: string }> }) {
  const me = await requireMember();
  const { parent, leg } = await searchParams;
  const base = await origin();
  // One link: sign-up happens in the Shubhora app with this member as the introducer (shown by username only);
  // the new account is placed on the weaker side automatically. Old left/right links keep working.
  const handle = (await maybeOne<{ username: string | null }>(await db(), "select username from members where id = $1", [me.id]))?.username || me.code;
  // The short app link when this ID has an app username (shubhora.com/join/NAME); the panel's own join link otherwise.
  const suite = suiteOrigin();
  const url = suite && handle !== me.code ? `${suite}/join/${encodeURIComponent(handle)}` : `${base}/join?by=${encodeURIComponent(handle)}`;
  // Two links here (owner's call, 23 Sep 2026): the member chooses the side. The digital card keeps the universal
  // link (no side → weaker side automatically).
  const withLeg = (leg: "L" | "R") => `${url}${url.includes("?") ? "&" : "?"}leg=${leg}`;
  const urlL = withLeg("L"), urlR = withLeg("R");
  const qrOpts = { margin: 1, width: 360, color: { dark: "#12144a", light: "#ffffff" } };
  const [qrL, qrR] = await Promise.all([QRCode.toDataURL(urlL, qrOpts), QRCode.toDataURL(urlR, qrOpts)]);
  const text = "Get your own Shubhora — digital card, website, daily posters and WhatsApp AI. Free to start:";

  return (
    <div className="space-y-6">
      <PageHead title="Grow your team" sub="Two links — one for each side. Whoever creates a Shubhora account from a link joins your team on that side." />
      {parent && (
        <Notice>To place someone exactly under <b className="font-mono">{parent}</b> on the {leg === "R" ? "right" : "left"}, register them from the admin or ask support.</Notice>
      )}
      {me.status !== "green" && <Notice tone="amber">Your ID is red. You can build your team now, but you earn only after you activate your own subscription.</Notice>}
      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        <ShareLink url={urlL} label={`Left team link · ${handle}`} qr={qrL} text={text} />
        <ShareLink url={urlR} label={`Right team link · ${handle}`} qr={qrR} text={text} />
      </div>
      <p className="text-sm text-muted">Your digital card carries the plain link <span className="font-mono">{url.replace(/^https?:\/\//, "")}</span> at the bottom — sign-ups from the card go to your weaker side automatically.</p>
    </div>
  );
}
