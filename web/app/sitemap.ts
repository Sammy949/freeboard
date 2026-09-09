import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** One page. Listing it is still what tells a crawler the canonical origin. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}
