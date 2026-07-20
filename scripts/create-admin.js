const { saveAdmin } = require('../src/store');

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 12) {
  console.error('Gebruik: DATA_DIR=./data node scripts/create-admin.js <gebruikersnaam> <wachtwoord-van-minimaal-12-tekens>');
  process.exit(1);
}
saveAdmin(username, password);
console.log('Admin opgeslagen. Het wachtwoord staat alleen als PBKDF2-SHA256-hash in de data-mount.');
