import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this app. Without this, Next picks
  // /opt/lampp/htdocs/package-lock.json and watches the entire htdocs tree.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Allow local LAN access to the Next.js 16 dev server without blocking API fetches.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "10.220.119.203",
    "192.168.1.4",
  ],
};

export default nextConfig;
