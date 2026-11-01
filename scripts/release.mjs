import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stageIdFromResult, assertStageMatches, assertTarballIntegrity, assertRegistryRelease } from './release-evidence.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (bin, args, options = {}) => execFileSync(bin, args, { stdio: 'inherit', ...options });
const capture = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', ...options }).trim();
const mode = process.env.RELEASE_MODE ?? 'dry-run';
// This directory is build output; stale receipts must not survive an early failure.
fs.rmSync('release-artifacts/evidence.json', { force: true });
assert(['dry-run', 'stage', 'verify'].includes(mode), 'RELEASE_MODE must be dry-run, stage or verify');
const revision = capture('git', ['rev-parse', 'HEAD']);
assert(process.env.RELEASE_REVISION === revision, 'RELEASE_REVISION must equal the checked out commit');
assert(capture('git', ['status', '--porcelain']) === '', 'Release requires a clean checkout');
if (mode === 'stage') {
  const main = capture('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
  assert(main === revision, 'Staging requires the current main revision');
  assert(process.env.NPM_TOKEN, 'Configure a protected env.NPM_TOKEN in TeamCity');
  const [major, minor] = capture(npm, ['--version']).split('.').map(Number);
  assert(major > 11 || (major === 11 && minor >= 15), 'Staging requires npm >=11.15.0');
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  assert(nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 14), 'Staging requires Node >=22.14.0');
}
run(npm, ['ci']);
run(npm, ['run', 'typecheck']);
run(npm, ['run', 'bundle']);
run(npm, ['test']);
run('git', ['diff', '--exit-code', '--', 'dist/cli.js', 'dist/cli.js.map']);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-focus-release-'));
try {
  const packed = JSON.parse(capture(npm, ['pack', '--json', '--pack-destination', dir]))[0];
  assert(packed.name === 'git-focus');
  for (const file of ['dist/cli.js', '.gitignore-focus-whitelist', '.agents/skills/git-focus/SKILL.md'])
    assert(packed.files.some(f => f.path === file), `Missing package file: ${file}`);
  const tarball = path.join(dir, packed.filename);
  run(npm, ['install', '--prefix', path.join(dir, 'install'), '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  run(process.execPath, [path.join(dir, 'install/node_modules/git-focus/dist/cli.js'), 'exclude', '--help']);
  run(process.execPath, ['scripts/smoke.mjs', path.join(dir, 'install/node_modules/.bin/git-focus')]);
  const evidence = { revision, mode, name: packed.name, version: packed.version, integrity: packed.integrity, status: 'verified-tarball' };
  fs.mkdirSync('release-artifacts', { recursive: true });
  // Never retain a previous build's receipt when this release attempt fails.
  const writeEvidence = () => fs.writeFileSync('release-artifacts/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  fs.copyFileSync(tarball, path.join('release-artifacts', packed.filename));
  if (mode === 'stage') {
    const npmrc = path.join(dir, '.npmrc');
    fs.writeFileSync(npmrc, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n', { mode: 0o600 });
    const options = { env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc } };
    const result = JSON.parse(capture(npm, ['stage', 'publish', tarball, '--json', '--access', 'public', '--tag', 'latest', '--registry', 'https://registry.npmjs.org/'], options));
    const stageId = stageIdFromResult(result, packed.name);
    Object.assign(evidence, { stageId, status: 'staged-unverified' });
    writeEvidence(); // Preserve the stage ID even if verification below fails; do not re-stage blindly.
    assertStageMatches(result, packed);
    const download = path.join(dir, 'staged');
    fs.mkdirSync(download);
    run(npm, ['stage', 'download', stageId, '--registry', 'https://registry.npmjs.org/'], { ...options, cwd: download });
    const files = fs.readdirSync(download).filter(file => file.endsWith('.tgz'));
    assert(files.length === 1, 'Expected one staged tarball');
    assertTarballIntegrity(fs.readFileSync(path.join(download, files[0])), packed.integrity);
    evidence.status = 'awaiting-2fa-approval';
    console.log(`Stage ${stageId} is verified. Approve in npm Staged Packages with 2FA, then run RELEASE_MODE=verify. This is not a published release.`);
  }
  if (mode === 'verify') {
    const published = JSON.parse(capture(npm, ['view', `${packed.name}@${packed.version}`, 'dist.integrity', '--json', '--registry', 'https://registry.npmjs.org/']));
    const latest = JSON.parse(capture(npm, ['view', packed.name, 'dist-tags.latest', '--json', '--registry', 'https://registry.npmjs.org/']));
    assertRegistryRelease(packed, published, latest);
    const prefix = path.join(dir, 'registry-install');
    run(npm, ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `${packed.name}@${packed.version}`, '--registry', 'https://registry.npmjs.org/']);
    const lock = JSON.parse(fs.readFileSync(path.join(prefix, 'package-lock.json'), 'utf8'));
    assert(lock.packages[`node_modules/${packed.name}`].integrity === packed.integrity, 'Registry installation integrity differs');
    run(process.execPath, ['scripts/smoke.mjs', path.join(prefix, 'node_modules/.bin/git-focus')]);
    evidence.status = 'published-verified';
  }
  writeEvidence();
  console.log(JSON.stringify(evidence));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
