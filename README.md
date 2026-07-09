# Remmerswaal Security — CRM

Interne CRM-webapplicatie voor Remmerswaal Security. Beheer klanten, financien,
abonnementen en afspraken vanuit één beveiligd systeem.

## Tech stack

- **Backend:** Node.js + Express (REST API)
- **Database:** SQLite (via `better-sqlite3`), opgeslagen op een Docker volume
- **Frontend:** Vanilla HTML/CSS/JS (geen framework)
- **Authenticatie:** JWT tokens, wachtwoorden gehasht met bcrypt
- **Deployment:** Docker + docker-compose

## Functionaliteit

1. **Login** — gebruikersnaam/wachtwoord, JWT-sessie van 12 uur
2. **Dashboard** — MRR, actieve klanten, actieve abonnementen, omzet deze maand/jaar, recente activiteit
3. **Klanten** — CRUD, zoeken en filteren op status/dienst
4. **Financieel overzicht** — MRR, omzet per klant, omzet per dienst, jaaroverzicht, eenmalige betalingen
5. **Abonnementen** — actieve retainers met verlengingsalerts (binnen 14 dagen)
6. **Afspraken & notities** — planning per klant met type (Intake/Scan/Nabespreking/Factuur)
7. **Instellingen** — wachtwoord wijzigen, gebruikers beheren
8. **Toestemmingsdocument (PDF)** — genereer vanuit een klantrecord een
   ondertekenbare PDF met de scan-toestemmingsvoorwaarden, met
   dienst-specifieke tekst op basis van het type dienst van de klant. Zie
   [`docs/consent-pdf.md`](docs/consent-pdf.md).

Alle teksten zijn in het Nederlands, datums in `DD-MM-YYYY` en bedragen in euro's.

## Snel starten met Docker

Vereisten: Docker en Docker Compose op een Linux VPS.

```bash
git clone <repository-url>
cd degiro
docker compose up -d --build
```

De applicatie draait vervolgens op **http://<server-ip>:3000**.

Data wordt persistent opgeslagen in het Docker volume `remmerswaal_crm_data`
(SQLite-bestand onder `/app/data/crm.sqlite` in de container), dus deze blijft
behouden bij herstarten, `git pull` of het herbouwen van het image.

De applicatie bevat **geen voorbeeld- of testdata**. Bij een volledig lege
database wordt alleen eenmalig de standaard inlogaccounts (`robin`/`dani`)
aangemaakt — er worden nooit automatisch klanten, afspraken of abonnementen
toegevoegd.

### Belangrijk bij herimplementeren/updaten

- Gebruik `docker compose down` (**niet** `docker compose down -v`) gevolgd
  door `docker compose up -d --build` om te updaten — de `-v` flag verwijdert
  volumes en dus alle klantdata.
- Verplaats of hernoem de projectmap op de VPS niet tussen deployments. De
  `name: remmerswaal-crm` bovenaan `docker-compose.yml` zorgt er wel voor dat
  het volume altijd dezelfde naam (`remmerswaal_crm_data`) krijgt, ongeacht de
  mapnaam waarin het project staat, maar consistentie in het deployproces
  blijft aan te raden.
- Een back-up maken kan met: `docker run --rm -v remmerswaal_crm_data:/data -v $(pwd):/backup alpine tar czf /backup/crm-backup.tar.gz -C /data .`


**Wijzig deze wachtwoorden direct na de eerste keer inloggen** via de
Instellingen-pagina.

## Handmatig draaien (zonder Docker)

Vereisten: Node.js 20+.

```bash
npm install
npm start
```

De app luistert standaard op poort 3000. Zet eventueel een `.env` bestand met:

```
PORT=3000
JWT_SECRET=een-lange-willekeurige-string
DATA_DIR=./data
INTERNAL_API_KEY=een-lange-willekeurige-string-voor-interne-api-toegang
```

Als `JWT_SECRET` niet is ingesteld, genereert de server automatisch een
willekeurig secret en slaat dit op in `data/.jwt_secret` zodat sessies geldig
blijven bij herstart. `INTERNAL_API_KEY` wordt **niet** automatisch
gegenereerd: zonder deze variabele staat de interne API (`/api/internal/*`,
zie [`docs/gvm-integration.md`](docs/gvm-integration.md)) op slot (HTTP 500
op elk verzoek), in plaats van open te staan.

## HTTPS / reverse proxy

De applicatie luistert enkel op HTTP poort 3000 en is bedoeld om achter een
reverse proxy (bijv. Nginx, Caddy of Traefik) met TLS-terminatie te draaien.
Voorbeeld met Nginx:

```nginx
server {
    listen 443 ssl;
    server_name crm.remmerswaalsecurity.nl;

    ssl_certificate     /etc/letsencrypt/live/crm.remmerswaalsecurity.nl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.remmerswaalsecurity.nl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Projectstructuur

```
degiro/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── docs/
│   ├── gvm-integration.md   # CRM ↔ Greenbone/GVM koppeling + consent-gating
│   └── consent-pdf.md       # toestemmings-PDF-generator (dashboard-functie)
├── orchestrator/            # los Python-proces, spreekt GMP met gvmd (zie docs/gvm-integration.md)
│   ├── gvm_orchestrator.py
│   ├── requirements.txt
│   └── tests/
├── server/
│   ├── index.js            # process bootstrap (dotenv, JWT_SECRET) + luistert op PORT
│   ├── app.js                # Express app wiring (los van index.js, voor tests)
│   ├── db.js                # SQLite schema + eenmalige admin-account setup
│   ├── middleware/
│   │   ├── auth.js          # JWT verificatie (dashboard)
│   │   └── apiKey.js        # API-key verificatie (interne/machine routes)
│   ├── routes/
│   │   ├── auth.js
│   │   ├── clients.js
│   │   ├── subscriptions.js
│   │   ├── appointments.js
│   │   ├── dashboard.js
│   │   ├── financial.js
│   │   ├── users.js
│   │   └── internal.js      # klanten/consent/scans, API-key beveiligd
│   ├── utils/
│   │   ├── activity.js      # activiteitenlog
│   │   ├── finance.js       # omzetberekeningen (MRR, jaaroverzicht)
│   │   ├── validate.js      # inputvalidatie
│   │   ├── scope.js         # consent-scope matching (IP/CIDR/domein)
│   │   └── consentPdf.js    # toestemmings-PDF-generator (pdfkit)
│   └── __tests__/
└── public/
    ├── index.html            # login
    ├── dashboard.html
    ├── clients.html
    ├── financial.html
    ├── subscriptions.html
    ├── appointments.html
    ├── settings.html
    ├── css/style.css         # dark cyber theme
    └── js/                   # fetch()-gebaseerde frontend logica
```

## Beveiliging

- Wachtwoorden worden gehasht met bcrypt (nooit in platte tekst opgeslagen)
- Alle dashboard API-routes (behalve `/api/auth/login`) vereisen een geldig JWT-token
- De interne machine-naar-machine API (`/api/internal/*`) vereist een aparte
  API-key (`INTERNAL_API_KEY`, zie [`docs/gvm-integration.md`](docs/gvm-integration.md))
  en staat standaard op slot als deze niet is ingesteld
- Serverzijdige inputvalidatie op alle create/update endpoints
- Aanbevolen: draai achter een reverse proxy met HTTPS (zie boven)
- Wijzig de standaard wachtwoorden direct na installatie

## Data-model (SQLite)

- `users` — inloggegevens en accountnamen
- `clients` — klantgegevens, status, dienst, maandwaarde, notities
- `subscriptions` — retainer-abonnementen gekoppeld aan een klant
- `appointments` — geplande afspraken gekoppeld aan een klant
- `payments` — eenmalige betalingen
- `activity_log` — activiteitenfeed voor het dashboard
- `client_consents` — vastgelegde toestemming om te scannen (zie hieronder)
- `scans` — GVM-scans, verplicht gekoppeld aan een consent-record
- `consent_documents` — log van gegenereerde toestemmings-PDF's per klant
  (zie [`docs/consent-pdf.md`](docs/consent-pdf.md))

## GVM/Greenbone-integratie (vulnerability scans)

Een aparte, API-key-beveiligde interne API (`/api/internal/*`) en een los
Python-orchestratorproces (`orchestrator/`) koppelen dit CRM aan een
Greenbone/GVM-instantie om scans aan te vragen — met een harde,
niet-omzeilbare consent-check voordat een scan ooit wordt aangemaakt. Zie
[`docs/gvm-integration.md`](docs/gvm-integration.md) voor de volledige
documentatie: architectuurkeuze, env vars, endpoint-referentie met
curl-voorbeelden, en de aannames die hierbij zijn gemaakt.

## Toestemmingsdocument (consent-PDF)

Een aparte, JWT-beveiligde dashboard-functie (**geen** onderdeel van de
`/api/internal/*` GVM-integratie hierboven) waarmee je vanuit een
klantrecord met één klik een PDF genereert met de
scan-toestemmingsvoorwaarden, met tekst die automatisch wordt gekozen op
basis van het type dienst van de klant. Zie
[`docs/consent-pdf.md`](docs/consent-pdf.md) voor de volledige
documentatie: welke library, waar PDF's worden opgeslagen (en hoe dat
automatisch in de bestaande backup-strategie meeloopt), de
endpoint-referentie en de gemaakte aannames.
