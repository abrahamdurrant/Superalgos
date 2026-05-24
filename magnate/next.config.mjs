/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // ESLint is not installed in this project; rely on the TypeScript compiler.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
