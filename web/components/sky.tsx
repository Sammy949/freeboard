/**
 * The atmosphere. A looping sky behind the whole first screen.
 *
 * THREE THINGS WERE DONE TO THE SOURCE FILE, and each fixes a real defect that
 * would otherwise ship:
 *
 * 1. IT IS FLIPPED. The original runs light at the top (#b2d7fe) and saturated
 *    at the bottom (#1a72e4) — exactly upside down for a hero, because the deep
 *    end would have had to meet the white page and no feather survives that.
 *    Flipped, the deep sits behind the type where white reads, and the pale band
 *    is what touches the page, so the hand-off is nearly free.
 *
 * 2. IT PING-PONGS. The source does not loop: frame 119 → frame 0 measured a
 *    mean absolute difference of 7.86/255, LARGER than the 5.19 across half the
 *    clip, so `loop` snapped visibly every four seconds. It is now forward plus
 *    reverse (238 frames, 7.9s), and the seam measures 0.49/255 — codec noise.
 *
 * 3. IT IS GRAINED. A four-second soft gradient is exactly the footage h264
 *    bands, and a banded gradient reads as cheap. Fine temporal noise is dithered
 *    in at encode time, which both kills the banding and gives the surface a
 *    physical quality. 181KB webm, 1.1MB mp4 fallback.
 *
 * The poster frame is the CONTAINER's background, not the video's `poster`
 * attribute, so the sky is present before the video loads, if it never loads,
 * and under prefers-reduced-motion where the video element is removed outright.
 * Nothing on this page is gated on the video playing.
 */
export function Sky({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`sky-mask absolute inset-0 -z-10 overflow-hidden bg-[#0e58ba] bg-cover bg-[position:50%_50%] ${className}`}
      style={{ backgroundImage: "url(/sky-poster.jpg)" }}
    >
      <video
        className="sky-motion absolute inset-0 size-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      >
        <source src="/sky.webm" type="video/webm" />
        <source src="/sky.mp4" type="video/mp4" />
      </video>

      {/* Deepens the sky's own blue behind the type instead of laying black over
          it. Transparent well before the mask's feather, so neither ever ends
          at an edge as a band. */}
      <div className="sky-scrim absolute inset-0" />
    </div>
  );
}
