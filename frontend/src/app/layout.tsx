import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ProfileProvider } from "@/lib/ProfileProvider";
import { SessionProvider } from "@/lib/SessionProvider";
import { THEME_COOKIE_NAME } from "@/lib/theme";

// Matches --color-surface's light/dark values in globals.css -- the
// address-bar/OS chrome color when installed as a PWA should never clash
// with the app's own background.
const THEME_COLOR_LIGHT = "#fbf8fc";
const THEME_COLOR_DARK = "#0f1115";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
    statusBarStyle: "default",
    title: "MacroMate",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable lock -- pinch-zoom stays available, this
  // only sets the initial scale and lets the OS/browser pick the address
  // bar and (on some platforms) app-switcher color per color scheme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Theme is read from a cookie *on the server* and rendered directly into
  // the initial HTML — so the very first response already has the right
  // data-theme attribute. That's what makes server and client markup
  // agree from the start: there is no client-only script mutating <html>
  // after the fact for React to disagree with during hydration (the
  // previous inline pre-paint script approach mutated the DOM before
  // hydration, which is exactly what produced the hydration mismatch).
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const theme = themeCookie === "dark" || themeCookie === "light" ? themeCookie : undefined;

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${plusJakartaSans.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
          rel="stylesheet"
        />
        {/* A manual light/dark override (see THEME_COOKIE_NAME) must also
            win over the OS-media-query theme-color pair set in `viewport`
            above -- otherwise an installed PWA's chrome color could
            mismatch the app's own background when the user's override
            disagrees with their OS preference. */}
        {theme && <meta name="theme-color" content={theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT} />}
      </head>
      <body className="flex min-h-full flex-col bg-surface text-on-surface font-body">
        <ServiceWorkerRegistration />
        <SessionProvider>
          <ProfileProvider>
            <AppShell>{children}</AppShell>
          </ProfileProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
