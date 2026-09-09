/**
 * The canonical origin, for absolute Open Graph and canonical URLs.
 *
 * Read from the environment, because it is deployment configuration and not a
 * fact about the project. Set NEXT_PUBLIC_SITE_URL at build time; see
 * .env.example. Vercel supplies VERCEL_PROJECT_PRODUCTION_URL on its own, which
 * is used as a fallback so a preview deploy still emits usable absolute URLs.
 *
 * The last fallback is localhost, and that is deliberate: a wrong absolute
 * origin baked into a social card is worse than an obviously-local one, because
 * it fails silently and points crawlers somewhere that is not yours.
 */
function origin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

export const SITE_URL = origin();
