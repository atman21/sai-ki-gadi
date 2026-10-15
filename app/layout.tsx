import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import { ADMIN_FONT_SIZE_BOOTSTRAP_SCRIPT } from "@/lib/admin-font-size";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sai ki Gadi",
  description: "Sai ki Gadi — simple truck ride app for everyone.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Font-size bootstrap may set data-admin-font-size before hydrate.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script
          id="admin-font-size-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: ADMIN_FONT_SIZE_BOOTSTRAP_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
