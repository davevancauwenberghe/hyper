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

test('admin can add a reply to a post', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.saveAdmin('beheerder', 'een-veilig-wachtwoord');
  store.savePosts([{ id: 'post-1', author: 'Originele naam', title: 'Titel', body: 'Tekst', labels: [] }]);
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'beheerder', password: 'een-veilig-wachtwoord' }),
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const reply = await fetch(`${base}/admin/reply/post-1`, {
      method: 'POST',
      headers: { cookie },
      body: new URLSearchParams({ originalReplier: 'Originele naam', author: 'Beheerder', body: 'Bedankt voor je verhaal.' }),
      redirect: 'manual',
    });

    assert.equal(reply.status, 302);
    assert.equal(reply.headers.get('location'), '/posts/post-1');
    assert.deepEqual(store.allPosts()[0].replies.map(({ originalReplier, author, body }) => ({ originalReplier, author, body })), [
      { originalReplier: 'Originele naam', author: 'Beheerder', body: 'Bedankt voor je verhaal.' },
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('homepage search includes replies', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.savePosts([{
    id: 'post-1',
    author: 'Originele naam',
    title: 'Titel zonder zoekwoord',
    body: 'Tekst zonder zoekwoord',
    labels: [],
    replies: [{ id: 'reply-1', originalReplier: 'Originele naam', author: 'Beheerder', body: 'Kalmerend antwoord over kaakspanning.' }],
  }]);
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/?q=kaakspanning`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Titel zonder zoekwoord/);
    assert.doesNotMatch(html, /Nog geen verhalen gevonden/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('admin can edit and delete a reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.saveAdmin('beheerder', 'een-veilig-wachtwoord');
  store.savePosts([{
    id: 'post-1',
    author: 'Originele naam',
    title: 'Titel',
    body: 'Tekst',
    labels: [],
    replies: [{ id: 'reply-1', originalReplier: 'Originele naam', author: 'Beheerder', body: 'Eerste reactie.' }],
  }]);
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'beheerder', password: 'een-veilig-wachtwoord' }),
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const edit = await fetch(`${base}/admin/reply/post-1/reply-1/edit`, {
      method: 'POST',
      headers: { cookie },
      body: new URLSearchParams({ originalReplier: 'Aangepaste naam', author: 'Moderator', body: 'Bijgewerkte reactie.' }),
      redirect: 'manual',
    });

    assert.equal(edit.status, 302);
    assert.equal(edit.headers.get('location'), '/posts/post-1');
    assert.deepEqual(store.allPosts()[0].replies.map(({ originalReplier, author, body }) => ({ originalReplier, author, body })), [
      { originalReplier: 'Aangepaste naam', author: 'Moderator', body: 'Bijgewerkte reactie.' },
    ]);

    const remove = await fetch(`${base}/admin/reply/post-1/reply-1/delete`, {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual',
    });

    assert.equal(remove.status, 302);
    assert.equal(remove.headers.get('location'), '/posts/post-1');
    assert.deepEqual(store.allPosts()[0].replies, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
