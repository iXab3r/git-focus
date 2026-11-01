import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stageIdFromResult, assertStageMatches, assertTarballIntegrity, assertRegistryRelease } from '../scripts/release-evidence.mjs';

const bytes = Buffer.from('tested release tarball');
const packed = { name: 'git-focus', version: '0.1.1', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
const id = '12345678-1234-1234-1234-123456789abc';
const result = { 'git-focus': { ...packed, stageId: id } };

test('stage receipt requires npm package-keyed JSON and a valid stage ID', () => {
  assert.equal(stageIdFromResult(result, packed.name), id);
  for (const invalid of [null, {}, { stageId: id }, { 'git-focus': { stageId: '' } }, { 'other': result['git-focus'] }])
    assert.throws(() => stageIdFromResult(invalid, packed.name));
});

test('a stage for another version or tarball cannot pass verification', () => {
  assertStageMatches(result, packed);
  for (const changed of [{ name: 'other' }, { version: '0.0.0-stage' }, { integrity: 'sha512-other' }])
    assert.throws(() => assertStageMatches({ 'git-focus': { ...result['git-focus'], ...changed } }, packed));
});

test('downloaded staging content must match the tested tarball bytes', () => {
  assertTarballIntegrity(bytes, packed.integrity);
  assert.throws(() => assertTarballIntegrity(Buffer.from('changed tarball'), packed.integrity));
});

test('placeholder/latest and integrity both gate a published release', () => {
  assertRegistryRelease(packed, packed.integrity, packed.version);
  assert.throws(() => assertRegistryRelease(packed, packed.integrity, '0.0.0-stage'));
  assert.throws(() => assertRegistryRelease(packed, 'sha512-other', packed.version));
});
