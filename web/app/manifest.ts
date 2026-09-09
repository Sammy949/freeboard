import type { MetadataRoute } from "next";

/**
 * The web app manifest. Not because this is an installable app — it is a landing
 * page — but because Android uses it for the home-screen icon and the browser
 * chrome colour, and without it both fall back to a screenshot crop and white.
 *
 * `theme_color` is #0f4d99, sampled from the real rendered top strip of the page
 * rather than picked to look about right. It is the deep sky with the scrim over
 * it, which is what the browser's own chrome has to sit flush against.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Freeboard: zero-knowledge solvency proofs",
    short_name: "Freeboard",
    description:
      "Prove a crypto loan is nowhere near liquidation without revealing its size. Your figures stay on your computer; only the answer reaches the chain.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#0f4d99",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Declared maskable as well: the mark has generous clearance inside its
      // tile, so Android's adaptive-icon crop cannot bite into the disc.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
