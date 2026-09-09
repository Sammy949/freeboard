/**
 * The Freeboard mark: a Plimsoll disc, bisected.
 *
 * Hand-drawn, and that is deliberate — a brand mark is the one thing an icon pack
 * cannot supply. Everything else on this page that needs a glyph pulls from lucide.
 *
 * A Plimsoll line is a real, legally binding marking painted on a ship's hull: a
 * disc cut by a horizontal line that runs past it on both sides. A harbour
 * inspector reads the waterline against that line to certify the ship is not
 * overloaded WITHOUT OPENING THE HOLD. The cargo stays private, the mark is public.
 * That is this project's claim, invented in 1876.
 *
 * The full instrument carries a comb of graduated arms labelled TF/F/T/S/W/WNA. At
 * 28px those labels are illegible mush, so this is the disc alone: the part that
 * survives being small and is still unmistakably the mark.
 *
 * Geometry is on a 24-unit grid with the disc dead-centre at (12,12) — verified,
 * not eyeballed, because a mark that sits off-axis in its own box is the single
 * most repeated execution failure there is.
 */
export function Mark({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Freeboard"
      fill="none"
      {...rest}
    >
      {/* The disc. r=7 on a 24 grid leaves room for the bar to breathe past it. */}
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.75" />
      {/* The load line itself: runs the full width, past the disc on both sides,
          the way it is actually painted on a hull. Rounded caps so it reads as a
          drawn mark rather than a square-capped hairline. */}
      <path
        d="M1.5 12 H22.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
