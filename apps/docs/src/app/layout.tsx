import { RootProvider } from "fumadocs-ui/provider/next";
import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://breadcrumb.sh"),
  title: {
    default: "Breadcrumb",
    template: "%s | Breadcrumb",
  },
  description: "Open-source LLM tracing and observability for TypeScript.",
  applicationName: "Breadcrumb",
  icons: {
    icon: "/bread_favicon.svg",
  },
  openGraph: {
    siteName: "Breadcrumb",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script
          defer
          data-domain="breadcrumb.sh"
          src="https://nudge-events.up.railway.app/js/script.js"
          strategy="afterInteractive"
        />
        <RootProvider
          theme={{
            forcedTheme: "dark",
            defaultTheme: "dark",
            enableSystem: false,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
