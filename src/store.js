const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = process.env.DATA_DIR || '/data';
fs.mkdirSync(dataDir, { recursive: true });
const storePath = path.join(dataDir, 'hyperpedia-posts.json');
const legacyStorePath = path.join(dataDir, 'hyper-posts.json');
const adminPath = path.join(dataDir, 'hyperpedia-admin.json');
const legacyAdminPath = path.join(dataDir, 'hyper-admin.json');
const READ_METRICS_VERSION = '1.0.0b';

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
  const readCount = post.read_metrics_version === READ_METRICS_VERSION ? Number(post.read_count || 0) : 0;
  return { ...post, replies: post.replies || [], read_count: readCount, read_metrics_version: READ_METRICS_VERSION };
}
function allPosts() { return readJsonWithLegacy(storePath, legacyStorePath, { posts: [] }).posts.map(normalizePost); }
function savePosts(posts) { writeJson(storePath, { posts: posts.map(normalizePost) }); }
function recordPostRead(id) {
  const posts = allPosts();
  const post = posts.find(item => item.id === id);
  if (!post) return null;
  post.read_count = Number(post.read_count || 0) + 1;
  post.updated_at = new Date().toISOString();
  savePosts(posts);
  return post;
}
function getStats() {
  const posts = allPosts();
  const replyCount = posts.reduce((total, post) => total + (post.replies || []).length, 0);
  const readCount = posts.reduce((total, post) => total + Number(post.read_count || 0), 0);
  const postReads = posts
    .map(post => ({ id: post.id, title: post.title, author: post.author, read_count: Number(post.read_count || 0) }))
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
module.exports = { allPosts, savePosts, recordPostRead, getStats, getAdmin, saveAdmin, verifyPassword };
