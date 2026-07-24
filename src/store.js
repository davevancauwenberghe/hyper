const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = process.env.DATA_DIR || '/data';
fs.mkdirSync(dataDir, { recursive: true });
const storePath = path.join(dataDir, 'hyperpedia-posts.json');
const legacyStorePath = path.join(dataDir, 'hyper-posts.json');
const adminPath = path.join(dataDir, 'hyperpedia-admin.json');
const legacyAdminPath = path.join(dataDir, 'hyper-admin.json');
const readMetricsPath = path.join(dataDir, 'hyperpedia-read-metrics.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function readJsonWithLegacy(file, legacyFile, fallback) {
  if (fs.existsSync(file)) return readJson(file, fallback);
  return readJson(legacyFile, fallback);
}
function normalizePost(post) {
  const { read_count, read_metrics_version, ...content } = post;
  return { ...content, replies: content.replies || [] };
}
function allPosts() { return readJsonWithLegacy(storePath, legacyStorePath, { posts: [] }).posts.map(normalizePost); }
function savePosts(posts) { writeJson(storePath, { posts: posts.map(normalizePost) }); }
function getReadMetrics() {
  const stored = readJson(readMetricsPath, { posts: {} });
  return stored && typeof stored.posts === 'object' && stored.posts ? stored : { posts: {} };
}
function saveReadMetrics(metrics) { writeJson(readMetricsPath, { posts: metrics.posts || {} }); }
function purgePostRead(id) {
  const metrics = getReadMetrics();
  const existed = Object.prototype.hasOwnProperty.call(metrics.posts || {}, id);
  metrics.posts[id] = { read_count: 0, purged_at: new Date().toISOString() };
  saveReadMetrics(metrics);
  return existed;
}
function metricCount(metrics, id) { return Number(metrics.posts?.[id]?.read_count || 0); }
function migrateEmbeddedReadCounts(posts, metrics) {
  let changed = false;
  for (const post of posts) {
    const embeddedCount = Number(post.read_count || 0);
    if (!Object.prototype.hasOwnProperty.call(metrics.posts || {}, post.id) && embeddedCount > 0) {
      metrics.posts[post.id] = { read_count: embeddedCount };
      changed = true;
    }
  }
  if (changed) saveReadMetrics(metrics);
  return metrics;
}
function recordPostRead(id) {
  const rawPosts = readJsonWithLegacy(storePath, legacyStorePath, { posts: [] }).posts;
  const post = rawPosts.find(item => item.id === id);
  if (!post) return null;
  const metrics = migrateEmbeddedReadCounts(rawPosts, getReadMetrics());
  metrics.posts[id] = { read_count: metricCount(metrics, id) + 1 };
  saveReadMetrics(metrics);
  return { ...normalizePost(post), read_count: metrics.posts[id].read_count };
}
function getStats() {
  const rawPosts = readJsonWithLegacy(storePath, legacyStorePath, { posts: [] }).posts;
  const metrics = migrateEmbeddedReadCounts(rawPosts, getReadMetrics());
  const posts = rawPosts.map(normalizePost);
  const replyCount = posts.reduce((total, post) => total + (post.replies || []).length, 0);
  const readCount = posts.reduce((total, post) => total + metricCount(metrics, post.id), 0);
  const postReads = posts
    .map(post => ({ id: post.id, title: post.title, author: post.author, read_count: metricCount(metrics, post.id) }))
    .filter(post => post.read_count > 0)
    .sort((a, b) => b.read_count - a.read_count || String(a.title || '').localeCompare(String(b.title || ''), 'nl'));
  return { postCount: posts.length, readCount, replyCount, postReads };
}
function getAdmin() { return readJsonWithLegacy(adminPath, legacyAdminPath, null); }
function saveAdmin(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 310000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  writeJson(adminPath, { username, salt, iterations, hash, algorithm: 'pbkdf2-sha256' });
}
function verifyPassword(password, admin) {
  if (!admin) return false;
  const hash = crypto.pbkdf2Sync(password, admin.salt, admin.iterations, 32, 'sha256');
  return crypto.timingSafeEqual(hash, Buffer.from(admin.hash, 'hex'));
}
module.exports = { allPosts, savePosts, recordPostRead, purgePostRead, getStats, getAdmin, saveAdmin, verifyPassword };
