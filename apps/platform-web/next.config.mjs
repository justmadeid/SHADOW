/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@intelligence/contracts", "@intelligence/api-client"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  allowedDevOrigins: ["127.0.0.1"],
  // Lint runs as an explicit required workspace gate before the build.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
