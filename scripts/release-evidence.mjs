import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function stageIdFromResult(result, name) {
  const id = result?.[name]?.stageId;
  assert(typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id), 'npm returned no valid stage ID');
  return id;
}

export function assertStageMatches(result, packed) {
  const staged = result[packed.name];
  assert(staged?.name === packed.name && staged.version === packed.version && staged.integrity === packed.integrity, 'Staged package differs from the tested tarball');
}

export function assertTarballIntegrity(bytes, expected) {
  const actual = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  assert(actual === expected, 'Downloaded staged tarball integrity differs');
}

export function assertRegistryRelease(packed, integrity, latest) {
  assert(integrity === packed.integrity, 'Registry integrity differs from the published tarball');
  assert(latest === packed.version, 'Registry latest tag differs from the release version');
}
