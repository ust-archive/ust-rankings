/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  async headers() {
    return [
      {
        source: "/duckdb/1.32.0/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "worker-src 'self' blob:",
          },
        ],
      },
    ];
  },
  typescript: { tsconfigPath: "tsconfig.runtime.json" },
};

export default nextConfig;
