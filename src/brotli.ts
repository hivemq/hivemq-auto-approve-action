import type * as github from '@actions/github';
import zlib from 'node:zlib';

// GitHub's API answers with gzip, so Brotli is neither requested nor decoded: a
// response that announces it anyway fails its request before any byte reaches
// Node's Brotli decoder. The zlib patch applies to the whole process.
export function disableBrotli(octokit: ReturnType<typeof github.getOctokit>): void {
  Object.defineProperty(zlib, 'createBrotliDecompress', {
    value: () => {
      throw new Error('Brotli decoding is disabled');
    },
  });
  octokit.hook.before('request', (options) => {
    options.headers['accept-encoding'] = 'gzip';
  });
}
