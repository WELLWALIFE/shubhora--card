import { NextResponse, type NextRequest } from "next/server";

// Server components cannot see which page they are rendering, so the request path is passed down as a header:
// a visitor without a session is sent to the Shubhora app's sign-in and comes back to the same page (see
// signInUrl in server/auth/session.ts). Nothing else happens here.
export function proxy(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ["/((?!_next/|api/|files/|brand/|.*\\..*).*)"],
};
