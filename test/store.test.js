const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('admin passwords are hashed and verifiable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../src/store')];
  const store = require('../src/store');
  store.saveAdmin('beheerder', 'een-veilig-wachtwoord');
  const saved = store.getAdmin();
  assert.equal(saved.username, 'beheerder');
  assert.notEqual(saved.hash, 'een-veilig-wachtwoord');
  assert.equal(store.verifyPassword('een-veilig-wachtwoord', saved), true);
  assert.equal(store.verifyPassword('verkeerd', saved), false);
});

test('legacy read counts are reset for the 1.0.0b metrics version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../src/store')];
  const store = require('../src/store');
  fs.writeFileSync(path.join(dir, 'hyperpedia-posts.json'), JSON.stringify({
    posts: [{ id: 'post-1', author: 'Auteur', title: 'Titel', body: 'Tekst', read_count: 42 }],
  }));

  assert.equal(store.allPosts()[0].read_count, 0);
  store.recordPostRead('post-1');
  assert.equal(store.allPosts()[0].read_count, 1);
});
