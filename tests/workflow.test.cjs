const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release workflow pins a valid SHA-256 fingerprint matching the documented signing certificate', () => {
  const root = path.join(__dirname, '..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/android-release.yml'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const pinned = workflow.match(/certificate SHA-256 digest: ([0-9a-f]+)/)?.[1];
  const documented = readme.match(/fingerprint is `([0-9A-F:]+)`/)?.[1].replaceAll(':', '').toLowerCase();
  assert.match(pinned ?? '', /^[0-9a-f]{64}$/, 'SHA-256 fingerprint must contain exactly 64 hex digits');
  assert.equal(pinned, documented, 'workflow must use the documented release certificate');
});
