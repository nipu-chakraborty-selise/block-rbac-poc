import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@seliseblocks/client"],
  devIndicators: false,
  allowedDevOrigins: ["dbzxpj.slsblx.com", "dbzxpj-erbfm.slsblx.com"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
