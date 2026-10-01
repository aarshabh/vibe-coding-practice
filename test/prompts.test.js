import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIUMS, normaliseBrief, referencePrompt, mediumPrompt, NO_PEOPLE_RULE } from '../lib/prompts.js';
import { IMAGE_MODEL } from '../lib/gemini.js';

const brief = normaliseBrief({
  brandName: 'Lumen',
  description: 'A matte-white can with a gold pull tab.',
  tagline: 'Brighten every pour.',
  colors: ['#112233', 'not-a-colour'],
});

test('uses the Nano-Banana image model', () => {
  assert.equal(IMAGE_MODEL, 'gemini-2.5-flash-image');
});

test('includes billboard, newspaper and social mediums', () => {
  const ids = MEDIUMS.map((m) => m.id);
  for (const id of ['billboard', 'newspaper', 'social']) assert.ok(ids.includes(id));
});

test('every prompt forbids people', () => {
  assert.ok(referencePrompt(brief).includes(NO_PEOPLE_RULE));
  for (const m of MEDIUMS) assert.ok(mediumPrompt(brief, m).includes(NO_PEOPLE_RULE), m.id);
});

test('medium prompts lock the product to the reference', () => {
  const p = mediumPrompt(brief, MEDIUMS[0]);
  assert.match(p, /IDENTICAL object from the reference image/);
  assert.match(p, /"Lumen"/);
  assert.match(p, /Brighten every pour\./);
});

test('brief validation', () => {
  assert.deepEqual(brief.colors, ['#112233']);
  assert.throws(() => normaliseBrief({ brandName: 'X' }), /describe your product/);
  assert.throws(() => normaliseBrief({ description: 'x' }), /brand a name/);
});
