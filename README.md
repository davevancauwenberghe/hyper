# Hyper

Hyper is een rustige Nederlandstalige encyclopedie met forumverhalen over hyperventilatie, vreemde lichamelijke sensaties, hyperarousal, stress en zenuwstelselontregeling.

## Lokaal starten

```bash
npm install
SESSION_SECRET="$(openssl rand -base64 48)" DATA_DIR=./data npm run create-admin -- beheerder "kies-een-lang-wachtwoord"
SESSION_SECRET="$(openssl rand -base64 48)" DATA_DIR=./data npm start
```

Open daarna `http://localhost:8080` en ga naar `/login`.

## Veilige login instellen

1. Kies één beheerderaccount; alleen ingelogde beheerders kunnen verhalen toevoegen of bewerken.
2. Gebruik een uniek wachtwoord van minimaal 16 tekens, bij voorkeur uit een wachtwoordmanager.
3. Het wachtwoord wordt nooit plaintext opgeslagen: `scripts/create-admin.js` hasht het met PBKDF2-SHA256 met 310.000 iteraties voordat het in de data-mount komt.
4. Bewaar `SESSION_SECRET` als Fly secret en hergebruik dezelfde waarde tussen deploys, anders worden sessies ongeldig.
5. Zet secrets op Fly:

```bash
fly secrets set SESSION_SECRET="$(openssl rand -base64 48)"
```

6. Maak na de eerste deploy een admin aan in de machine met de gemounte database:

```bash
fly ssh console -C 'cd /app && node scripts/create-admin.js beheerder "een-heel-lang-uniek-wachtwoord"'
```

## Deploy naar Fly.io

Maak eerst het volume in dezelfde regio als `fly.toml`:

```bash
fly volumes create hyper_data --region ams --size 1
fly deploy
```

De posts worden opgeslagen in `/data/hyper-posts.json`, dus ze blijven behouden tussen deploys zolang het volume bestaat.
