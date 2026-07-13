/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // The dashboard is read-only (public RPC via viem/wagmi). Stub Node-only
    // built-ins so any server-oriented transitive dep never breaks the browser
    // bundle. viem is browser-first (Web Crypto, pure-JS noble), so none are needed.
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
