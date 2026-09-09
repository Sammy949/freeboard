/**
 * The analytics tag.
 *
 * BOTH VALUES COME FROM THE ENVIRONMENT, and neither is ever committed. The
 * script origin is a self-hosted host — a hostname is a fingerprint even when it
 * is not a secret — and the site id names an account on it. Locally they live in
 * `.env.production.local`; on the host they are project environment variables.
 * `.env.example` documents the shape with no values.
 *
 * `.env.production.local` rather than `.env.local` is deliberate: Next loads it
 * for `next build` and `next start` but NOT for `next dev`, so a development
 * session cannot post pageviews into real traffic. Nothing has to be remembered
 * or toggled to get that — with either variable unset this renders nothing at
 * all, which is also what makes the repo work for someone who clones it with no
 * analytics account of their own.
 *
 * A PLAIN <script defer>, NOT next/script. The tracker opens with
 * `const {currentScript: u} = document; if (!u) return;` and then reads every
 * setting off that element's own `data-` attributes. A real tag in the served
 * HTML satisfies that unconditionally. next/script's default strategy builds the
 * element client-side after hydration instead, which shifts the whole thing onto
 * `document.currentScript` being populated for a dynamically-inserted script —
 * true per spec, but not something verifiable in this environment, and not worth
 * the risk when `defer` already keeps the fetch off the critical path.
 */
export function Analytics() {
  const src = process.env.ANALYTICS_SCRIPT_URL;
  const websiteId = process.env.ANALYTICS_WEBSITE_ID;

  if (!src || !websiteId) return null;

  return <script defer src={src} data-website-id={websiteId} />;
}
