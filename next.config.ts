import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/subscription/[token]": ["./data/*.yaml", "./data/*.yml"]
  }
};

export default nextConfig;
