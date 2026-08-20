import type { Metadata } from "next";
import "./globals.css";

// Fonts are loaded via a standard <link> tag rather than next/font/google.
// next/font/google fetches font files at BUILD time, which fails outright
// in any environment without network access to fonts.googleapis.com
// (this was a real build failure caught while building this app -- see
// chat). A <link> tag fetches at browser runtime instead, which is more
// resilient to where this gets built/deployed and avoids coupling the
// build step to an external service's uptime.
export const metadata: Metadata = {
  title: "Observ — Monitoring & Evaluation",
  description: "Enterprise M&E platform for programs, indicators, and results.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
