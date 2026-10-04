import type { MetadataRoute } from "next";
import { BASE } from "@/lib/base";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shubhora Partner", short_name: "Partner", start_url: `${BASE}/dashboard`, scope: `${BASE}/`,
    display: "standalone", background_color: "#0a0c30", theme_color: "#0a0c30",
    icons: [{ src: `${BASE}/icon.png`, sizes: "512x512", type: "image/png" }],
  };
}
