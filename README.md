# Hyperpedia

Hyperpedia is een rustige Nederlandstalige encyclopedie met forumverhalen over hyperventilatie, vreemde lichamelijke sensaties, hyperarousal, stress en zenuwstelselontregeling.

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
4. Bewaar `SESSION_SECRET` als Fly secret en hergebruik dezelfde waarde tussen deploys, anders worden sessies ongeldig. Als deze secret ontbreekt start de app met een tijdelijke secret zodat Fly-healthchecks niet falen, maar bestaande adminsessies vervallen bij iedere restart.
5. Zet secrets op Fly:

```bash
fly secrets set SESSION_SECRET="$(openssl rand -base64 48)"
```

6. Maak na de eerste deploy een admin aan in de machine met de gemounte database. Gebruik hiervoor `fly ssh console`, niet je lokale `DATA_DIR=./data`, want Fly leest de admin uit `/data/hyperpedia-admin.json` op het volume:

```bash
fly ssh console -a hyperpedia -C 'cd /app && node scripts/create-admin.js beheerder "een-heel-lang-uniek-wachtwoord"'
```

### Login op productie herstellen

Als je lokaal `DATA_DIR=./data npm run create-admin -- ...` hebt gedraaid en daarna deployt, staat de admin alleen op je Mac in `./data/hyperpedia-admin.json`. Die lokale map wordt niet naar het Fly-volume gekopieerd. Herstel productie zo:

```bash
fly secrets set -a hyperpedia SESSION_SECRET="$(openssl rand -base64 48)"
fly deploy -a hyperpedia
fly ssh console -a hyperpedia -C 'cd /app && node scripts/create-admin.js beheerder "een-heel-lang-uniek-wachtwoord"'
```

Let op: verander `SESSION_SECRET` daarna niet meer bij iedere start of deploy. Een nieuwe secret maakt alleen bestaande sessiecookies ongeldig; het adminwachtwoord zelf staat los daarvan in `/data/hyperpedia-admin.json`.

## Deploy naar Fly.io

Maak eerst het volume in dezelfde regio als `fly.toml`:

```bash
fly volumes create hyperpedia_data --region ams --size 1
fly deploy
```

De posts worden opgeslagen in `/data/hyperpedia-posts.json`, dus ze blijven behouden tussen deploys zolang het volume bestaat.

## Fly luisteradres

Fly verwacht dat de Node-server op `0.0.0.0:8080` luistert. De startcode in `src/server.js` gebruikt daarom `process.env.PORT || 8080` en bindt aan `process.env.HOST || '0.0.0.0'`, zodat de Fly Proxy de app kan bereiken.
