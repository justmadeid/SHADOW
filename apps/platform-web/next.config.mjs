/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  // Lint runs as an explicit required workspace gate before the build.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
