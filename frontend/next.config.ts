import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The dev-only "N" badge sits on top of the mobile bottom nav.
  devIndicators: false,
};

export default nextConfig;
