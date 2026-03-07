import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['tldraw', '@tldraw/tldraw'],
};

export default nextConfig;
