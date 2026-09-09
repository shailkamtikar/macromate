import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { THEME_COOKIE_NAME } from "@/lib/theme";

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
      </head>
      <body className="flex min-h-full flex-col bg-surface text-on-surface font-body">
        <div className="flex flex-1 flex-col">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
