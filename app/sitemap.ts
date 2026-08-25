import type { MetadataRoute } from "next";
import {
  currentServerIndex,
  ServerIndexUnavailableError,
} from "@/lib/server-index";

export const dynamic = "force-dynamic";

const origin = "https://ust-rankings.com";
const paths = [
  "/rankings/instructors",
  "/rankings/courses",
  "/schedule",
  "/faq",
  "/privacy",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let detailPaths: string[] = [];
  try {
    detailPaths = (await currentServerIndex()).canonicalDetailPaths();
  } catch (error) {
    if (!(error instanceof ServerIndexUnavailableError)) throw error;
  }
  return [...paths, ...detailPaths].map((path) => ({
    url: `${origin}${path}`,
  }));
}
