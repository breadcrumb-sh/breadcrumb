import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development';

const config = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  ...(!isDev && {
    output: 'export',
    assetPrefix: '/docs',
    trailingSlash: true,
  }),
};

export default withMDX(config);
