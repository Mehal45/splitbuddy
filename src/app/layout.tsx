import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anmol Gas Agency",
  description: "Demo: stock, deliveries, approvals and billing for a Bharat Gas distributor in Bangalore.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#12151c" },
  ],
};

// Resolve the saved theme before first paint to avoid a flash.
// Also applies the look (new "studio" style by default, or "classic").
const themeScript = `(function(){var r=document.documentElement;r.setAttribute('data-style','studio');try{var s=localStorage.getItem('anmol-style');if(s==='classic')r.setAttribute('data-style','classic');var t=localStorage.getItem('anmol-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);r.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- single-page app, font is only used by the new style */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Urbanist:wght@300;400;500;600;700&display=swap" />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
