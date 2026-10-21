const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/android-release.yml'), 'utf8');
const helper = path.join(root, 'scripts/verify-android-release.sh');
const fingerprint = '02dec5122a527db623e069c703cf74d558389646f8c58fa685871f54c52b25df';

test('release workflow pins a valid SHA-256 fingerprint matching the documented signing certificate', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const pinned = fs.readFileSync(helper, 'utf8').match(/expected_fingerprint=([0-9a-f]+)/)?.[1];
  const documented = readme.match(/fingerprint is `([0-9A-F:]+)`/)?.[1].replaceAll(':', '').toLowerCase();
  assert.match(pinned ?? '', /^[0-9a-f]{64}$/, 'SHA-256 fingerprint must contain exactly 64 hex digits');
  assert.equal(pinned, documented, 'workflow must use the documented release certificate');
});

test('manual runs use main workflow and exact tag source without exposing signing secrets', () => {
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+release_tag:\s+description:.*\n\s+required: true/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/);
  assert.match(workflow, /\[\[ "\$RELEASE_TAG" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /cp scripts\/verify-android-release\.sh "\$RUNNER_TEMP\/verify-android-release\.sh"/);
  assert.match(workflow, /ref: \$\{\{ env\.RELEASE_TAG \}\}\s+persist-credentials: false/);
  assert.match(workflow, /verify-android-release\.sh\}" source/);
  assert.match(workflow, /cloudreve-unsigned-build-\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@v4\s+with:\s+name: cloudreve-public-diagnostics-/);
  assert.match(workflow, /cloudreve-android-\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /gh release create "\$RELEASE_TAG".*--verify-tag/);
  assert.equal((workflow.match(/GH_TOKEN:/g) || []).length, 1);
  assert.equal((workflow.match(/ANDROID_KEYSTORE_BASE64:/g) || []).length, 1);
  assert.doesNotMatch(workflow, /\bset -x\b/);
});

test('public diagnostics precede strict signature and package/version checks', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'android-release-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ expo: { version: '1.0.3', android: { package: 'example.app', versionCode: 4 } } }));
    fs.writeFileSync(path.join(dir, 'Cloudreve.apk'), 'fixture, not a real APK');
    fs.writeFileSync(path.join(dir, 'signer-details.txt'), `Signer #1 certificate SHA-256 digest: ${fingerprint}\n`);
    fs.writeFileSync(path.join(dir, 'apk-metadata.txt'), "package: name='example.app' versionCode='4' versionName='1.0.3'\n");
    const run = (tag = 'v1.0.3') => spawnSync('bash', [helper, 'verify'], { cwd: dir, env: { ...process.env, RELEASE_TAG: tag }, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.ok(fs.existsSync(path.join(dir, 'SHA256SUMS')));
    fs.writeFileSync(path.join(dir, 'signer-details.txt'), 'Signer #1 certificate SHA-256 digest: ' + '0'.repeat(64) + '\n');
    const badCert = run();
    assert.notEqual(badCert.status, 0);
    assert.match(badCert.stderr, /Certificate fingerprint mismatch/);
    assert.match(badCert.stdout, /Signer #1 certificate SHA-256 digest:/);
    fs.writeFileSync(path.join(dir, 'signer-details.txt'), `Signer #1 certificate SHA-256 digest: ${fingerprint}\n`);
    fs.writeFileSync(path.join(dir, 'apk-metadata.txt'), "package: name='wrong.app' versionCode='4' versionName='1.0.3'\n");
    const badPackage = run();
    assert.notEqual(badPackage.status, 0);
    assert.match(badPackage.stderr, /APK package\/version mismatch/);
    assert.match(badPackage.stdout, /package: name='wrong.app'/);
    assert.match(run('v9.9.9').stderr, /app.json version 1.0.3 does not match tag v9.9.9/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
