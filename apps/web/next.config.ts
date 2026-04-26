import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@openclaw-wrapper/schemas', '@openclaw-wrapper/adapter'],
};

export default config;
