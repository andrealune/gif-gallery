/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // GIF sources today: Tenor-hosted URLs (server/src/services/tenor) and, once L42-425 lands,
  // our own storage bucket/CDN. Remote hosts aren't finalized yet, so <GifCard> renders a plain
  // <img> instead of next/image (which requires each remote host to be allow-listed here). Revisit
  // once storage is settled - swapping to next/image then gets us automatic resizing/optimization.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
