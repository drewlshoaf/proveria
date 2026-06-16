import type { NextConfig } from 'next';

const API_ORIGIN =
  process.env.VERIFIER_API_ORIGIN ?? 'http://127.0.0.1:3001';

const config: NextConfig = {
  transpilePackages: ['@proveria/ui', '@proveria/shared-types'],
  reactStrictMode: true,
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      ...webpackConfig.resolve.extensionAlias,
    };
    return webpackConfig;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
};

export default config;
