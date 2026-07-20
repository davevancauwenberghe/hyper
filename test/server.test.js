const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('server module loads without a configured session secret', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-'));
  const result = spawnSync(process.execPath, ['-e', "delete process.env.SESSION_SECRET; process.env.DATA_DIR = process.argv[1]; require('./src/server');", dir], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /using an ephemeral session secret/);
});
