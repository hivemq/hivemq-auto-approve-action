import * as github from '@actions/github';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect } from 'vitest';
import { isActiveMember } from './membership';

async function isActiveMemberWithResponse(status: number, body: unknown): Promise<boolean> {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const octokit = github.getOctokit('token', { baseUrl: `http://127.0.0.1:${port}` });
    return await isActiveMember(octokit, 'org', 'team', 'user');
  } finally {
    server.close();
  }
}

describe('isActiveMember', () => {
  it('accepts an active membership', async () => {
    expect(await isActiveMemberWithResponse(200, { state: 'active' })).toBe(true);
  });

  it('rejects a pending membership', async () => {
    expect(await isActiveMemberWithResponse(200, { state: 'pending' })).toBe(false);
  });

  it('treats 404 as not a member', async () => {
    expect(await isActiveMemberWithResponse(404, { message: 'Not Found' })).toBe(false);
  });

  it('fails on any other error', async () => {
    await expect(isActiveMemberWithResponse(403, { message: 'Forbidden' })).rejects.toThrow('Forbidden');
  });
});
