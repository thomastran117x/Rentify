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
              "if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}" +
              // The session is memory-only and restored through the refresh
              // cookie, so the app shell cannot know at first paint whether to
              // reserve the sidebar. `rentify.auth.active` records only that
              // this browser had a session; with it the rail is reserved
              // immediately and never jumps in, without it the page renders
              // full width and stays that way.
              //
              // The marker alone is not enough: it does not expire, so after
              // the cookies lapse while the app is closed it would reserve a
              // rail that auth then removes. csrf_token shares the refresh
              // token's lifetime, so requiring both retires the marker exactly
              // when the session it describes is gone — including on the very
              // first visit after expiry.
              "try{if(localStorage.getItem('rentify.auth.active')&&" +
              "('; '+document.cookie).indexOf('; csrf_token=')>-1){" +
              "document.documentElement.setAttribute('data-auth-hint','');}}catch(e){}})();",
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
