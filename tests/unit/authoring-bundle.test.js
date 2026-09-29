import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('standalone authoring validates, mints ids and bumps an external file without npm', () => {
  const temp = mkdtempSync(join(tmpdir(), 'authoring-bundle-'));
  try {
    const bundle = join(temp, 'skill with spaces');
    const generator = fileURLToPath(new URL('../../scripts/bundle-authoring.mjs', import.meta.url));
    const build = spawnSync(process.execPath, [generator, bundle], { cwd: temp, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const cli = join(bundle, 'scripts/itin.mjs');
    const doc = JSON.parse(readFileSync(new URL('../../examples/paris_weekend.json', import.meta.url), 'utf8'));
    doc.trip_id = 'trip-fictional-bundle';
    doc.rev = 4;
    const file = join(temp, 'fictional trip.json');
    writeFileSync(file, JSON.stringify(doc));
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
      cwd: temp, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' },
    });
    const linkedRuns = ['.agents', '.claude'].map(discovery => {
      const directory = join(temp, discovery, 'skills');
      mkdirSync(directory, { recursive: true });
      const link = join(directory, 'itinerary-authoring');
      symlinkSync(bundle, link, 'dir');
      return (...args) => spawnSync(process.execPath, [join(link, 'scripts/itin.mjs'), ...args], {
        cwd: temp, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' },
      });
    });
    for (const linkedRun of linkedRuns) {
      const digest = linkedRun('digest', file);
      assert.equal(digest.status, 0, digest.stderr);
      assert.match(digest.stdout, /Paris Weekend/);
      assert.equal(digest.stdout, run('digest', file).stdout);
      const valid = linkedRun('validate', file, '--strict');
      assert.equal(valid.status, 0, valid.stderr);
      assert.ok(valid.stdout.trim(), 'validation must actually execute through discovery links');
    }
    assert.equal(run('validate', file, '--strict').status, 0);
    const ids = run('ids', file, 'seg', '2');
    assert.equal(ids.status, 0, ids.stderr);
    const minted = ids.stdout.trim().split(/\s+/);
    assert.equal(new Set(minted).size, 2);
    assert.ok(minted.every(id => id.startsWith('seg-')));
    const bumped = run('bump', file);
    assert.equal(bumped.status, 0, bumped.stderr);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(after.rev, doc.rev + 1);
    assert.equal(after.trip_id, doc.trip_id);
    assert.equal(run('validate', file, '--strict').status, 0);
    delete after.trip.currency_primary;
    writeFileSync(file, JSON.stringify(after));
    assert.equal(run('validate', file).status, 1);
    for (const linkedRun of linkedRuns) {
      const invalid = linkedRun('validate', file);
      assert.equal(invalid.status, 1, 'invalid files must fail through discovery links');
      assert.match(invalid.stdout + invalid.stderr, /currency_primary/);
    }
    assert.equal(run('doctrine', '--write').status, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
