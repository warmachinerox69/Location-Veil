'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root,f), 'utf8');

test('popup excludes requested copy while keeping required Location Guard notices in distribution', () => {
  const popup = read('popup.html');
  assert.doesNotMatch(popup, /Rare samples can land farther away|matching Location Guard’s geo-indistinguishability model/);
  assert.doesNotMatch(popup, /<footer[^>]*project-credit|Based on <a[^>]*Location Guard/);
  assert.match(read('LICENSE'), /Location Guard upstream work:/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /MIT\/X11 OR CeCILL-B/);
  assert.match(read('README.md'), /Location Guard/);
});

test('popup header loads the bundled icon as an image', () => {
  const popup = read('popup.html');
  assert.match(popup, /<img\b[^>]*class="brand-mark"[^>]*src="icons\/icon-128\.png"/);
  const icon = fs.readFileSync(path.join(root, 'icons/icon-128.png'));
  assert.equal(icon.toString('hex',0,8), '89504e470d0a1a0a');
  assert.ok(icon.length > 1000);
});

test('all explicitly declared popup font sizes are 11px or larger, including site status', () => {
  const css = read('popup.css');
  const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  assert.ok(sizes.length > 20);
  assert.ok(sizes.every(v => v >= 11), `Found font sizes under 11px: ${sizes.filter(v => v < 11)}`);
  assert.match(css, /\.site-save-status\s*\{[^}]*font-size:\s*11px/);
  assert.match(read('popup.html'), /id="siteSaveStatus"[^>]*>Changes stay on this device\.<\/small>/);
});
