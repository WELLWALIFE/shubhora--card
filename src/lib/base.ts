// The app can live under a path (e.g. https://neuraledge.me/partner) or at the root of its own domain.
// Set NEXT_PUBLIC_BASE_PATH at build time; next/link and redirect() add it automatically,
// plain <a>, <form action>, fetch() and <img> need withBase().
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const withBase = (path: string) => `${BASE}${path}`;
