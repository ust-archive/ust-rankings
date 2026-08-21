/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    "/rankings/instructors": ["./data/data-course-catalog.json"],
    "/rankings/courses": ["./data/data-course-catalog.json"],
    "/schedule": ["./schedule/seed/**/*"],
  },
};

export default nextConfig;
