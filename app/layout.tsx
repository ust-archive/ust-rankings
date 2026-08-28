import "@typehaus/metropolis/500.css";
import "@typehaus/metropolis/700.css";
import "@mdxeditor/editor/style.css";
import "./globals.css";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { GoogleAnalytics } from "@next/third-parties/google";
import { GraduationCapIcon } from "lucide-react";
import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import Link from "next/link";
import type React from "react";
import { EntityLink } from "@/app/entity-navigation";
import { Toaster } from "@/components/ui/sonner";
import { authenticatedUserId } from "@/lib/auth/user";
import { getAccountService } from "@/lib/contributions/postgres";
import { privacyContactMailto } from "@/lib/privacy/contact";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"] });
const roboto_mono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});
const forwardTransition = ["nav-forward"];

export const metadata: Metadata = {
  metadataBase: new URL("https://ust-rankings.com"),
  title: "UST Rankings",
  description: "Course and Instructor rankings for HKUST students.",
};

export const viewport: Viewport = {
  themeColor: "#003366",
};

function FooterLinks({
  heading,
  links,
}: {
  heading: string;
  links: ReadonlyArray<readonly [label: string, href: string]>;
}) {
  const id = `footer-${heading.toLowerCase()}`;
  return (
    <nav aria-labelledby={id} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-950" id={id}>
        {heading}
      </h2>
      {links.map(([label, href]) =>
        href.startsWith("/rankings/") ? (
          <EntityLink
            className="w-fit text-sm underline-offset-4 hover:text-slate-950"
            href={href}
            key={href}
            transitionTypes={forwardTransition}
          >
            {label}
          </EntityLink>
        ) : (
          <Link
            className="w-fit text-sm underline-offset-4 hover:text-slate-950"
            href={href}
            key={href}
            prefetch={href === "/account" ? false : undefined}
            transitionTypes={
              href.startsWith("/rankings/") ? forwardTransition : undefined
            }
          >
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}

async function HeaderAuth() {
  const pill =
    "max-w-40 truncate rounded-full border border-white/60 px-3 py-1.5 no-underline hover:bg-white/10";
  if (!process.env.AUTH_SECRET) {
    return (
      <button className={pill} disabled type="button">
        Login
      </button>
    );
  }
  const userId = await authenticatedUserId();
  if (!userId)
    return (
      <Link className={pill} href="/auth/login?r=%2Faccount" prefetch={false}>
        Login
      </Link>
    );
  let label = "Account";
  if (process.env.CONTRIBUTIONS_POSTGRES_URL)
    try {
      const user = await getAccountService().getUser(userId);
      if (user?.publicDisplayName) label = user.publicDisplayName;
    } catch {
      // Keep public pages independent from contribution storage.
    }
  return (
    <Link className={pill} href="/account" prefetch={false}>
      {label}
    </Link>
  );
}

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
        className={cn(
          inter.className,
          roboto_mono.variable,
          "flex min-h-dvh flex-col",
        )}
      >
        <a
          className="sr-only z-50 rounded-md bg-white px-4 py-2 font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-[#003366] focus:ring-offset-2"
          href="#main-content"
        >
          Skip to Main Content
        </a>
        <header
          className="bg-gradient-to-r from-[#003366] via-[#2b6297] to-[#003366] text-white dark:from-[#003366] dark:via-[#224e77] dark:to-[#003366]"
          style={{ viewTransitionName: "site-header" }}
        >
          <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
            <Link
              aria-label="UST Rankings home"
              className="flex items-center gap-2 font-bold no-underline"
              href="/"
              transitionTypes={forwardTransition}
            >
              <GraduationCapIcon aria-hidden="true" className="h-8 w-8" />
              <span className="hidden sm:inline">UST Rankings</span>
            </Link>
            <nav
              aria-label="Primary navigation"
              className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm font-semibold sm:gap-6 sm:text-base"
            >
              <EntityLink
                className="no-underline underline-offset-4 hover:underline"
                href="/rankings/instructors"
                transitionTypes={forwardTransition}
              >
                Instructors
              </EntityLink>
              <EntityLink
                className="no-underline underline-offset-4 hover:underline"
                href="/rankings/courses"
                transitionTypes={forwardTransition}
              >
                Courses
              </EntityLink>
              <Link
                className="hidden no-underline underline-offset-4 hover:underline sm:inline"
                href="/waitlist"
                transitionTypes={forwardTransition}
              >
                WL Compass
              </Link>
              <HeaderAuth />
            </nav>
          </div>
        </header>
        <div className="relative h-0" id="navigation-progress" />
        <main
          className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center gap-8 px-4 py-12 text-center sm:px-6 lg:py-16"
          id="main-content"
        >
          {children}
        </main>
        <footer
          className="border-t border-slate-200 bg-white text-slate-700"
          style={{ viewTransitionName: "site-footer" }}
        >
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-[2fr_1fr_1fr_1fr]">
            <div className="flex max-w-sm flex-col gap-4">
              <Link
                className="flex w-fit items-center gap-2 text-lg font-bold text-slate-950 no-underline hover:text-slate-950"
                href="/rankings/instructors"
                transitionTypes={forwardTransition}
              >
                <GraduationCapIcon aria-hidden="true" className="size-6" />
                UST Rankings
              </Link>
              <p className="text-pretty text-sm leading-relaxed text-slate-600">
                Independent project for the HKUST community.
              </p>
              <a
                className="inline-flex w-fit items-center gap-2 text-sm underline-offset-4 hover:text-slate-950"
                href="https://github.com/ust-archive/ust-rankings"
                rel="noopener noreferrer"
              >
                <SiGithub aria-hidden="true" className="size-4" />
                Source on GitHub
              </a>
            </div>
            <FooterLinks
              heading="Explore"
              links={[
                ["Instructor Rankings", "/rankings/instructors"],
                ["Course Rankings", "/rankings/courses"],
                ["WL Compass", "/waitlist"],
              ]}
            />
            <FooterLinks
              heading="Project"
              links={[
                ["FAQ", "/faq"],
                ["Account", "/account"],
                ["Contact", privacyContactMailto()],
              ]}
            />
            <nav aria-labelledby="footer-legal" className="flex flex-col gap-3">
              <h2
                className="text-sm font-semibold text-slate-950"
                id="footer-legal"
              >
                Legal
              </h2>
              <Link
                className="text-sm underline-offset-4 hover:text-slate-950"
                href="/privacy"
              >
                Privacy &amp; Community Policy
              </Link>
              <a
                className="text-sm underline-offset-4 hover:text-slate-950"
                href="https://creativecommons.org/licenses/by/4.0/"
                rel="license"
              >
                Review Text: CC BY 4.0
              </a>
            </nav>
          </div>
        </footer>
        <Toaster />
      </body>
      <GoogleAnalytics gaId="G-C8B9VFGTRH" />
    </html>
  );
}
