import path from "node:path";
import type { NextConfig } from "next";

/**
 * `turbopack.root` is pinned to this directory on purpose.
 *
 * The repo root is the Freeboard CLI, which has its own package-lock.json, so
 * Turbopack found two lockfiles and inferred the workspace root one level up.
 * That warned on every build and risked resolving modules against the CLI's
 * dependency tree rather than this app's. The landing page is a standalone
 * Next project that happens to live inside the CLI repo; this says so.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
