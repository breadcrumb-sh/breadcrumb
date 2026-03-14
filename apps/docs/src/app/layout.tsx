import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import './global.css';
import { Geist, Geist_Mono } from 'next/font/google';
import { Banner } from 'fumadocs-ui/components/banner';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://breadcrumb.sh'),
  title: {
    default: 'Breadcrumb',
    template: '%s | Breadcrumb',
  },
  description: 'Open-source LLM tracing and observability for TypeScript.',
  applicationName: 'Breadcrumb',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    siteName: 'Breadcrumb',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          defer
          data-domain="breadcrumb.sh"
          src="https://nudge-events.up.railway.app/js/script.js"
        />
      </head>
      <body className={`${geist.className} flex flex-col min-h-screen`}>
        <RootProvider
          theme={{
            forcedTheme: 'dark',
            defaultTheme: 'dark',
            enableSystem: false,
          }}
        >
          <Banner>Breadcrumb is now in beta!&nbsp;-&nbsp;<a href="https://github.com/joshuaKnauber/breadcrumb" target="_blank" rel="noopener noreferrer" className="underline">Star us on GitHub</a></Banner>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
