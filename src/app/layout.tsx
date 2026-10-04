import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Shubhora User Panel", template: "%s · Shubhora User Panel" },
  description: "User panel for Shubhora — team, income, wallet and subscription.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0a0c30", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable} h-full`}>
      <body className="min-h-full">
        {process.env.NEXT_PUBLIC_DEMO === "1" && (
          <div className="sticky top-0 z-50 bg-[#ff8a1f] px-4 py-1.5 text-center text-xs font-bold text-white">DEMO SYSTEM · all IDs, payments and income here are test data, not real</div>
        )}
        {children}
      </body>
    </html>
  );
}
