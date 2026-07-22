const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { allPosts, savePosts, recordPostRead, getStats, getAdmin, verifyPassword } = require('./store');
const sessionSecret = getSessionSecret();
const POSTS_PER_PAGE = 16;
const STORIES_OF_THE_DAY_COUNT = 4;
const SITE_TIME_ZONE = 'Europe/Brussels';

function getSessionSecret() {
  const configuredSecret = process.env.SESSION_SECRET;
  if (configuredSecret && configuredSecret.length >= 32) return configuredSecret;

  const generatedSecret = crypto.randomBytes(48).toString('base64url');
  const reason = configuredSecret
    ? 'SESSION_SECRET is shorter than 32 characters'
    : 'SESSION_SECRET is not set';
  console.warn(`${reason}; using an ephemeral session secret. Set SESSION_SECRET to keep admin sessions valid across restarts.`);
  return generatedSecret;
}
const sessions = new Map();

const layout = (title, content, { admin = false, error = '', notice = '', description = 'Hyperpedia verzamelt herkenbare verhalen over hyperventilatie, stress en lichamelijke sensaties.', canonicalPath = '/', siteUrl = getSiteUrl(), type = 'website', structuredData = null } = {}) => {
  const canonicalUrl = new URL(canonicalPath, siteUrl).toString();
  const metaDescription = escapeHtml(description);
  const safeTitle = escapeHtml(`${title} · Hyperpedia`);
  return `<!doctype html>
<html lang="nl" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${metaDescription}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="Hyperpedia">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${metaDescription}">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta name="twitter:card" content="summary">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="/style.css">
  ${structuredData ? `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/<\/script/gi, '<\\/script')}</script>` : ''}
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span>Hyperpedia</span><small>verhalen die geruststellen</small></a>
    <nav>
      ${admin ? '<a href="/admin">Beheer</a><form method="post" action="/logout"><button>Uitloggen</button></form>' : '<a class="nav-button" href="/login">Login</a>'}
      <button class="theme-toggle" type="button" aria-label="Wissel licht/donker">☾</button>
    </nav>
  </header>
  <main>
    ${error ? `<p class="flash error">${escapeHtml(error)}</p>` : ''}
    ${notice ? `<p class="flash notice">${escapeHtml(notice)}</p>` : ''}
    ${content}
  </main>
  <footer class="site-footer"><p>Hyperpedia is op geen enkele manier medisch bewezen of medisch gevalideerd. Controleer nieuwe of aanhoudende klachten altijd bij je zorgverlener om zeker te weten wat er speelt.</p></footer>
  <script src="/app.js"></script>
</body>
</html>`;
};


function getSiteUrl(req) {
  const configured = process.env.SITE_URL;
  if (configured) return configured.endsWith('/') ? configured : `${configured}/`;
  if (!req) return 'http://localhost/';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}/`;
}
function requestPathWithQuery(req) {
  return `${req.urlObj.pathname}${req.urlObj.search || ''}`;
}
function toSeoDescription(value, fallback) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact ? `${compact.slice(0, 155)}${compact.length > 155 ? '…' : ''}` : fallback;
}
function getBrusselsDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function dayNumber(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
}
function storiesOfTheDay(posts, date = new Date()) {
  if (posts.length <= STORIES_OF_THE_DAY_COUNT) return posts;
  const ordered = [...posts].sort((a, b) => String(a.id).localeCompare(String(b.id), 'nl'));
  const start = dayNumber(getBrusselsDateKey(date)) % ordered.length;
  return Array.from({ length: STORIES_OF_THE_DAY_COUNT }, (_, index) => ordered[(start + index) % ordered.length]);
}
function renderStoriesOfTheDay(posts) {
  if (!posts.length) return '';
  const slides = posts.map((post, index) => `<div class="daily-story-slide${index === 0 ? ' is-active' : ''}" id="daily-story-${index + 1}" role="group" aria-roledescription="slide" aria-label="Verhaal ${index + 1} van ${posts.length}">${postCard(post)}</div>`).join('');
  const dots = posts.map((_, index) => `<button type="button" class="daily-story-dot${index === 0 ? ' is-active' : ''}" aria-label="Toon verhaal ${index + 1}" aria-controls="daily-story-${index + 1}"${index === 0 ? ' aria-current="true"' : ''}></button>`).join('');
  return `<section class="daily-stories" aria-labelledby="daily-stories-title" data-daily-stories><div class="section-heading"><p class="eyebrow">Verhalen van de dag</p><h2 id="daily-stories-title">Uitgelicht verhaal</h2></div><div class="daily-story-carousel"><button type="button" class="daily-story-nav" data-daily-prev aria-label="Vorig verhaal">←</button><div class="daily-story-track">${slides}</div><button type="button" class="daily-story-nav" data-daily-next aria-label="Volgend verhaal">→</button></div><div class="daily-story-dots" aria-label="Verhalen van de dag navigatie">${dots}</div></section>`;
}
function homepageStructuredData(posts, req) {
  const siteUrl = getSiteUrl(req);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Hyperpedia',
    url: siteUrl,
    description: 'Een rustige encyclopedie met herkenbare forumverhalen over lichamelijke stresssignalen.',
    potentialAction: { '@type': 'SearchAction', target: `${siteUrl}?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    mainEntity: posts.slice(0, 12).map(post => ({ '@type': 'DiscussionForumPosting', headline: post.title, author: { '@type': 'Person', name: post.author }, url: new URL(`/posts/${encodeURIComponent(post.id)}`, siteUrl).toString() })),
  };
}
function postStructuredData(post, req) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: post.title,
    text: post.body,
    author: { '@type': 'Person', name: post.author },
    datePublished: post.created_at || post.updated_at,
    dateModified: post.updated_at || post.created_at,
    keywords: (post.labels || []).join(', '),
    url: new URL(`/posts/${encodeURIComponent(post.id)}`, getSiteUrl(req)).toString(),
  };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function isAdmin(req) { return Boolean(req.admin); }
function requireAdmin(req, res) { if (!isAdmin(req)) { redirect(res, '/login'); return true; } return false; }
function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex'); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(v => v.trim().split('=')).filter(v => v[0]).map(([k,...r]) => [k, decodeURIComponent(r.join('='))])); }
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }
function send(res, html, code = 200, type = 'text/html; charset=utf-8') { res.writeHead(code, { 'Content-Type': type }); res.end(html); }
function collect(req) { return new Promise(resolve => { let b=''; req.on('data', c => b += c); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); }); }
function parseLabels(value) { return [...new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean))].slice(0, 12); }
function postCard(post) {
  const labels = post.labels || [];
  return `<article class="card"><div class="card-top"><p class="eyebrow">${escapeHtml(post.author)}</p>${labels.map(l => `<a class="label" href="/?label=${encodeURIComponent(l)}">${escapeHtml(l)}</a>`).join('')}</div><h2><a href="/posts/${post.id}">${escapeHtml(post.title)}</a></h2><p>${escapeHtml(post.body).slice(0, 230)}${post.body.length > 230 ? '…' : ''}</p><div class="card-actions"><a class="button secondary" href="/posts/${post.id}" aria-label="Lees verder: ${escapeHtml(post.title)}">Lees verder</a>${(post.replies || []).length ? `<span class="reply-count">${post.replies.length} reactie${post.replies.length === 1 ? '' : 's'}</span>` : ''}</div></article>`;
}

function pageUrl({ q = '', label = '', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (label) params.set('label', label);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/${query ? `?${query}` : ''}`;
}
function renderPagination({ q = '', label = '', page = 1, totalPages = 1, totalPosts = 0 } = {}) {
  if (totalPages <= 1) return '';

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return `<nav class="pagination" aria-label="Forum posts pagina's"><p>Pagina ${page} van ${totalPages} · ${formatNumber(totalPosts)} verhalen</p><div><a class="button secondary${page === 1 ? ' disabled' : ''}" href="${page === 1 ? '#' : pageUrl({ q, label, page: page - 1 })}" aria-label="Vorige pagina"${page === 1 ? ' aria-disabled="true" tabindex="-1"' : ''}>← Vorige</a>${pages.map(number => number === page ? `<span class="page-current" aria-current="page">${number}</span>` : `<a class="page-link" href="${pageUrl({ q, label, page: number })}">${number}</a>`).join('')}<a class="button secondary${page === totalPages ? ' disabled' : ''}" href="${page === totalPages ? '#' : pageUrl({ q, label, page: page + 1 })}" aria-label="Volgende pagina"${page === totalPages ? ' aria-disabled="true" tabindex="-1"' : ''}>Volgende →</a></div></nav>`;
}

function burnoutInsightCta() {
  return `<section class="external-forum-cta" aria-labelledby="burnout-insight-title"><div><p class="eyebrow">Nieuwe vragen stellen</p><h2 id="burnout-insight-title">Zoek je een actieve plek om verder te praten?</h2><p>Hyperpedia bewaart oudere forumverhalen als rustig archief. Wil je zelf anoniem delen, reageren op anderen of herkenning vinden bij mensen die nu hetzelfde meemaken? Bezoek dan het open burnout forum van Burnout Insight.</p></div><a class="button" href="https://www.burnoutinsight.com" target="_blank" rel="noopener noreferrer">Naar Burnout Insight</a></section>`;
}
function renderReplies(post, { admin = false } = {}) {
  const replies = post.replies || [];
  if (!replies.length) return '';

  return `<section class="replies" aria-labelledby="replies-title"><h2 id="replies-title">Reacties</h2>${replies.map(reply => `<article class="reply"><p class="eyebrow">Reactie op ${escapeHtml(reply.originalReplier || post.author)}</p><h3>${escapeHtml(reply.author || 'Beheerder')}</h3><div>${escapeHtml(reply.body).replace(/\n/g, '<br>')}</div>${admin ? `<div class="reply-actions"><a class="button secondary" href="/admin/reply/${post.id}/${reply.id}/edit">Reactie bewerken</a><form method="post" action="/admin/reply/${post.id}/${reply.id}/delete"><button class="danger" type="submit">Reactie verwijderen</button></form></div>` : ''}</article>`).join('')}</section>`;
}

function formatNumber(value) { return new Intl.NumberFormat('nl-NL').format(value); }
function adminDashboard() {
  const stats = getStats();
  return `<section class="admin-overview"><div><p class="eyebrow">Beheerder portal</p><h1>Overzicht</h1><p>Volg in één oogopslag hoeveel verhalen zijn ingevoerd, gelezen en beantwoord.</p></div><div class="stats-grid"><article><span>${formatNumber(stats.readCount)}</span><p>Totaal gelezen posts</p></article><article><span>${formatNumber(stats.postCount)}</span><p>Ingevoerde posts</p></article><article><span>${formatNumber(stats.replyCount)}</span><p>Beheerreacties</p></article></div></section>`;
}
function adminReplyForm(post) {
  return `<section class="panel reply-panel"><h2>Reactie toevoegen</h2><form method="post" action="/admin/reply/${post.id}" class="stack"><label>Naam originele replier<input name="originalReplier" value="${escapeHtml(post.author)}" required></label><label>Naam beheerder<input name="author" value="Beheerder" required></label><label>Reactie<textarea name="body" rows="6" required placeholder="Schrijf hier je reactie…"></textarea></label><button>Reactie opslaan</button></form></section>`;
}
function withRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const [sid, sig] = String(cookies.hyperpedia_session || '').split('.');
  req.admin = Boolean(sid && sig === sign(sid) && sessions.get(sid));
  req.urlObj = new URL(req.url, 'http://localhost');
}

async function handler(req, res) {
  withRequest(req);
  const method = req.method;
  const pathname = req.urlObj.pathname;
  if (pathname === '/style.css') return send(res, fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css')), 200, 'text/css');
  if (pathname === '/app.js') return send(res, fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js')), 200, 'application/javascript');
  if (method === 'GET' && pathname === '/robots.txt') return send(res, `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', getSiteUrl(req)).toString()}\n`, 200, 'text/plain; charset=utf-8');
  if (method === 'GET' && pathname === '/sitemap.xml') {
    const siteUrl = getSiteUrl(req);
    const urls = ['/', ...allPosts().map(post => `/posts/${encodeURIComponent(post.id)}`)];
    return send(res, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `\n  <url><loc>${escapeHtml(new URL(url, siteUrl).toString())}</loc></url>`).join('')}\n</urlset>`, 200, 'application/xml; charset=utf-8');
  }
  if (method === 'GET' && pathname === '/') {
    const q = (req.urlObj.searchParams.get('q') || '').trim();
    const label = (req.urlObj.searchParams.get('label') || '').trim();
    let posts = allPosts().sort((a,b)=>a.title.localeCompare(b.title,'nl'));
    if (q) posts = posts.filter(p => {
      const replyText = (p.replies || []).map(reply => `${reply.originalReplier || ''} ${reply.author || ''} ${reply.body || ''}`).join(' ');
      return `${p.title} ${p.author} ${p.body} ${(p.labels||[]).join(' ')} ${replyText}`.toLowerCase().includes(q.toLowerCase());
    });
    if (label) posts = posts.filter(p => (p.labels || []).includes(label));
    const requestedPage = Number.parseInt(req.urlObj.searchParams.get('page') || '1', 10);
    const totalPosts = posts.length;
    const totalPages = Math.max(1, Math.ceil(totalPosts / POSTS_PER_PAGE));
    const page = Math.min(Math.max(Number.isNaN(requestedPage) ? 1 : requestedPage, 1), totalPages);
    const visiblePosts = posts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);
    const allLabels = [...new Set(allPosts().flatMap(p => p.labels || []))].sort((a,b)=>a.localeCompare(b,'nl'));
    const pagination = renderPagination({ q, label, page, totalPages, totalPosts });
    const dailyStories = storiesOfTheDay(allPosts());
    return send(res, layout('Start', `<section class="hero"><div><p class="eyebrow">Rustige herkenningsplek</p><h1>Een encyclopedie van lichamelijke stresssignalen.</h1><p>Lees forumverhalen zonder tijdsdruk. Zoek op klacht, gevoel, label of reactie en vind herkenning wanneer je zenuwstelsel luid klinkt.</p></div></section>${renderStoriesOfTheDay(dailyStories)}<section class="toolbar"><form><input name="q" value="${escapeHtml(q)}" placeholder="Zoek op tintelingen, benauwdheid, duizelig…"><button>Zoeken</button></form><div class="labels">${allLabels.map(l=>`<a class="label" href="/?label=${encodeURIComponent(l)}">${escapeHtml(l)}</a>`).join('')}</div></section><section class="grid">${visiblePosts.length ? visiblePosts.map(postCard).join('') : '<p class="empty">Nog geen verhalen gevonden.</p>'}</section>${pagination}${burnoutInsightCta()}`, { admin: isAdmin(req), canonicalPath: requestPathWithQuery(req), siteUrl: getSiteUrl(req), structuredData: homepageStructuredData(posts, req) }));
  }
  if (method === 'GET' && pathname.startsWith('/posts/')) {
    const id = decodeURIComponent(pathname.split('/').pop()); const post = recordPostRead(id);
    if (!post) return send(res, layout('Niet gevonden', '<p class="empty">Dit verhaal bestaat niet.</p>', { admin: isAdmin(req) }), 404);
    return send(res, layout(post.title, `<article class="story"><a href="/">← terug</a><p class="eyebrow">${escapeHtml(post.author)}</p><h1>${escapeHtml(post.title)}</h1><div class="labels">${(post.labels||[]).map(l=>`<span class="label">${escapeHtml(l)}</span>`).join('')}</div><div class="body">${escapeHtml(post.body).replace(/\n/g, '<br>')}</div>${renderReplies(post, { admin: isAdmin(req) })}${isAdmin(req) ? `<p><a class="button" href="/admin/edit/${post.id}">Bewerken</a></p>${adminReplyForm(post)}` : ''}</article>`, { admin: isAdmin(req), description: toSeoDescription(post.body, post.title), canonicalPath: `/posts/${encodeURIComponent(post.id)}`, type: 'article', siteUrl: getSiteUrl(req), structuredData: postStructuredData(post, req) }));
  }
  if (method === 'GET' && pathname === '/login') return send(res, layout('Login', `<section class="login-hero"><div><p class="eyebrow">Beheerder portal</p><h1>Beheerlogin</h1><p>Log in om het Hyperpedia-archief aan te vullen, verhalen bij te werken en reacties te beheren.</p></div><form method="post" action="/login" class="login-card stack"><label>Gebruikersnaam<input name="username" autocomplete="username" required></label><label>Wachtwoord<input name="password" type="password" autocomplete="current-password" required></label><button>Inloggen</button></form></section>`));
  if (method === 'POST' && pathname === '/login') { const body = await collect(req); const admin = getAdmin(); if (!admin || admin.username !== body.username || !verifyPassword(body.password || '', admin)) return send(res, layout('Login', '<section class="panel narrow"><h1>Beheerlogin</h1><p>Controleer je gegevens.</p><a href="/login">Opnieuw proberen</a></section>', { error: 'Inloggen mislukt.' }), 401); const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, true); res.writeHead(302, { Location: '/admin', 'Set-Cookie': `hyperpedia_session=${sid}.${sign(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` }); return res.end(); }
  if (method === 'POST' && pathname === '/logout') { res.writeHead(302, { Location: '/', 'Set-Cookie': 'hyperpedia_session=; Path=/; Max-Age=0' }); return res.end(); }
  if (method === 'GET' && pathname === '/admin') { if (requireAdmin(req,res)) return; return send(res, layout('Beheer', `${adminDashboard()}<section class="panel"><h1>Nieuw verhaal toevoegen</h1><form method="post" action="/admin/posts" class="stack"><label>Titel<input name="title" required></label><label>Naam oorspronkelijke auteur<input name="author" required></label><label>Labels <small>komma-gescheiden</small><input name="labels" placeholder="ademhaling, duizeligheid, geruststelling"></label><label>Forumtekst<textarea name="body" rows="14" required></textarea></label><button>Opslaan</button></form></section>`, { admin: true })); }
  if (method === 'POST' && pathname === '/admin/posts') { if (requireAdmin(req,res)) return; const body = await collect(req); const posts = allPosts(); const id = crypto.randomBytes(6).toString('base64url'); posts.push({ id, author: body.author, title: body.title, body: body.body, labels: parseLabels(body.labels), replies: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); savePosts(posts); return redirect(res, `/posts/${id}`); }

  if (method === 'GET' && pathname.startsWith('/admin/reply/') && pathname.endsWith('/edit')) {
    if (requireAdmin(req,res)) return;
    const [, , , postId, replyId] = pathname.split('/').map(decodeURIComponent);
    const p = allPosts().find(x=>x.id===postId);
    const reply = p?.replies?.find(x=>x.id===replyId);
    if (!p || !reply) return send(res, 'Niet gevonden', 404);
    return send(res, layout('Reactie bewerken', `<section class="panel"><h1>Reactie bewerken</h1><form method="post" action="/admin/reply/${p.id}/${reply.id}/edit" class="stack"><label>Naam originele replier<input name="originalReplier" value="${escapeHtml(reply.originalReplier || p.author)}" required></label><label>Naam beheerder<input name="author" value="${escapeHtml(reply.author || 'Beheerder')}" required></label><label>Reactie<textarea name="body" rows="6" required>${escapeHtml(reply.body)}</textarea></label><div class="form-actions"><button>Reactie bijwerken</button><a class="button secondary" href="/posts/${p.id}">Annuleren</a></div></form></section>`, { admin: true }));
  }
  if (method === 'POST' && pathname.startsWith('/admin/reply/') && pathname.endsWith('/edit')) {
    if (requireAdmin(req,res)) return;
    const [, , , postId, replyId] = pathname.split('/').map(decodeURIComponent);
    const body = await collect(req);
    const posts = allPosts();
    const p = posts.find(x=>x.id===postId);
    const reply = p?.replies?.find(x=>x.id===replyId);
    if (!p || !reply) return send(res, 'Niet gevonden', 404);
    Object.assign(reply, { originalReplier: body.originalReplier, author: body.author, body: body.body, updated_at: new Date().toISOString() });
    p.updated_at = new Date().toISOString();
    savePosts(posts);
    return redirect(res, `/posts/${postId}`);
  }
  if (method === 'POST' && pathname.startsWith('/admin/reply/') && pathname.endsWith('/delete')) {
    if (requireAdmin(req,res)) return;
    const [, , , postId, replyId] = pathname.split('/').map(decodeURIComponent);
    const posts = allPosts();
    const p = posts.find(x=>x.id===postId);
    if (!p) return send(res, 'Niet gevonden', 404);
    const originalLength = (p.replies || []).length;
    p.replies = (p.replies || []).filter(reply => reply.id !== replyId);
    if (p.replies.length === originalLength) return send(res, 'Niet gevonden', 404);
    p.updated_at = new Date().toISOString();
    savePosts(posts);
    return redirect(res, `/posts/${postId}`);
  }
  if (method === 'POST' && pathname.startsWith('/admin/reply/')) { if (requireAdmin(req,res)) return; const id = decodeURIComponent(pathname.split('/').pop()); const body = await collect(req); const posts = allPosts(); const p = posts.find(x=>x.id===id); if (!p) return send(res, 'Niet gevonden', 404); p.replies = p.replies || []; p.replies.push({ id: crypto.randomBytes(6).toString('base64url'), originalReplier: body.originalReplier, author: body.author, body: body.body, created_at: new Date().toISOString() }); p.updated_at = new Date().toISOString(); savePosts(posts); return redirect(res, `/posts/${id}`); }
  if (method === 'GET' && pathname.startsWith('/admin/edit/')) { if (requireAdmin(req,res)) return; const id = decodeURIComponent(pathname.split('/').pop()); const p = allPosts().find(x=>x.id===id); if (!p) return send(res, 'Niet gevonden', 404); return send(res, layout('Bewerken', `<section class="panel"><h1>Verhaal bewerken</h1><form method="post" action="/admin/edit/${p.id}" class="stack"><label>Titel<input name="title" value="${escapeHtml(p.title)}" required></label><label>Naam oorspronkelijke auteur<input name="author" value="${escapeHtml(p.author)}" required></label><label>Labels<input name="labels" value="${escapeHtml((p.labels||[]).join(', '))}"></label><label>Forumtekst<textarea name="body" rows="14" required>${escapeHtml(p.body)}</textarea></label><button>Bijwerken</button></form></section>`, { admin: true })); }
  if (method === 'POST' && pathname.startsWith('/admin/edit/')) { if (requireAdmin(req,res)) return; const id = decodeURIComponent(pathname.split('/').pop()); const body = await collect(req); const posts = allPosts(); const p = posts.find(x=>x.id===id); if (!p) return send(res, 'Niet gevonden', 404); Object.assign(p, { author: body.author, title: body.title, body: body.body, labels: parseLabels(body.labels), updated_at: new Date().toISOString() }); savePosts(posts); return redirect(res, `/posts/${id}`); }
  send(res, 'Niet gevonden', 404);
}

const server = http.createServer(handler);
if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  const HOST = process.env.HOST || '0.0.0.0';

  server.listen(PORT, HOST, () => {
    console.log(`Listening on ${HOST}:${PORT}`);
  });
}
module.exports = { server, handler };
