const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { allPosts, savePosts, recordPostRead, purgePostRead, getStats, getAdmin, verifyPassword } = require('./store');
const sessionSecret = getSessionSecret();
const POSTS_PER_PAGE = 18;
const STORIES_OF_THE_DAY_COUNT = 4;
const LOGIN_MAX_FAILURES = 2;
const LOGIN_LOCK_MS = 60_000;
const LOGIN_ATTEMPT_TTL_MS = 15 * 60_000;
const LOGIN_ATTEMPT_CLEANUP_INTERVAL_MS = 60_000;
const loginAttempts = new Map();
let lastLoginAttemptCleanup = 0;

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

const layout = (title, content, { admin = false, error = '', notice = '', description = 'Hyperpedia verzamelt herkenbare verhalen over hyperventilatie, stress en lichamelijke sensaties.', canonicalPath = '/', siteUrl = getSiteUrl(), type = 'website', robots = 'index, follow', structuredData = null } = {}) => {
  const canonicalUrl = new URL(canonicalPath, siteUrl).toString();
  const metaDescription = escapeHtml(description);
  const safeTitle = escapeHtml(`${title} · Hyperpedia`);
  return `<!doctype html>
<html lang="nl" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${metaDescription}">
  <meta name="theme-color" content="#f7f1e8">
  <meta name="application-name" content="Hyperpedia">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="Hyperpedia">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${metaDescription}">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(new URL('/social-preview.svg', siteUrl).toString())}">
  <meta property="og:image:alt" content="Hyperpedia — verhalen die geruststellen">
  <meta name="twitter:card" content="summary_large_image">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="/style.css">
  ${structuredData ? `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/<\/script/gi, '<\\/script')}</script>` : ''}
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span>Hyperpedia</span><small>verhalen die geruststellen</small></a>
    <nav>
      ${admin ? '<a href="/admin">Beheer</a><form method="post" action="/logout"><button>Uitloggen</button></form>' : '<a class="nav-button" href="/login" rel="nofollow">Beheer</a>'}
      <button class="theme-toggle" type="button" aria-label="Donker thema gebruiken" aria-pressed="false"><span aria-hidden="true" data-theme-icon>☾</span></button>
    </nav>
  </header>
  <main>
    ${error ? `<p class="flash error">${escapeHtml(error)}</p>` : ''}
    ${notice ? `<p class="flash notice">${escapeHtml(notice)}</p>` : ''}
    ${content}
  </main>
  <footer class="site-footer"><div class="footer-note"><strong>Goed om te weten</strong><p>De verhalen op Hyperpedia zijn persoonlijke ervaringen, geen medisch advies. Bespreek nieuwe, ernstige of aanhoudende klachten altijd met je zorgverlener.</p></div><button class="footer-info-link" type="button" data-info-open>Over dit archief</button></footer>
  <dialog class="info-dialog" aria-labelledby="info-dialog-title" data-info-dialog>
    <div class="info-dialog-card">
      <button class="info-dialog-close" type="button" aria-label="Sluit meer informatie" data-info-close>×</button>
      <p class="eyebrow">Waarom Hyperpedia?</p>
      <h2 id="info-dialog-title">Een archief voor (h)erkenning</h2>
      <p>Hyperpedia is opgezet om oudere berichten uit de voormalige fora Angstfobietherapie en Therapiepsycholoog te archiveren en toegankelijk te houden, mocht die informatie ooit verdwijnen.</p>
      <p>Omdat beide fora gesloten zijn voor nieuwe posts en reacties, blijft Hyperpedia bewust een leesarchief. Het doel is herkenning en context bieden, zonder dat het verandert in geruststelling zoeken of medisch advies.</p>
      <div class="info-dialog-actions"><button type="button" data-info-close>Ik begrijp het</button></div>
    </div>
  </dialog>
  <script src="/app.js"></script>
</body>
</html>`;
};


function getSiteUrl(req) {
  const configured = process.env.SITE_URL;
  if (configured) {
    const siteUrl = new URL(configured);
    siteUrl.pathname = '/';
    siteUrl.search = '';
    siteUrl.hash = '';
    return siteUrl.toString();
  }
  if (!req) return 'http://localhost/';
  const proto = firstForwardedValue(req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
  const host = firstForwardedValue(req.headers['x-forwarded-host']) || firstForwardedValue(req.headers.host) || 'localhost';
  return `${proto}://${host}/`;
}
function firstForwardedValue(value = '') {
  const header = Array.isArray(value) ? value[0] : value;
  return String(header || '').split(',')[0].trim();
}
function redirectToCanonicalOrigin(req, res) {
  if (!process.env.SITE_URL || req.headers['fly-health-check']) return false;

  const canonical = new URL(getSiteUrl());
  const requestProtocol = firstForwardedValue(req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
  const requestHost = firstForwardedValue(req.headers['x-forwarded-host']) || firstForwardedValue(req.headers.host);
  if (!requestHost || (requestProtocol === canonical.protocol.slice(0, -1) && requestHost.toLowerCase() === canonical.host.toLowerCase())) return false;

  const target = new URL(req.url, canonical);
  res.writeHead(308, { Location: target.toString() });
  res.end();
  return true;
}
function toSeoDescription(value, fallback) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact ? `${compact.slice(0, 155)}${compact.length > 155 ? '…' : ''}` : fallback;
}
function toIsoDate(value) {
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function dayNumber(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
}
function storiesOfTheDay(posts, date = new Date()) {
  if (posts.length <= STORIES_OF_THE_DAY_COUNT) return posts;
  const ordered = [...posts].sort((a, b) => String(a.id).localeCompare(String(b.id), 'nl'));
  const start = dayNumber(getLocalDateKey(date)) % ordered.length;
  return Array.from({ length: STORIES_OF_THE_DAY_COUNT }, (_, index) => ordered[(start + index) % ordered.length]);
}
function renderStoriesOfTheDay(posts) {
  if (!posts.length) return '';
  const slides = posts.map((post, index) => `<div class="daily-story-slide${index === 0 ? ' is-active' : ''}" id="daily-story-${index + 1}" role="group" aria-roledescription="slide" aria-label="Verhaal ${index + 1} van ${posts.length}"${index === 0 ? '' : ' hidden aria-hidden="true"'}>${postCard(post)}</div>`).join('');
  const dots = posts.map((_, index) => `<button type="button" class="daily-story-dot${index === 0 ? ' is-active' : ''}" aria-label="Toon verhaal ${index + 1}" aria-controls="daily-story-${index + 1}"${index === 0 ? ' aria-current="true"' : ''}></button>`).join('');
  if (posts.length === 1) return `<div class="daily-story-frame"><div class="daily-story-track">${slides}</div></div>`;
  return `<div class="daily-story-frame" data-daily-stories><div class="daily-story-track" aria-live="polite">${slides}</div><div class="daily-story-controls"><button type="button" class="daily-story-arrow" data-daily-prev aria-label="Vorig verhaal">←</button><div class="daily-story-dots" aria-label="Verhalen van de dag navigatie">${dots}</div><button type="button" class="daily-story-arrow" data-daily-next aria-label="Volgend verhaal">→</button></div></div>`;
}
function personStructuredData(name) {
  return { '@type': 'Person', name };
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
    mainEntity: posts.slice(0, 12).map(post => {
      const url = new URL(`/posts/${encodeURIComponent(post.id)}`, siteUrl).toString();
      return { '@type': 'DiscussionForumPosting', headline: post.title, datePublished: toIsoDate(post.created_at || post.updated_at), author: personStructuredData(post.author), url };
    }),
  };
}
function postStructuredData(post, req) {
  const siteUrl = getSiteUrl(req);
  return {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: post.title,
    text: post.body,
    author: personStructuredData(post.author),
    datePublished: toIsoDate(post.created_at || post.updated_at),
    dateModified: toIsoDate(post.updated_at || post.created_at),
    keywords: (post.labels || []).join(', '),
    url: new URL(`/posts/${encodeURIComponent(post.id)}`, siteUrl).toString(),
  };
}

function escapeXml(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function isAdmin(req) { return Boolean(req.admin); }
function requireAdmin(req, res) { if (!isAdmin(req)) { redirect(res, '/login'); return true; } return false; }
function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex'); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(v => v.trim().split('=')).filter(v => v[0]).map(([k,...r]) => [k, decodeURIComponent(r.join('='))])); }
function redirect(res, to, code = 302) { res.writeHead(code, { Location: to }); res.end(); }
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
function homepageCanonicalPath({ q = '', label = '', page = 1 } = {}) {
  return q ? '/' : pageUrl({ label, page });
}
function renderPagination({ q = '', label = '', page = 1, totalPages = 1, totalPosts = 0 } = {}) {
  if (totalPages <= 1) return '';

  const firstVisiblePage = Math.min(Math.max(page - 1, 1), Math.max(totalPages - 2, 1));
  const pages = Array.from({ length: Math.min(3, totalPages) }, (_, index) => firstVisiblePage + index);
  const pageOptions = Array.from({ length: totalPages }, (_, index) => index + 1).map(number => `<option value="${escapeHtml(pageUrl({ q, label, page: number }))}"${number === page ? ' selected' : ''}>Pagina ${number} van ${totalPages}</option>`).join('');
  return `<nav class="pagination" aria-label="Forum posts pagina's"><label class="page-picker"><span class="visually-hidden">Ga naar pagina</span><select data-page-select aria-label="Pagina ${page} van ${totalPages}; selecteer een pagina">${pageOptions}</select><span>· ${formatNumber(totalPosts)} verhalen</span></label><div><a class="button secondary${page === 1 ? ' disabled' : ''}" href="${page === 1 ? '#' : pageUrl({ q, label, page: page - 1 })}" aria-label="Vorige pagina"${page === 1 ? ' aria-disabled="true" tabindex="-1"' : ''}>← Vorige</a>${pages.map(number => number === page ? `<span class="page-current" aria-current="page">${number}</span>` : `<a class="page-link" href="${pageUrl({ q, label, page: number })}">${number}</a>`).join('')}<a class="button secondary${page === totalPages ? ' disabled' : ''}" href="${page === totalPages ? '#' : pageUrl({ q, label, page: page + 1 })}" aria-label="Volgende pagina"${page === totalPages ? ' aria-disabled="true" tabindex="-1"' : ''}>Volgende →</a></div></nav>`;
}

function burnoutInsightCta() {
  return `<section class="external-forum-cta" aria-labelledby="burnout-insight-title"><div><p class="eyebrow">Nieuwe vragen stellen</p><h2 id="burnout-insight-title">Zoek je een actieve plek om verder te praten?</h2><p>Hyperpedia bewaart oudere forumverhalen als archief. Wil je zelf anoniem delen, reageren op anderen of herkenning vinden bij mensen die nu hetzelfde meemaken? Bezoek dan het forum van Burnout Insight en kom in contact met lotgenoten.</p></div><a class="button" href="https://www.burnoutinsight.com" target="_blank" rel="noopener noreferrer">Naar Burnout Insight</a></section>`;
}

function loginPage(message = '') {
  return `<section class="login-hero"><div><p class="eyebrow">Portal</p><h1>Beheerlogin</h1><p>Log in om het Hyperpedia-archief aan te vullen, verhalen bij te werken en reacties te beheren.</p></div><div class="login-card stack">${message ? `<p class="login-error" role="alert">${escapeHtml(message)}</p>` : ''}<form method="post" action="/login" class="stack"><label>Gebruikersnaam<input name="username" autocomplete="username" required></label><label>Wachtwoord<input name="password" type="password" autocomplete="current-password" required></label><button>Inloggen</button></form></div></section>`;
}
function loginPageOptions(req) {
  return { canonicalPath: '/login', siteUrl: getSiteUrl(req), robots: 'noindex, nofollow' };
}
function loginKey(req) {
  return String(req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function getLoginAttempt(key, now = Date.now()) {
  if (now - lastLoginAttemptCleanup >= LOGIN_ATTEMPT_CLEANUP_INTERVAL_MS) {
    for (const [attemptKey, attempt] of loginAttempts) {
      if (attempt.expiresAt <= now || (attempt.lockedUntil && attempt.lockedUntil <= now)) loginAttempts.delete(attemptKey);
    }
    lastLoginAttemptCleanup = now;
  }

  const attempt = loginAttempts.get(key);
  if (attempt && (attempt.expiresAt <= now || (attempt.lockedUntil && attempt.lockedUntil <= now))) {
    loginAttempts.delete(key);
    return undefined;
  }
  return attempt;
}
function renderReplies(post, { admin = false } = {}) {
  const replies = post.replies || [];
  if (!replies.length) return '';

  return `<section class="replies" aria-labelledby="replies-title"><h2 id="replies-title">Reacties</h2>${replies.map(reply => `<article class="reply"><p class="eyebrow">Reactie op ${escapeHtml(reply.originalReplier || post.author)}</p><h3>${escapeHtml(reply.author || 'Beheerder')}</h3><div>${escapeHtml(reply.body).replace(/\n/g, '<br>')}</div>${admin ? `<div class="reply-actions"><a class="button secondary" href="/admin/reply/${post.id}/${reply.id}/edit">Reactie bewerken</a><form method="post" action="/admin/reply/${post.id}/${reply.id}/delete"><button class="danger" type="submit">Reactie verwijderen</button></form></div>` : ''}</article>`).join('')}</section>`;
}

function formatNumber(value) { return new Intl.NumberFormat('nl-NL').format(value); }
function adminDashboard() {
  const stats = getStats();
  const topReadCount = Math.max(1, ...stats.postReads.map(post => post.read_count));
  const topReadPosts = stats.postReads.slice(0, 5);
  const readRows = topReadPosts.map(post => `<li><div><a href="/posts/${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a></div><meter min="0" max="${topReadCount}" value="${post.read_count}"></meter><strong>${formatNumber(post.read_count)}</strong><form method="post" action="/admin/read-metrics/${encodeURIComponent(post.id)}/purge"><button class="danger" type="submit">Purge</button></form></li>`).join('');
  return `<section class="admin-overview"><div><p class="eyebrow">Beheerder portal</p><h1>Overzicht</h1><p>Volg in één oogopslag hoeveel verhalen zijn ingevoerd, gelezen en beantwoord.</p></div><div class="stats-grid"><article><span>${formatNumber(stats.readCount)}</span><p>Gelezen posts</p></article><article><span>${formatNumber(stats.postCount)}</span><p>Ingevoerde posts</p></article><article><span>${formatNumber(stats.replyCount)}</span><p>Reacties</p></article></div></section><section class="panel metrics-panel"><div class="section-heading"><p class="eyebrow">Leesstatistieken</p><h2>Reads per post</h2><p>Een handig overzicht van welke vijf verhalen het vaakst zijn geopend.</p></div><ol class="read-metrics">${readRows || '<li class="empty">Nog geen verhalen om te meten.</li>'}</ol></section>`;
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
  if (redirectToCanonicalOrigin(req, res)) return;
  const method = req.method;
  const pathname = req.urlObj.pathname;
  if (pathname === '/style.css') return send(res, fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css')), 200, 'text/css');
  if (pathname === '/app.js') return send(res, fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js')), 200, 'application/javascript');
  if (pathname === '/site.webmanifest') return send(res, fs.readFileSync(path.join(__dirname, '..', 'public', 'site.webmanifest')), 200, 'application/manifest+json; charset=utf-8');
  if (pathname === '/social-preview.svg') return send(res, fs.readFileSync(path.join(__dirname, '..', 'public', 'social-preview.svg')), 200, 'image/svg+xml; charset=utf-8');
  if (method === 'GET' && pathname === '/robots.txt') return send(res, `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', getSiteUrl(req)).toString()}\n`, 200, 'text/plain; charset=utf-8');
  if (method === 'GET' && pathname === '/sitemap.xml') {
    const siteUrl = getSiteUrl(req);
    const posts = allPosts();
    const latestPostTimestamp = Math.max(0, ...posts.map(post => Date.parse(post.updated_at || post.created_at || '')) .filter(Number.isFinite));
    const homepageLastmod = latestPostTimestamp ? new Date(latestPostTimestamp).toISOString() : '';
    const urls = [{ loc: '/', lastmod: homepageLastmod, changefreq: 'daily', priority: '1.0' }, ...posts.map(post => ({ loc: `/posts/${encodeURIComponent(post.id)}`, lastmod: toIsoDate(post.updated_at || post.created_at), changefreq: 'weekly', priority: '0.8' }))];
    return send(res, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `\n  <url>\n    <loc>${escapeXml(new URL(url.loc, siteUrl).toString())}</loc>${url.lastmod ? `\n    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : ''}\n    <changefreq>${url.changefreq}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`).join('')}\n</urlset>`, 200, 'application/xml; charset=utf-8');
  }
  if (method === 'GET' && pathname === '/') {
    if (req.urlObj.searchParams.has('perPage')) {
      req.urlObj.searchParams.delete('perPage');
      return redirect(res, `${pathname}${req.urlObj.search}`, 308);
    }
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
    const resultTitle = q ? `Zoekresultaten voor “${escapeHtml(q)}”` : label ? `Verhalen over ${escapeHtml(label)}` : 'Alle verhalen';
    const pageTitle = q ? `Zoeken naar ${q}` : label ? `Verhalen over ${label}` : page > 1 ? `Verhalen – pagina ${page}` : 'Start';
    const description = label ? `Lees herkenbare ervaringen over ${label}, stress, ademhaling en lichamelijke sensaties op Hyperpedia.` : undefined;
    const labels = allLabels.map(l => { const selected = l === label; return `<a class="label${selected ? ' selected' : ''}" href="${selected ? pageUrl({ q }) : pageUrl({ q, label: l })}"${selected ? ' aria-current="true"' : ''}>${escapeHtml(l)}</a>`; }).join('');
    const content = `<section class="hero home-hero"><div class="hero-copy"><p class="eyebrow">Een rustig leesarchief</p><h1>Herkenning voor onrustige momenten</h1><p>Lees op je eigen tempo ervaringen over stress, ademhaling en vreemde lichamelijke sensaties. Soms helpt het al om te merken dat je niet de enige bent.</p><div class="calm-note"><strong>Rustig lezen, zonder account</strong><span>Je hoeft niets te plaatsen of bij te houden. Kies alleen wat op dit moment prettig voelt.</span></div></div><section class="daily-stories" aria-labelledby="daily-stories-title"><div class="section-heading"><p class="eyebrow">Een verhaal voor vandaag</p><h2 id="daily-stories-title">Misschien herken je iets</h2></div>${renderStoriesOfTheDay(dailyStories)}</section></section><section class="toolbar" aria-labelledby="find-stories-title"><div class="section-heading"><p class="eyebrow">Vind herkenning</p><h2 id="find-stories-title">Waar wil je over lezen?</h2></div><form class="search-form" role="search"><label for="story-search">Zoek in alle verhalen en reacties</label><div class="search-controls"><input id="story-search" name="q" value="${escapeHtml(q)}" placeholder="Bijvoorbeeld tintelingen, benauwdheid of duizeligheid"><button>Zoeken</button></div></form><div class="filter-heading"><strong>Thema's</strong>${label ? '<a href="/">Wis selectie</a>' : ''}</div><div class="labels">${labels}</div></section><section class="stories-index" aria-labelledby="stories-title"><div class="section-heading stories-heading"><div><p class="eyebrow">Ervaringen uit het archief</p><h2 id="stories-title">${resultTitle}</h2></div><p>${formatNumber(totalPosts)} ${totalPosts === 1 ? 'verhaal' : 'verhalen'}</p></div><div class="grid" data-post-grid>${visiblePosts.length ? visiblePosts.map(postCard).join('') : '<p class="empty">Hier zijn nog geen verhalen voor gevonden. Probeer een ander woord of thema.</p>'}</div></section>${pagination}${burnoutInsightCta()}`;
    return send(res, layout(pageTitle, content, { admin: isAdmin(req), description, canonicalPath: homepageCanonicalPath({ q, label, page }), siteUrl: getSiteUrl(req), robots: q ? 'noindex, follow' : 'index, follow', structuredData: homepageStructuredData(posts, req) }));
  }
  if (method === 'POST' && pathname.startsWith('/posts/') && pathname.endsWith('/read')) {
    const parts = pathname.split('/');
    const id = decodeURIComponent(parts[2] || '');
    const post = recordPostRead(id);
    return send(res, JSON.stringify({ ok: Boolean(post) }), post ? 200 : 404, 'application/json; charset=utf-8');
  }
  if (method === 'GET' && pathname.startsWith('/posts/')) {
    const id = decodeURIComponent(pathname.split('/').pop()); const post = allPosts().find(item => item.id === id);
    if (!post) return send(res, layout('Niet gevonden', '<p class="empty">Dit verhaal bestaat niet.</p>', { admin: isAdmin(req), canonicalPath: pathname, siteUrl: getSiteUrl(req), robots: 'noindex, follow' }), 404);
    return send(res, layout(post.title, `${isAdmin(req) ? '<article class="story">' : `<article class="story" data-post-id="${escapeHtml(post.id)}">`}<a class="back-link" href="/">← Terug naar alle verhalen</a><p class="eyebrow story-author">${escapeHtml(post.author)}</p><h1>${escapeHtml(post.title)}</h1><div class="labels">${(post.labels||[]).map(l=>`<a class="label" href="/?label=${encodeURIComponent(l)}">${escapeHtml(l)}</a>`).join('')}</div><div class="body">${escapeHtml(post.body).replace(/\n/g, '<br>')}</div>${renderReplies(post, { admin: isAdmin(req) })}${isAdmin(req) ? `<p><a class="button" href="/admin/edit/${post.id}">Bewerken</a></p>${adminReplyForm(post)}` : ''}</article>`, { admin: isAdmin(req), description: toSeoDescription(post.body, post.title), canonicalPath: `/posts/${encodeURIComponent(post.id)}`, type: 'article', siteUrl: getSiteUrl(req), structuredData: postStructuredData(post, req) }));
  }

  if (method === 'POST' && pathname.startsWith('/admin/read-metrics/') && pathname.endsWith('/purge')) {
    if (requireAdmin(req,res)) return;
    const [, , , postId] = pathname.split('/').map(decodeURIComponent);
    purgePostRead(postId);
    return redirect(res, '/admin');
  }
  if (method === 'GET' && pathname === '/login') return send(res, layout('Login', loginPage(), loginPageOptions(req)));
  if (method === 'POST' && pathname === '/login') {
    const key = loginKey(req);
    const now = Date.now();
    const attempt = getLoginAttempt(key, now);
    if (attempt?.lockedUntil > now) {
      const seconds = Math.ceil((attempt.lockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(seconds));
      return send(res, layout('Login', loginPage(`Te veel mislukte pogingen. Probeer het over ${seconds} seconden opnieuw.`), loginPageOptions(req)), 429);
    }
    const body = await collect(req);
    const admin = getAdmin();
    if (!admin || admin.username !== body.username || !verifyPassword(body.password || '', admin)) {
      const failures = (attempt?.failures || 0) + 1;
      const lockedUntil = failures >= LOGIN_MAX_FAILURES ? now + LOGIN_LOCK_MS : 0;
      loginAttempts.set(key, { failures, lockedUntil, expiresAt: now + LOGIN_ATTEMPT_TTL_MS });
      if (lockedUntil) res.setHeader('Retry-After', '60');
      const message = lockedUntil ? 'Te veel mislukte pogingen. Wacht 60 seconden voordat je het opnieuw probeert.' : 'Inloggen mislukt. Controleer je gebruikersnaam en wachtwoord.';
      return send(res, layout('Login', loginPage(message), loginPageOptions(req)), lockedUntil ? 429 : 401);
    }
    loginAttempts.delete(key);
    const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, true); res.writeHead(302, { Location: '/admin', 'Set-Cookie': `hyperpedia_session=${sid}.${sign(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` }); return res.end();
  }
  if (method === 'POST' && pathname === '/logout') { res.writeHead(302, { Location: '/', 'Set-Cookie': 'hyperpedia_session=; Path=/; Max-Age=0' }); return res.end(); }
  if (method === 'GET' && pathname === '/admin') { if (requireAdmin(req,res)) return; return send(res, layout('Beheer', `${adminDashboard()}<section class="panel admin-form-panel"><h1>Nieuw verhaal toevoegen</h1><form method="post" action="/admin/posts" class="stack"><label>Titel<input name="title" required></label><label>Naam oorspronkelijke auteur<input name="author" required></label><label>Labels <small>komma-gescheiden</small><input name="labels" placeholder="ademhaling, duizeligheid, geruststelling"></label><label>Forumtekst<textarea name="body" rows="14" required></textarea></label><button>Opslaan</button></form></section>`, { admin: true })); }
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
