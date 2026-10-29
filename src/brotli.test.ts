import * as github from '@actions/github';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { disableBrotli } from './brotli';

describe('disableBrotli', () => {
  it('does not ask for Brotli', async () => {
    let acceptEncoding: string | undefined;
    const server = createServer((req, res) => {
      acceptEncoding = req.headers['accept-encoding'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const octokit = github.getOctokit('token', { baseUrl: `http://127.0.0.1:${port}` });
      disableBrotli(octokit);

      await octokit.request('GET /');
      expect(acceptEncoding).toBe('gzip');
    } finally {
      server.close();
    }
  });

  it('rejects a response that announces Brotli', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' });
      res.end(zlib.brotliCompressSync('{}'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const octokit = github.getOctokit('token', { baseUrl: `http://127.0.0.1:${port}` });
      disableBrotli(octokit);

      await expect(octokit.request('GET /')).rejects.toThrow('Brotli decoding is disabled');
    } finally {
      server.close();
    }
  });
});
