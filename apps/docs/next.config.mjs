import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development';

const config = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  basePath: '/docs',
  trailingSlash: true,
  ...(!isDev ? {
    output: 'export',
  } : {}),
};

export default withMDX(config);
