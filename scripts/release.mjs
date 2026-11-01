import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (bin, args, options = {}) => execFileSync(bin, args, { stdio: 'inherit', ...options });
const capture = (bin, args) => execFileSync(bin, args, { encoding: 'utf8' }).trim();
const mode = process.env.RELEASE_MODE ?? 'dry-run';
assert(['dry-run', 'publish'].includes(mode), 'RELEASE_MODE must be dry-run or publish');
const revision = capture('git', ['rev-parse', 'HEAD']);
assert(process.env.RELEASE_REVISION === revision, 'RELEASE_REVISION must equal the checked out commit');
assert(capture('git', ['status', '--porcelain']) === '', 'Release requires a clean checkout');
if (mode === 'publish') {
  const main = capture('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
  assert(main === revision, 'Publish requires the current main revision');
  assert(process.env.NPM_TOKEN, 'Configure a protected env.NPM_TOKEN in TeamCity');
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
  const evidence = { revision, mode, name: packed.name, version: packed.version, integrity: packed.integrity };
  fs.mkdirSync('release-artifacts', { recursive: true });
  fs.copyFileSync(tarball, path.join('release-artifacts', packed.filename));
  if (mode === 'publish') {
    const npmrc = path.join(dir, '.npmrc');
    fs.writeFileSync(npmrc, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n', { mode: 0o600 });
    run(npm, ['publish', tarball, '--access', 'public', '--tag', 'latest', '--registry', 'https://registry.npmjs.org/'],
      { env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc } });
    const published = JSON.parse(capture(npm, ['view', `${packed.name}@${packed.version}`, 'dist.integrity', '--json', '--registry', 'https://registry.npmjs.org/']));
    assert(published === packed.integrity, 'Registry integrity differs from the published tarball');
  }
  fs.writeFileSync('release-artifacts/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
