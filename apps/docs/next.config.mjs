import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  assetPrefix: '/docs',
  trailingSlash: true,
};

export default withMDX(config);
