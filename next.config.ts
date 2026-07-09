import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/subscription/[token]": ["./data/*.yaml", "./data/*.yml", "./data/*.txt"]
  }
};

export default nextConfig;
