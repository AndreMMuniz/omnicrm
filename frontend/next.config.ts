import { withVisualEdit as withBefreeVisualEdit } from 'befree-visual-edit/next';

import type { NextConfig } from "next";
import path from "node:path";

function buildRemotePatterns() {
  const patterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
    { protocol: "http", hostname: "localhost", port: "8000", pathname: "/**" },
    { protocol: "https", hostname: "localhost", port: "8000", pathname: "/**" },
    { protocol: "http", hostname: "127.0.0.1", port: "8000", pathname: "/**" },
    { protocol: "https", hostname: "127.0.0.1", port: "8000", pathname: "/**" },
  ];

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return patterns;

  try {
    const parsed = new URL(apiUrl);
    patterns.push({
      protocol: parsed.protocol.replace(":", "") as "http" | "https",
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: "/**",
    });
  } catch {
    // Ignore invalid env values and keep safe local defaults.
  }

  return patterns;
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: buildRemotePatterns(),
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) return [];

    const destinationBase = apiUrl.replace(/\/api\/v1\/?$/, "");

    return [
      {
        source: "/api/v1/:path*",
        destination: `${destinationBase}/api/v1/:path*`,
      },
    ];
  },
};

export default withBefreeVisualEdit(nextConfig);
