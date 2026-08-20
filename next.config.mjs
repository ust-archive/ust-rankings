/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    "/rankings/instructors": ["./rankings/seed/**/*"],
  },
};

export default nextConfig;
