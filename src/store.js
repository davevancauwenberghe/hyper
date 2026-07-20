const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = process.env.DATA_DIR || '/data';
fs.mkdirSync(dataDir, { recursive: true });
const storePath = path.join(dataDir, 'hyper-posts.json');
const adminPath = path.join(dataDir, 'hyper-admin.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function allPosts() { return readJson(storePath, { posts: [] }).posts; }
function savePosts(posts) { writeJson(storePath, { posts }); }
function getAdmin() { return readJson(adminPath, null); }
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
module.exports = { allPosts, savePosts, getAdmin, saveAdmin, verifyPassword };
