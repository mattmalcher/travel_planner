import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLine, toolPhrase } from '../../src/lib/ai-status.js';

test('a tool becomes a phrase, singular or counted', () => {
  assert.equal(toolPhrase('get_segment'), 'reading the segment');
  assert.equal(toolPhrase('get_segment', 3), 'reading 3 segments');
  assert.equal(toolPhrase('patch_phrase_group', 2), 'updating 2 phrase groups');
  assert.equal(toolPhrase('update_trip'), 'replacing the trip');
});

test('an unknown tool name still gets a sentence', () => {
  assert.equal(toolPhrase('do_something_new'), 'running do_something_new');
  assert.equal(toolPhrase('do_something_new', 2), 'running do_something_new 2 times');
});

test('the first step has nothing behind it yet', () => {
  assert.equal(statusLine(1, 12, []), 'Thinking…');
});

test('a later step with no tools still says where the turn is', () => {
  assert.equal(statusLine(4, 12, []), 'Thinking… (step 4 of 12)');
});

test('the previous step\'s tools lead the line, capitalised', () => {
  assert.equal(statusLine(2, 12, ['get_segment']), 'Reading the segment… (step 2 of 12)');
});

test('repeats are counted and distinct tools kept in call order', () => {
  assert.equal(
    statusLine(3, 12, ['get_segment', 'get_segment', 'patch_trip']),
    'Reading 2 segments, updating the trip… (step 3 of 12)');
});

test('a missing tool name is skipped rather than breaking the line', () => {
  assert.equal(statusLine(2, 12, [undefined, 'add_list']), 'Adding the list… (step 2 of 12)');
  assert.equal(statusLine(2, 12, [undefined]), 'Thinking… (step 2 of 12)');
});
