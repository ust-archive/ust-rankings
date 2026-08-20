/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    "/rankings/instructors": [
      "./rankings/seed/**/*",
      "./data/data-course-catalog.json",
    ],
    "/rankings/courses": [
      "./rankings/seed/**/*",
      "./data/data-course-catalog.json",
    ],
  },
};

export default nextConfig;
