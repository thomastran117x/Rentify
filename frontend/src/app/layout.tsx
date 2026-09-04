import type { Metadata } from "next";
import { AppShell } from "@/components/navigation/app-shell/app-shell";
import { SiteHeader } from "@/components/navigation/header/site-header";
import { SiteFooter } from "@/components/navigation/site-footer";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rentify",
  description: "Trusted rentals across homes, rooms, equipment, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('rentify-theme');" +
              "if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}" +
              "if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();",
          }}
        />
        <Providers>
          <SiteHeader />
          <div className="flex-1">
            <AppShell>{children}</AppShell>
          </div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
