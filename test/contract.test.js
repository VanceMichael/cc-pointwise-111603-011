import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { startSource } from '../source/server.js';
import { parsePage, entryPath } from '../src/adapter.js';
import { SourceClient } from '../src/source-client.js';

async function observe(stage = 'opening', path = entryPath) {
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  try {
    source.publish(stage);
    return parsePage(await new SourceClient(source.url).read(path));
  } finally { await source.close(); }
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

test('permit source exposes a correction and an explicit revocation relation', async () => {
  const grant = (await observe()).records[0].attributes;
  const correction = (await observe('updated')).records[0].attributes;
  const revocation = (await observe('revoked')).records[0].attributes;
  assert.equal(correction.replaces, grant.noticeId);
  assert.equal(revocation.replaces, correction.noticeId);
  assert.equal(revocation.action, 'revoke');
  assert.equal(grant.permitId, revocation.permitId);
});
