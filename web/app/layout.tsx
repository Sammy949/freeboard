import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { SITE_URL } from "@/lib/site";
import "./globals.css";

/**
 * Zodiak carries the display line and the wordmark; Switzer carries everything
 * else. Both self-hosted from Fontshare rather than served off a CDN, and
 * neither is on the Google default rotation.
 *
 * TWO FACES WERE TRIED AND REJECTED, both on rendered evidence rather than by
 * reputation. Khand is a condensed signage face made for a dark panel; on white
 * at hero size it read cramped and web-1.0. Pally was next, and it is a rounded
 * humanist — set at 58px in white over a blue sky it read as a children's
 * weather app, which is the bubbly-display failure exactly.
 *
 * Zodiak was chosen against seven others rendered side by side on the actual
 * footage. It is a display serif with flared wedge serifs and tight apertures:
 * enough character to carry an identity, and structurally heavy enough that
 * white type survives passing over a bright cloud — which is why Melodrama,
 * Erode and Gambarino lost, their thin strokes disappeared into the sky.
 *
 * A ship's registry plate is set in a serif. That is the right voice for a mark
 * built on a Plimsoll line.
 */
const zodiak = localFont({
  variable: "--font-zodiak",
  display: "swap",
  src: [{ path: "./fonts/zodiak-700.woff2", weight: "700", style: "normal" }],
});

const switzer = localFont({
  variable: "--font-switzer",
  display: "swap",
  src: [
    { path: "./fonts/switzer-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/switzer-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/switzer-700.woff2", weight: "700", style: "normal" },
  ],
});

const TITLE = "Freeboard: prove a position is solvent without revealing it";
const DESCRIPTION =
  "Prove a crypto loan is nowhere near liquidation without revealing its size. Your figures stay on your computer; only the answer reaches the chain.";

/**
 * The icons and the social card are NOT declared here. Next resolves them from
 * the file conventions in this directory — icon.svg, favicon.ico,
 * apple-icon.png, opengraph-image.png, twitter-image.png — and emits the tags
 * with content hashes. Declaring them by hand as well would produce duplicate,
 * unhashed tags that go stale on the next deploy.
 *
 * The mark in all of them is the Plimsoll disc from components/mark.tsx, redrawn
 * on a 32-unit grid at a heavier weight: the in-page geometry is 1.75/24 stroke,
 * which at a 16px browser tab is under a pixel and disappears. The icon version
 * was chosen against three alternatives rendered at 16, 24, 32 and 64px.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Freeboard",
  authors: [{ name: "Samuel Urah Yahaya" }],
  keywords: [
    "zero-knowledge proof",
    "Midnight blockchain",
    "solvency proof",
    "Compact",
    "DeFi",
    "privacy",
    "CLI",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Freeboard",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  appleWebApp: { capable: false, title: "Freeboard" },
  robots: { index: true, follow: true },
};

/**
 * #0f4d99 is sampled from the real rendered top strip of the page — the deep sky
 * under its scrim — so the browser's own chrome sits flush against the hero
 * rather than butting a guessed blue against it.
 */
export const viewport: Viewport = {
  themeColor: "#0f4d99",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${zodiak.variable} ${switzer.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
