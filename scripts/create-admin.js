const path = require('node:path');
const { saveAdmin } = require('../src/store');

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 12) {
  console.error('Gebruik: DATA_DIR=./data node scripts/create-admin.js <gebruikersnaam> <wachtwoord-van-minimaal-12-tekens>');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || '/data';
saveAdmin(username, password);
console.log(`Admin opgeslagen in ${path.join(dataDir, 'hyperpedia-admin.json')}.`);
console.log('Het wachtwoord staat alleen als PBKDF2-SHA256-hash in de data-mount.');
