/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["ui", "config", "db-types"],
  experimental: {
    serverActions: true,
  },
}

module.exports = nextConfig