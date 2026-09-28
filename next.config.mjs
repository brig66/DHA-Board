/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdfjs-dist (used by react-pdf) optionally imports the Node "canvas"
    // package for server-side rendering, which we don't use in the browser.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
