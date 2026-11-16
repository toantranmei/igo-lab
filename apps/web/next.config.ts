import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@cl/contract', '@cl/example', '@cl/db', '@cl/pipeline', '@cl/agents', '@cl/registry', '@cl/bundle', '@cl/ingest'],
  serverExternalPackages: ['postgres', 'mammoth', 'unpdf'],
  output: 'standalone',
  outputFileTracingRoot: require('node:path').join(__dirname, '../..'),
  devIndicators: false,
};
export default config;
