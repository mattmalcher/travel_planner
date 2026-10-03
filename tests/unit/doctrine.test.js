// The authoring doctrine (src/lib/doctrine.js) is rendered into the in-app
// assistant's system prompt, the desktop authoring skill's SKILL.md and, from
// the vendored copy, the travel plugin's MCP instructions.
// Nothing at runtime would notice if one of those went stale, and the repo has
// already been bitten by exactly that — the find-stop skill kept
// telling readers to write "station" for two schema versions after it became
// "place". So the drift check lives here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DOCTRINE, SURFACES, reaches, renderDoctrine } from '../../src/lib/doctrine.js';
import { doctrineBlock } from '../../scripts/itin.mjs';

const SKILL = new URL('../../.agents/skills/itinerary-authoring/SKILL.md', import.meta.url);

const scopeOk = scope => scope === 'all' || SURFACES.includes(scope)
  || (Array.isArray(scope) && scope.length > 0 && scope.every(s => SURFACES.includes(s)));

test('every entry has a usable id, scope and text', () => {
  assert.ok(DOCTRINE.length > 0);
  for (const rule of DOCTRINE) {
    assert.ok(rule.id && typeof rule.id === 'string', `bad id: ${JSON.stringify(rule)}`);
    assert.ok(scopeOk(rule.scope), `bad scope ${JSON.stringify(rule.scope)} on "${rule.id}"`);
    assert.equal(typeof rule.text, 'string');
    assert.ok(rule.text.trim().length > 0, `empty text on "${rule.id}"`);
    // A rule rendered as a bullet must not contain its own newlines.
    assert.ok(!rule.text.includes('\n'), `"${rule.id}" spans lines`);
  }
});

// A shared ('all') rule may have a per-surface tail under the same id, but an
// id never appears twice under one scope value.
test('an id is used at most once per scope', () => {
  const seen = new Set();
  for (const rule of DOCTRINE) {
    for (const scope of [].concat(rule.scope)) {
      const key = `${scope}:${rule.id}`;
      assert.ok(!seen.has(key), `duplicate ${key}`);
      seen.add(key);
    }
  }
});

test('every surface gets every shared rule', () => {
  for (const surface of SURFACES) {
    const rendered = renderDoctrine(surface);
    for (const rule of DOCTRINE.filter(r => r.scope === 'all'))
      assert.ok(rendered.includes(rule.text), `${surface} render is missing shared rule "${rule.id}"`);
  }
});

test('a surface never sees rules scoped away from it', () => {
  for (const surface of SURFACES) {
    const rendered = renderDoctrine(surface);
    for (const rule of DOCTRINE.filter(r => !reaches(r, surface)))
      assert.ok(!rendered.includes(rule.text), `"${rule.id}" leaked into the ${surface} render`);
  }
});

// The digest and read-before-edit rules are mitigations for a model that sees
// a digest. The desktop has the file and an MCP host returns whole documents,
// so neither may tell its reader to read-before-edit or mention a digest view.
test('only the app is told it sees a digest or must read before editing', () => {
  for (const id of ['digest', 'read-before-edit']) {
    const rule = DOCTRINE.find(r => r.id === id);
    assert.deepEqual(SURFACES.filter(s => reaches(rule, s)), ['app'], id);
  }
  assert.ok(!/read-before-edit|get_list before|get_phrase_group it/.test(renderDoctrine('mcp')));
});

test('every rendered line is a bullet, in array order', () => {
  for (const target of SURFACES) {
    const lines = renderDoctrine(target).split('\n');
    for (const line of lines) assert.ok(line.startsWith('- '), `${target}: "${line}"`);
    const order = DOCTRINE.filter(r => reaches(r, target)).map(r => '- ' + r.text);
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
  for (const rule of DOCTRINE.filter(r => reaches(r, 'app')))
    assert.ok(prompt.includes(rule.text), `the prompt lost app rule "${rule.id}"`);
});

test('the SKILL.md doctrine block matches the module', () => {
  const md = readFileSync(SKILL, 'utf8');
  assert.ok(md.includes(doctrineBlock()),
    'the doctrine block in .agents/skills/itinerary-authoring/SKILL.md is stale — run `npm run itin -- doctrine --write`');
});

test('SKILL.md has exactly one pair of doctrine markers', () => {
  const md = readFileSync(SKILL, 'utf8');
  assert.equal(md.split('<!-- doctrine:begin').length - 1, 1);
  assert.equal(md.split('<!-- doctrine:end -->').length - 1, 1);
});
