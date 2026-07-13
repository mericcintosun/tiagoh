import type { MetadataRoute } from "next";

const BASE_URL = "https://tiagoh.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const routes = [
    { path: "/", priority: 1 },
    { path: "/dashboard", priority: 0.9 },
    { path: "/explorer", priority: 0.8 },
    { path: "/auction", priority: 0.8 },
    { path: "/disputes", priority: 0.8 },
    { path: "/playground", priority: 0.8 },
  ];

  return routes.map(({ path, priority }) => ({
    url: path === "/" ? BASE_URL : `${BASE_URL}${path}`,
    lastModified,
    changeFrequency: "weekly",
    priority,
  }));
}
