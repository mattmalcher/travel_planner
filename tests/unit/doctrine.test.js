// The authoring doctrine (src/lib/doctrine.js) is rendered into two places: the
// in-app assistant's system prompt, and the desktop authoring skill's SKILL.md.
// Nothing at runtime would notice if one of those went stale, and the repo has
// already been bitten by exactly that — the find-stop skill kept
// telling readers to write "station" for two schema versions after it became
// "place". So the drift check lives here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DOCTRINE, SCOPES, renderDoctrine } from '../../src/lib/doctrine.js';
import { doctrineBlock } from '../../scripts/itin.mjs';

const SKILL = new URL('../../.claude/skills/itinerary-authoring/SKILL.md', import.meta.url);

test('every entry has a usable id, scope and text', () => {
  assert.ok(DOCTRINE.length > 0);
  for (const rule of DOCTRINE) {
    assert.ok(rule.id && typeof rule.id === 'string', `bad id: ${JSON.stringify(rule)}`);
    assert.ok(SCOPES.includes(rule.scope), `bad scope "${rule.scope}" on "${rule.id}"`);
    assert.equal(typeof rule.text, 'string');
    assert.ok(rule.text.trim().length > 0, `empty text on "${rule.id}"`);
    // A rule rendered as a bullet must not contain its own newlines.
    assert.ok(!rule.text.includes('\n'), `"${rule.id}" spans lines`);
  }
});

test('an id is used at most once per scope', () => {
  const seen = new Set();
  for (const rule of DOCTRINE) {
    const key = `${rule.scope}:${rule.id}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
  }
});

test('both surfaces get every shared rule', () => {
  const app = renderDoctrine('app');
  const desktop = renderDoctrine('desktop');
  for (const rule of DOCTRINE.filter(r => r.scope === 'both')) {
    assert.ok(app.includes(rule.text), `app render is missing shared rule "${rule.id}"`);
    assert.ok(desktop.includes(rule.text), `desktop render is missing shared rule "${rule.id}"`);
  }
});

test('a surface never sees the other surface\'s rules', () => {
  const app = renderDoctrine('app');
  const desktop = renderDoctrine('desktop');
  for (const rule of DOCTRINE.filter(r => r.scope === 'desktop'))
    assert.ok(!app.includes(rule.text), `desktop-only rule "${rule.id}" leaked into the prompt`);
  for (const rule of DOCTRINE.filter(r => r.scope === 'app'))
    assert.ok(!desktop.includes(rule.text), `app-only rule "${rule.id}" leaked into the skill`);
});

test('every rendered line is a bullet, in array order', () => {
  for (const target of ['app', 'desktop']) {
    const lines = renderDoctrine(target).split('\n');
    for (const line of lines) assert.ok(line.startsWith('- '), `${target}: "${line}"`);
    const order = DOCTRINE.filter(r => r.scope === 'both' || r.scope === target).map(r => '- ' + r.text);
    assert.deepEqual(lines, order);
  }
});

test('an unknown target throws rather than rendering nothing', () => {
  assert.throws(() => renderDoctrine('mobile'), /unknown target/);
  assert.throws(() => renderDoctrine(), /unknown target/);
});

// The point of the whole exercise: the prompt must be assembled from the module,
// not from a copy of the rules that drifted out of it.
test("the assistant's system prompt renders the app doctrine verbatim", async () => {
  globalThis.window = globalThis.window || {};
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
  const { buildSystem } = await import('../../src/ai/prompt.js');

  const prompt = buildSystem();
  assert.ok(prompt.includes(renderDoctrine('app')),
    'buildSystem() no longer contains renderDoctrine("app") — the prompt and lib/doctrine.js have diverged');
  // And the mobile-only rules are still actually in there, since dropping one
  // would be a silent regression of the in-app editor.
  for (const rule of DOCTRINE.filter(r => r.scope === 'app'))
    assert.ok(prompt.includes(rule.text), `the prompt lost app rule "${rule.id}"`);
});

test('the SKILL.md doctrine block matches the module', () => {
  const md = readFileSync(SKILL, 'utf8');
  assert.ok(md.includes(doctrineBlock()),
    'the doctrine block in .claude/skills/itinerary-authoring/SKILL.md is stale — run `npm run itin -- doctrine --write`');
});

test('SKILL.md has exactly one pair of doctrine markers', () => {
  const md = readFileSync(SKILL, 'utf8');
  assert.equal(md.split('<!-- doctrine:begin').length - 1, 1);
  assert.equal(md.split('<!-- doctrine:end -->').length - 1, 1);
});
