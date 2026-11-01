import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const bin = path.resolve(process.argv[2]);
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-focus-smoke-'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
const cli = (...args) => execFileSync(bin, [...args, '--repo', repo], { encoding: 'utf8' });
const exists = file => fs.existsSync(path.join(repo, file));
try {
  fs.mkdirSync(path.join(repo, 'src/a'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/b'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src/a/file'), 'a');
  fs.writeFileSync(path.join(repo, 'src/b/file'), 'b');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'target/\n');
  git('init'); git('config', 'user.name', 'Release Smoke'); git('config', 'user.email', 'smoke@example.invalid');
  git('add', '.'); git('commit', '-m', 'fixture');
  fs.mkdirSync(path.join(repo, 'target')); fs.writeFileSync(path.join(repo, 'target/cache'), 'cache');
  cli('exclude', 'src', '--dry-run');
  assert(exists('src/a/file') && !exists('.git/info/sparse-checkout'));
  cli('exclude', 'src'); assert(!exists('src/a/file') && !exists('src/b/file'));
  cli('include', 'src/a'); assert(exists('src/a/file') && !exists('src/b/file'));
  assert.match(cli('status'), /focused/);
  cli('full'); assert(exists('src/b/file') && exists('target/cache'));
  fs.writeFileSync(path.join(repo, 'src/a/local'), 'local');
  const rejected = spawnSync(bin, ['exclude', 'src/a', '--repo', repo], { encoding: 'utf8' });
  assert(rejected.status !== 0 && exists('src/a/file') && exists('src/a/local'));
  assert.match(cli('status'), /full/);
  console.log('Installed bin smoke passed: dry-run, exclude, include, status, full, dirty gate, ignored cache');
} finally { fs.rmSync(repo, { recursive: true, force: true }); }
