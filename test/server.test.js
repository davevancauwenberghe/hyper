const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('server module loads without a configured session secret', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  const result = spawnSync(process.execPath, ['-e', "delete process.env.SESSION_SECRET; process.env.DATA_DIR = process.argv[1]; require('./src/server');", dir], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /using an ephemeral session secret/);
});

test('admin can add a reply to a post', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
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

test('post reads are counted only by explicit open tracking and surfaced in the admin metrics overview', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.saveAdmin('beheerder', 'een-veilig-wachtwoord');
  store.savePosts([{ id: 'post-1', author: 'Originele naam', title: 'Titel', body: 'Tekst', labels: [], replies: [] }]);
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/posts/post-1`);
    await fetch(`${base}/posts/post-1/read`, { method: 'POST' });
    await fetch(`${base}/posts/post-1/read`, { method: 'POST' });

    const login = await fetch(`${base}/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'beheerder', password: 'een-veilig-wachtwoord' }),
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const admin = await fetch(`${base}/admin`, { headers: { cookie } });
    const html = await admin.text();

    assert.equal(admin.status, 200);
    assert.match(html, /Gelezen posts/);
    assert.match(html, /Ingevoerde posts/);
    assert.match(html, /Reacties/);
    assert.match(html, /Leesstatistieken/);
    assert.match(html, /Reads per post/);
    assert.match(html, /<span>2<\/span><p>Gelezen posts/);
    assert.match(html, /<span>1<\/span><p>Ingevoerde posts/);
    assert.match(html, /<meter min="0" max="2" value="2"><\/meter><strong>2<\/strong>/);
    const metrics = JSON.parse(fs.readFileSync(path.join(dir, 'hyperpedia-read-metrics.json'), 'utf8'));
    assert.equal(metrics.posts['post-1'].read_count, 2);
    assert.equal(store.getStats().postReads[0].read_count, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


test('homepage cards and Burnout Insight CTA include explicit action links', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.savePosts([{ id: 'post-1', author: 'Originele naam', title: 'Titel', body: 'Tekst', labels: [], replies: [] }]);
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Lees verder/);
    assert.match(html, /aria-label="Lees verder: Titel"/);
    assert.match(html, /Nieuwe vragen stellen/);
    assert.match(html, /https:\/\/www\.burnoutinsight\.com/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('login page uses the landing page hero treatment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/login`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /class="login-hero"/);
    assert.match(html, /class="login-card stack"/);
    assert.match(html, /Hyperpedia-archief aan te vullen/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('homepage paginates forum posts in groups of sixteen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.savePosts(Array.from({ length: 17 }, (_, index) => ({
    id: `post-${String(index + 1).padStart(2, '0')}`,
    author: 'Originele naam',
    title: `Post ${String(index + 1).padStart(2, '0')}`,
    body: 'Tekst',
    labels: [],
    replies: [],
  })));
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const firstPage = await fetch(base);
    const firstHtml = await firstPage.text();
    const secondPage = await fetch(`${base}/?page=2`);
    const secondHtml = await secondPage.text();

    assert.equal(firstPage.status, 200);
    assert.match(firstHtml, /Post 16/);
    assert.doesNotMatch(firstHtml, /Post 17/);
    assert.match(firstHtml, /Pagina 1 van 2/);
    assert.match(firstHtml, /href="\/\?page=2"/);

    assert.equal(secondPage.status, 200);
    assert.doesNotMatch(secondHtml, /Post 16/);
    assert.match(secondHtml, /Post 17/);
    assert.match(secondHtml, /Pagina 2 van 2/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('homepage combines the hero and auto-rotating stories of the day carousel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.savePosts(Array.from({ length: 6 }, (_, index) => ({
    id: `post-${index + 1}`,
    author: 'Originele naam',
    title: `Dagverhaal ${index + 1}`,
    body: 'Tekst',
    labels: [],
    replies: [],
  })));
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /class="hero home-hero"/);
    assert.match(html, /class="daily-stories"/);
    assert.match(html, /data-daily-stories/);
    assert.match(html, /Een encyclopedie van stressignalen/);
    assert.doesNotMatch(html, /Vier herkenbare ervaringen/);
    assert.doesNotMatch(html, /De carrousel beweegt vanzelf/);
    assert.doesNotMatch(html, /Europe\/Brussels/);
    assert.doesNotMatch(html, /Dagelijkse herkenning/);
    assert.doesNotMatch(html, /Deze vier verhalen wisselen automatisch/);
    assert.doesNotMatch(html, /Uitgelicht verhaal/);
    const dailySection = html.match(/<section class="daily-stories"[\s\S]*?<section class="toolbar">/)[0];
    assert.equal((dailySection.match(/class="daily-story-slide/g) || []).length, 4);
    assert.equal((dailySection.match(/<article class="card">/g) || []).length, 4);
    assert.doesNotMatch(dailySection, /data-daily-prev/);
    assert.doesNotMatch(dailySection, /data-daily-next/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('public pages expose SEO metadata, structured data, robots, and sitemap URLs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.savePosts([{ id: 'post-1', author: 'Originele naam', title: 'SEO titel', body: 'Een herkenbaar verhaal over hartkloppingen en stress.', labels: ['hartkloppingen'], replies: [] }]);
  const { server } = require('../src/server');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base);
    const homeHtml = await home.text();
    const post = await fetch(`${base}/posts/post-1`);
    const postHtml = await post.text();
    const robots = await fetch(`${base}/robots.txt`);
    const robotsText = await robots.text();
    const sitemap = await fetch(`${base}/sitemap.xml`);
    const sitemapXml = await sitemap.text();

    assert.match(homeHtml, /<meta name="robots" content="index, follow">/);
    assert.match(homeHtml, /<script type="application\/ld\+json">/);
    assert.match(postHtml, /<meta property="og:type" content="article">/);
    assert.match(postHtml, /DiscussionForumPosting/);
    assert.match(robotsText, /Sitemap: http:\/\/127\.0\.0\.1:/);
    assert.match(sitemapXml, /<loc>http:\/\/127\.0\.0\.1:[0-9]+\/posts\/post-1<\/loc>/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('admin read metrics show only the top five titles without authors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperpedia-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 'x'.repeat(32);
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../src/server')];
  const store = require('../src/store');
  store.saveAdmin('beheerder', 'een-veilig-wachtwoord');
  store.savePosts(Array.from({ length: 6 }, (_, index) => ({
    id: `post-${index + 1}`,
    author: `Auteur ${index + 1}`,
    title: `Top verhaal ${index + 1}`,
    body: 'Tekst',
    labels: [],
    replies: [],
    read_count: 6 - index,
    read_metrics_version: '1.0.0b',
  })));
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
    const admin = await fetch(`${base}/admin`, { headers: { cookie } });
    const html = await admin.text();
    const metricsSection = html.match(/<section class="panel metrics-panel">[\s\S]*?<\/section>/)[0];

    assert.equal(admin.status, 200);
    assert.equal((metricsSection.match(/<li>/g) || []).length, 5);
    assert.match(metricsSection, /Top verhaal 1/);
    assert.match(metricsSection, /Top verhaal 5/);
    assert.doesNotMatch(metricsSection, /Top verhaal 6/);
    assert.doesNotMatch(metricsSection, /Auteur 1/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
