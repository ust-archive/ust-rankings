import "./globals.css";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GraduationCapIcon } from "lucide-react";
import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import Link from "next/link";
import type React from "react";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"] });
const roboto_mono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "UST Rankings",
  description: "The Rankings of Instructors at HKUST. ",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta
          name="google-site-verification"
          content="Cdta5XjB-hvjrRL9nSemGyXDvt86xMZypNC5W08v-MA"
        />
      </head>
      <body
        className={cn(inter.className, roboto_mono.variable, "min-h-screen")}
      >
        <header className="bg-gradient-to-r from-[#003366] via-[#2b6297] to-[#003366] text-white dark:from-[#003366] dark:via-[#224e77] dark:to-[#003366]">
          <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
            <Link
              aria-label="UST Rankings home"
              className="flex items-center gap-2 font-bold no-underline"
              href="/"
            >
              <GraduationCapIcon className="h-8 w-8" />
              <span className="hidden sm:inline">UST Rankings</span>
            </Link>
            <nav
              aria-label="Primary navigation"
              className="ml-auto flex items-center gap-4 text-sm font-semibold sm:gap-6 sm:text-base"
            >
              <Link
                className="no-underline underline-offset-4 hover:underline"
                href="/rankings/instructors"
              >
                Instructors
              </Link>
              <Link
                className="no-underline underline-offset-4 hover:underline"
                href="/rankings/courses"
              >
                Courses
              </Link>
              <Link
                className="no-underline underline-offset-4 hover:underline"
                href="/schedule"
              >
                Schedule
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-col items-center space-y-8 px-4 py-12 text-center sm:px-6 lg:py-16">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white text-slate-700">
          <nav
            aria-label="Footer navigation"
            className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-3 px-4 py-8 text-sm sm:px-6"
          >
            <Link href="/privacy">Privacy and community policy</Link>
            <Link href="/faq">FAQ</Link>
            <a
              href="https://github.com/ust-archive/ust-rankings"
              rel="noopener noreferrer"
            >
              <SiGithub aria-hidden="true" className="mr-1 inline h-4 w-4" />
              Source
            </a>
            <a href="mailto:ust-rankings@flandia.dev">Contact</a>
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              rel="license"
            >
              Review text: CC BY 4.0
            </a>
          </nav>
        </footer>
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
      <GoogleAnalytics gaId="G-C8B9VFGTRH" />
    </html>
  );
}
