"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Drawer } from "vaul";

import { GithubMark } from "@/components/github-mark";
import { Mark } from "@/components/mark";
import { REPO_URL } from "@/lib/facts";

/**
 * The top bar: a floating island, fixed for the whole page, made of glass —
 * and on a narrow screen, a bottom sheet holding exactly the same items.
 *
 * ONE SOURCE OF TRUTH. `NAV_ITEMS` is rendered by both the bar and the sheet, so
 * the two cannot drift apart. An earlier version dropped Source from the bar and
 * kept it in the sheet, which meant the mobile menu and the desktop nav were
 * different navigations wearing the same name.
 *
 * FIXED, NOT STICKY. Sticky is contained by its parent block, so a bar placed
 * inside the hero would come unstuck the moment the hero scrolled away. Fixed
 * also means it never occupies layout, so the hero still owns a full viewport
 * rather than a viewport minus a bar.
 *
 * THE GLASS IS THE SAME GLASS. It is the material the install command is made
 * of, returning rather than a second unrelated treatment appearing. That is also
 * what lets the bar stay white-on-dark over a white page: it carries its own
 * ground with it, so the links never have to change colour mid-scroll. It sits
 * over the sky at the top — a backdrop genuinely worth refracting — and over the
 * page's own content lower down.
 *
 * The two states are not a fade-in: the bar is fully present from the first
 * frame. At rest it is thin glass, barely there over the deep sky; once it lands
 * on the page it thickens, because it now has arbitrary content behind it and
 * has to carry its own legibility. One authored transition, 300ms, colour and
 * blur only. Nothing here is gated on the scroll listener — if the JavaScript
 * never runs the nav renders in its resting state and every link still works.
 */
const NAV_ITEMS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#quick-start", label: "Quick start" },
  { href: "#limits", label: "Limits" },
] as const;

const AT_REST = {
  background: "rgb(6 36 74 / 0.26)",
  backdropFilter: "blur(10px) saturate(140%)",
  WebkitBackdropFilter: "blur(10px) saturate(140%)",
  boxShadow: [
    "inset 0 0 0 1px rgb(255 255 255 / 0.16)",
    "inset 0 1px 0 0 rgb(255 255 255 / 0.30)",
    "0 2px 10px -4px rgb(6 36 74 / 0.30)",
  ].join(", "),
};

const LANDED = {
  background: "rgb(6 36 74 / 0.80)",
  backdropFilter: "blur(16px) saturate(160%)",
  WebkitBackdropFilter: "blur(16px) saturate(160%)",
  boxShadow: [
    "inset 0 0 0 1px rgb(255 255 255 / 0.14)",
    "inset 0 1px 0 0 rgb(255 255 255 / 0.26)",
    "0 6px 20px -8px rgb(6 36 74 / 0.55)",
  ].join(", "),
};

export function SiteNav() {
  const [landed, setLanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setLanded(window.scrollY > 72);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Drawer.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <header
        className={`fixed inset-x-0 top-3 z-50 px-3 transition-opacity duration-200 sm:top-4 sm:px-6 md:px-10 ${
          // The bar steps aside while the sheet is open. The overlay already
          // blurs it away, but "already mostly hidden" is not the same as gone,
          // and the wordmark appearing twice — once behind frosted glass, once
          // in the sheet — is exactly the duplication to avoid. This makes it
          // unambiguous: while the sheet is open there is one wordmark, and it
          // rises from where the bar's was.
          menuOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div
          className="mx-auto flex max-w-[64rem] items-center justify-between gap-4 rounded-xl px-5 py-4 transition-[background-color,box-shadow,backdrop-filter] duration-300 ease-out sm:px-5 sm:py-3"
          style={landed ? LANDED : AT_REST}
        >
          <a
            href="#top"
            className="focus-ring-light -m-1 flex shrink-0 items-center gap-2.5 rounded p-1 text-white"
          >
            <Mark className="size-[21px]" />
            <span className="font-display text-[15.5px] leading-none font-bold tracking-widest">
              FREEBOARD
            </span>
          </a>

          <nav className="hidden items-center gap-1.5 md:flex">
            {NAV_ITEMS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="focus-ring-light rounded px-2.5 py-1.5 text-[13.5px] whitespace-nowrap text-white/72 transition-colors hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <a
              href={REPO_URL}
              className="focus-ring-light flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13.5px] text-white/72 transition-colors hover:text-white"
            >
              <GithubMark className="size-[15px]" />
              Source
            </a>
            {/* The one action, set apart by weight and a hairline — not by a
                filled pill beside an outlined ghost. */}
            <span aria-hidden className="mx-1 h-4 w-px rounded-full bg-white/20" />
            <a
              href="#install"
              className="focus-ring-light rounded px-2.5 py-1.5 text-[13.5px] font-medium text-white transition-colors hover:text-sky-air"
            >
              Install
            </a>
          </nav>

          <Drawer.Trigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="focus-ring-light -m-1.5 rounded p-1.5 text-white md:hidden"
            >
              <Menu aria-hidden className="size-[22px]" strokeWidth={2} />
            </button>
          </Drawer.Trigger>
        </div>
      </header>

      <Drawer.Portal>
        {/* The overlay does real work: it is what the sheet sits on top of, what
            blurs the page behind it, and what closes the sheet when tapped.
            Tinted to the sky's deep band rather than plain black, so the page
            dims into its own palette. */}
        <Drawer.Overlay
          className="fixed inset-0 z-[60] backdrop-blur-md"
          style={{ background: "rgb(6 36 74 / 0.55)" }}
        />

        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl focus:outline-none"
          style={{
            background: "rgb(6 36 74 / 0.86)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            boxShadow: [
              "inset 0 0 0 1px rgb(255 255 255 / 0.12)",
              "inset 0 1px 0 0 rgb(255 255 255 / 0.28)",
              "0 -8px 40px -12px rgb(6 36 74 / 0.7)",
            ].join(", "),
          }}
        >
          {/* Vaul's grab handle: the sheet is draggable, so it looks draggable. */}
          <Drawer.Handle className="mt-3 !bg-white/25" />

          <div className="px-6 pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
            {/* The wordmark lives HERE while the sheet is open — the bar's copy
                has stepped aside, so this is the only one on screen. */}
            <Drawer.Title className="flex items-center gap-2.5 text-white">
              <Mark className="size-[22px]" />
              <span className="font-display text-[16px] leading-none font-bold tracking-[0.17em]">
                FREEBOARD
              </span>
            </Drawer.Title>

            <nav className="mt-6 grid">
              {NAV_ITEMS.map((l) => (
                <Drawer.Close asChild key={l.href}>
                  <a
                    href={l.href}
                    className="focus-ring-light -mx-2 rounded px-2 py-3.5 text-[19px] leading-none font-medium text-white/85 transition-colors hover:text-white"
                  >
                    {l.label}
                  </a>
                </Drawer.Close>
              ))}
              <a
                href={REPO_URL}
                className="focus-ring-light -mx-2 flex items-center gap-2.5 rounded px-2 py-3.5 text-[19px] leading-none font-medium text-white/85 transition-colors hover:text-white"
              >
                <GithubMark className="size-[17px]" />
                Source
              </a>
            </nav>

            {/* Same grouping as the bar — the one action behind a rule. */}
            <div className="mt-4 border-t border-white/12 pt-5">
              <Drawer.Close asChild>
                <a
                  href="#install"
                  className="focus-ring-light -mx-2 block rounded px-2 py-1 text-[19px] leading-none font-medium text-white transition-colors hover:text-sky-air"
                >
                  Install
                </a>
              </Drawer.Close>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
