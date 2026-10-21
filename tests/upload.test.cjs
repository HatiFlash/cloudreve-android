const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');

function harness({ size = 200704, chunkSize = 26214400, single = { status: 200, body: '{"code":0}' }, chunks = [], cleanupError = false, b64, readRange } = {}) {
  const calls = { copied: [], deleted: [], sessions: [], uploaded: [], chunks: [], progress: [], cleanup: [] };
  const disk = new Map([['content://original', size], ['file://original', size]]);
  const fileSystem = {
    cacheDirectory: 'file://cache/',
    FileSystemUploadType: { BINARY_CONTENT: 0 }, EncodingType: { Base64: 'base64' },
    async copyAsync({ from, to }) { calls.copied.push({ from, to }); disk.set(to, disk.get(from)); },
    async getInfoAsync(uri) { return { exists: disk.has(uri), size: disk.get(uri) }; },
    async deleteAsync(uri) { calls.deleted.push(uri); disk.delete(uri); if (cleanupError) throw Error('cache cleanup failed'); },
    async uploadAsync(url, uri) { calls.uploaded.push({ url, uri, length: disk.get(uri) }); return single; },
    async readAsStringAsync(uri, opts) { assert.equal(uri, calls.copied[0].to); if (readRange) return readRange(opts.position ?? 0, opts.length); return b64 ?? Buffer.alloc(opts.length, 42).toString('base64'); },
  };
  const api = {
    apiBase: () => 'https://example/api/v4', bearer: () => 'token',
    async createUploadSession(uri, bytes) { calls.sessions.push({ uri, bytes }); return { session_id: 'session-id', chunk_size: chunkSize }; },
    async deleteUploadSession(...args) { calls.cleanup.push(args); if (cleanupError) throw Error('session cleanup failed'); },
  };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/upload.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  const sandbox = { exports, require(id) { if (id === 'expo-file-system/legacy') return fileSystem; if (id === './api') return api; if (id === './logstore') return { pushLog() {} }; throw Error(id); }, fetch: async (url, opts) => { calls.chunks.push({ url, opts }); const response = chunks[calls.chunks.length - 1] ?? { status: 200, body: '{"code":0}' }; return { status: response.status, text: async () => response.body }; }, Date, Uint8Array, Math, Error, JSON, encodeURIComponent };
  vm.runInNewContext(source, sandbox);
  return { uploadFile: exports.uploadFile, calls };
}
const file = (uri = 'content://original') => ({ uri, name: 'test.bin', size: 196608, mime: 'application/octet-stream' });

test('picker stale size: single session and upload use identical snapshot byte size', async () => {
  const { uploadFile, calls } = harness();
  await uploadFile('cloudreve://my/', file(), v => calls.progress.push(v));
  assert.equal(calls.sessions[0].bytes, 200704);
  assert.equal(calls.uploaded[0].length, 200704);
  assert.equal(calls.uploaded[0].uri, calls.copied[0].to);
  assert.deepEqual(calls.deleted, [calls.copied[0].to]);
  assert.deepEqual(calls.progress, [1]);
});

test('single HTTP 200 JSON code 40013 fails, cleanup failure cannot hide error', async () => {
  const { uploadFile, calls } = harness({ single: { status: 200, body: '{"code":40013,"msg":"size mismatch"}' }, cleanupError: true });
  await assert.rejects(uploadFile('cloudreve://my/', file()), /size mismatch.*40013|40013.*size mismatch/);
  assert.equal(calls.cleanup.length, 1);
  assert.equal(calls.deleted.length, 1);
});

test('single malformed JSON cannot succeed', async () => {
  const { uploadFile, calls } = harness({ single: { status: 200, body: 'broken' } });
  await assert.rejects(uploadFile('cloudreve://my/', file()), /réponse|JSON|inattendue/i);
  assert.equal(calls.cleanup.length, 1);
});

test('single HTTP failure with JSON code zero still fails', async () => {
  const { uploadFile, calls } = harness({ single: { status: 500, body: '{"code":0}' } });
  await assert.rejects(uploadFile('cloudreve://my/', file()), /Upload refusé/);
  assert.equal(calls.cleanup.length, 1);
  assert.equal(calls.deleted.length, 1);
});

test('chunk JSON error fails and cleans session and cache', async () => {
  const { uploadFile, calls } = harness({ size: 5, chunkSize: 3, chunks: [{ status: 200, body: '{"code":40013,"msg":"bad chunk"}' }] });
  await assert.rejects(uploadFile('cloudreve://my/', file()), /bad chunk/);
  assert.equal(calls.cleanup.length, 1);
  assert.equal(calls.deleted.length, 1);
});

test('chunk padding: exact byte lengths for both chunks, success and cleanup', async () => {
  const { uploadFile, calls } = harness({ size: 5, chunkSize: 3 });
  await uploadFile('cloudreve://my/', file('file://original'), v => calls.progress.push(v));
  assert.equal(calls.sessions[0].bytes, 5);
  assert.deepEqual(calls.chunks.map(c => c.opts.body.length), [3, 2]);
  assert.deepEqual(calls.chunks.map(c => c.opts.headers['Content-Length']), ['3', '2']);
  assert.deepEqual(calls.progress, [0.5, 1]);
  assert.equal(calls.deleted.length, 1);
});

test('malformed base64 cannot silently succeed or report progress', async () => {
  const { uploadFile, calls } = harness({ size: 5, chunkSize: 3, b64: '!!!!!' });
  await assert.rejects(uploadFile('cloudreve://my/', file()), /base64|incomplète/i);
  assert.equal(calls.chunks.length, 0);
  assert.equal(calls.cleanup.length, 1);
});

test('regression: real 25MiB chunk + small tail uses true bytes and cannot overflow the stack', async () => {
  const chunkSize = 26214400;
  const tail = 1000;
  const size = chunkSize + tail;
  const source = Buffer.alloc(size);
  for (let i = 0; i < size; i++) source[i] = (i * 31 + 7) & 0xff;
  const { uploadFile, calls } = harness({
    size,
    chunkSize,
    readRange: (offset, length) => source.subarray(offset, offset + length).toString('base64'),
  });
  await uploadFile('cloudreve://my/', file('file://original'), v => calls.progress.push(v));
  assert.deepEqual(calls.chunks.map(c => c.opts.body.length), [chunkSize, tail]);
  assert.deepEqual(Buffer.from(calls.chunks[0].opts.body).subarray(0, 8), source.subarray(0, 8));
  assert.deepEqual(Buffer.from(calls.chunks[1].opts.body), source.subarray(chunkSize));
  assert.equal(calls.progress.length, 2);
  assert.equal(calls.progress[1], 1);
  assert.equal(calls.deleted.length, 1);
});

test('chunk malformed JSON cannot succeed', async () => {
  const { uploadFile, calls } = harness({ size: 5, chunkSize: 3, chunks: [{ status: 200, body: '<html>' }] });
  await assert.rejects(uploadFile('cloudreve://my/', file()), /réponse|JSON|inattendue/i);
  assert.equal(calls.cleanup.length, 1);
});
