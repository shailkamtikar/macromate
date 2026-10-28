import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { MotionProvider } from "@/components/MotionProvider";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ToastProvider } from "@/components/ui/Toast";
import { WarmPing } from "@/components/WarmPing";
import { ProfileProvider } from "@/lib/ProfileProvider";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { SessionProvider } from "@/lib/SessionProvider";
import { THEME_COOKIE_NAME } from "@/lib/theme";

// Match --color-surface in globals.css: the address-bar/OS chrome color when
// installed as a PWA must never clash with the app's own background.
const THEME_COLOR_LIGHT = "#f5f6f1";
const THEME_COLOR_DARK = "#090b0a";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Editorial serif for landing headlines (one italic accent phrase).
const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

// Small uppercase "eyebrow" labels, captions and figures.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MacroMate",
  description:
    "Macro tracking, AI nutrition coaching, and social accountability that helps you actually stick to your goals.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MacroMate",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable lock -- pinch-zoom stays available.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
};

type ThemeChoice = "dark" | "light" | "system";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Theme is read from a cookie *on the server* and rendered directly into
  // the initial HTML, so the very first response already has the right
  // data-theme attribute and server/client markup agree from the start (no
  // client script mutating <html> before hydration). Dark is the default
  // when the visitor has never chosen anything.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const theme: ThemeChoice =
    cookieValue === "light" || cookieValue === "system" || cookieValue === "dark"
      ? cookieValue
      : "dark";

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${jakarta.variable} ${inter.variable} ${instrument.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/* An explicit light/dark choice must also win over the OS-level
            theme-color pair set in `viewport` above, so an installed PWA's
            chrome never mismatches the app's own background. */}
        {theme !== "system" && (
          <meta
            name="theme-color"
            content={theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT}
          />
        )}
      </head>
      <body className="flex min-h-full flex-col bg-surface text-on-surface font-body">
        <ServiceWorkerRegistration />
        <WarmPing />
        <MotionProvider>
          <SessionProvider>
            <QueryProvider>
              <ProfileProvider>
                <ToastProvider>
                  <AppShell>{children}</AppShell>
                </ToastProvider>
              </ProfileProvider>
            </QueryProvider>
          </SessionProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
