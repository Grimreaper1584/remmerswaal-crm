# CRM ↔ Greenbone/GVM integratie

Koppelt dit CRM aan een Greenbone Community Edition (GVM/OpenVAS)-stack om
vulnerability scans aan te vragen namens klanten — met één
niet-onderhandelbare regel: **een scan wordt nooit aangemaakt zonder een
vastgelegd, niet-ingetrokken consent-record dat het target dekt.** Dit is
geen UI-waarschuwing maar een harde constraint in zowel de API-laag als de
database-laag (zie "Consent-gating" hieronder).

## Inhoud

- [Architectuurkeuze](#architectuurkeuze)
- [Consent-gating](#consent-gating)
- [Data-model](#data-model)
- [Env vars](#env-vars)
- [Endpoint-referentie](#endpoint-referentie)
- [GVM-verbinding: socket vs TLS](#gvm-verbinding-socket-vs-tls)
- [Statusupdates: polling, geen GVM-alerts](#statusupdates-polling-geen-gvm-alerts)
- [Aannames en beperkingen](#aannames-en-beperkingen)

## Architectuurkeuze

**Gekozen: optie A — los Python-orchestratorproces (`orchestrator/`),
cron-getriggerd, dat zowel de CRM-interne-API als GVM/GMP aanroept.**

Redenen, gebaseerd op wat er in deze repo staat:

- De CRM heeft geen enkele bestaande achtergrondjob/queue-infrastructuur
  (geen worker, geen cron-integratie, geen message queue) om op aan te
  sluiten — er is dus geen bestaand patroon dat pleit vóór optie B.
- De CRM-container heeft geen Python, en `python-gvm` heeft geen
  Node-equivalent. Optie B zou `python3` + `pip` + `python-gvm` in de
  CRM-Docker-image trekken, puur voor dit ene stukje functionaliteit — dat
  vergroot de image, de attack surface van een altijd-actief proces, en de
  RAM-voetafdruk op een VPS die al de volledige Greenbone-stack ernaast
  draait (4GB totaal, genoemd als randvoorwaarde).
- Een cron-getriggerd script draait alleen tijdens zijn eigen run en is
  daarna weer weg — geen extra altijd-actief proces, in tegenstelling tot
  een Node `child_process`-aanroep die alsnog een Python-interpreter in de
  CRM-container nodig heeft.
- De consent-check zelf (de kern van de opdracht) staat volledig in de
  Node/Express-laag, waar hij hoort: de CRM beslist óf een scan mag
  bestaan, de orchestrator voert alleen uit wát al goedgekeurd is. De
  orchestrator ziet nooit consent-logica en kan die dus ook nooit
  omzeilen.

Consequentie van deze keuze: `POST /api/clients/:id/scans` (in de praktijk
`POST /api/internal/clients/:id/scans`, zie hieronder) roept GVM **niet**
synchroon aan. Het endpoint doet alleen de consent-check en zet een
scan-record met status `pending` klaar. De orchestrator plukt `pending`
scans op bij zijn volgende cron-run, praat dan met `gvmd`, en zet de status
via `PATCH /api/internal/scans/:id/status` terug naar `running` (met
`gvm_task_id`/`gvm_target_id`) of `failed`.

### Afwijking van de letterlijke endpoint-paths

De opdracht noemt `POST /api/clients`, `POST /api/clients/:id/consent`,
etc. — dezelfde prefix als de bestaande, JWT-beveiligde dashboard-routes
in `server/routes/clients.js`. Om te voorkomen dat twee verschillende
auth-mechanismes (JWT voor mensen, API-key voor machines) op exact
hetzelfde pad+method botsen (`POST /api/clients` bestaat al, JWT-only),
zijn alle nieuwe interne routes verplaatst naar een apart prefix:
**`/api/internal/*`**. Bestaande routes zijn volledig ongemoeid gelaten.

## Consent-gating

Twee onafhankelijke lagen, met opzet redundant:

1. **API-laag** (`server/routes/internal.js`, `POST
   /api/internal/clients/:id/scans`): zoekt alle niet-ingetrokken
   consent-records (`revoked_at IS NULL`) van de klant op, en controleert
   via `server/utils/scope.js` of het opgegeven target binnen de scope van
   minstens één record valt. Geen match → **HTTP 403**, geen scan-record
   wordt geschreven.
2. **Data-laag** (`server/db.js`): `scans.consent_id` is `NOT NULL` met een
   foreign key naar `client_consents(id)`, zonder default. Er bestaat geen
   enkel code- of SQL-pad dat een scan-rij kan schrijven zonder naar een
   bestaand consent-record te verwijzen — ook niet per ongeluk vanuit een
   toekomstige endpoint die deze check vergeet.

Scope-matching (`isTargetCoveredByScope`) ondersteunt exacte IP/domein-
matches, IPv4 CIDR-ranges (`10.0.0.0/24`), wildcard-subdomeinen
(`*.example.nl`) en kale domeinen die hun eigen subdomeinen dekken
(`example.nl` dekt ook `shop.example.nl`). Zie
`server/__tests__/scope.test.js` voor het volledige gedrag, en
`server/__tests__/consent-gating.test.js` voor de end-to-end
consent-gating tests op de API zelf (geen consent → 403, ingetrokken
consent → 403, andere klant → 403, buiten scope → 403, geldig → 201).

## Data-model

```sql
client_consents
  id, client_id, scope, authorized_by, authorized_at,
  document_reference, revoked_at, created_at

scans
  id, client_id, consent_id (NOT NULL FK), target_value, scan_config,
  gvm_task_id, gvm_target_id, status, error_message,
  created_at, completed_at
```

`document_reference` is een vrij tekstveld (bijv. een URL naar een
ondertekend PDF elders opgeslagen) — het document zelf wordt niet door dit
systeem beheerd.

## Env vars

### CRM (`.env` in de repo-root, nooit gecommit — zie `.gitignore`)

| Variabele | Verplicht | Omschrijving |
|---|---|---|
| `INTERNAL_API_KEY` | Ja, voor `/api/internal/*` | Enkele server-side key. Zonder deze variabele antwoordt elke interne route met `500` (fail closed, niet open). |
| `JWT_SECRET` | Nee | Bestaand — dashboard-sessies. |
| `PORT`, `DATA_DIR` | Nee | Bestaand. |

Genereer een sterke key, bijvoorbeeld:

```bash
openssl rand -hex 32
```

### Orchestrator (`orchestrator/.env`, zie `orchestrator/.env.example`)

| Variabele | Verplicht | Omschrijving |
|---|---|---|
| `CRM_API_URL` | Ja | Bijv. `http://localhost:3000` of het interne Docker-adres van de CRM-container. |
| `CRM_API_KEY` | Ja | Moet gelijk zijn aan `INTERNAL_API_KEY` van de CRM. |
| `GVM_CONNECTION_TYPE` | Nee (default `socket`) | `socket` of `tls`. |
| `GVM_SOCKET_PATH` | Nee (default `/run/gvmd/gvmd.sock`) | Alleen relevant bij `socket`. |
| `GVM_HOST`, `GVM_PORT` | Bij `tls` verplicht/default `9390` | — |
| `GVM_CA_CERT_PATH`, `GVM_CERT_PATH`, `GVM_KEY_PATH` | Nee | Optioneel voor TLS met (mutual) certificaten. |
| `GVM_USERNAME`, `GVM_PASSWORD` | Ja | GMP-authenticatie — verplicht voor zowel socket als TLS. |
| `GVM_SCANNER_NAME_FILTER` | Nee (default `OpenVAS`) | Naam-filter, geen hardcoded UUID. |
| `GVM_PORT_LIST_NAME_FILTER` | Nee (default `All IANA`) | Naam-filter, geen hardcoded UUID. |
| `LOG_LEVEL` | Nee (default `INFO`) | — |

## Endpoint-referentie

Alle voorbeelden gebruiken `INTERNAL_API_KEY=test-key` tegen een lokale
CRM op poort 3000.

### `POST /api/internal/clients` — klant aanmaken/upserten

Matcht op `id` indien opgegeven, anders op exacte `company_name`; anders
insert.

```bash
curl -s http://localhost:3000/api/internal/clients \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Acme BV",
    "contact_person": "Jan Jansen",
    "email": "jan@acme.nl",
    "status": "Actief"
  }'
```

### `POST /api/internal/clients/:id/consent` — toestemming vastleggen

```bash
curl -s http://localhost:3000/api/internal/clients/1/consent \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "10.0.0.0/24, acme.nl",
    "authorized_by": "Jan Jansen (directeur Acme BV)",
    "document_reference": "https://drive.example/acme-consent-2026-07-09.pdf"
  }'
```

### `GET /api/internal/clients/:id/consent` — toestemmingen van een klant

```bash
curl -s http://localhost:3000/api/internal/clients/1/consent \
  -H "Authorization: Bearer test-key"
```

### `PATCH /api/internal/clients/:id/consent/:consentId/revoke` — intrekken

```bash
curl -s -X PATCH http://localhost:3000/api/internal/clients/1/consent/5/revoke \
  -H "Authorization: Bearer test-key"
```

### `POST /api/internal/clients/:id/scans` — scan aanvragen

`scan_config` is optioneel, default `"Discovery"`.

```bash
curl -s -i http://localhost:3000/api/internal/clients/1/scans \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{ "target_value": "10.0.0.42" }'
```

Zonder dekkend, niet-ingetrokken consent-record → `403`:

```json
{"error":"Geen geldig, niet-ingetrokken toestemmingsrecord gevonden dat dit target dekt. Scan geweigerd."}
```

### `GET /api/internal/clients/:id/scans` — scans van een klant

```bash
curl -s http://localhost:3000/api/internal/clients/1/scans \
  -H "Authorization: Bearer test-key"
```

### `GET /api/internal/scans?status=pending` — scans over alle klanten

Niet expliciet gevraagd in de opdracht, maar toegevoegd omdat de gekozen
architectuur (optie A) dit nodig heeft: de orchestrator moet ergens
kunnen ontdekken welke scans er te starten/pollen zijn zonder elke klant
individueel te doorlopen.

```bash
curl -s "http://localhost:3000/api/internal/scans?status=pending" \
  -H "Authorization: Bearer test-key"
```

### `PATCH /api/internal/scans/:id/status` — status bijwerken

Aangeroepen door de orchestrator; alle velden behalve `status` zijn
optioneel en laten bestaande waarden ongemoeid als ze worden weggelaten.

```bash
curl -s -X PATCH http://localhost:3000/api/internal/scans/7/status \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "running",
    "gvm_task_id": "0b1e2c3d-....",
    "gvm_target_id": "1a2b3c4d-...."
  }'
```

## GVM-verbinding: socket vs TLS

De orchestrator ondersteunt beide, gekozen via `GVM_CONNECTION_TYPE`:

- **Unix socket (voorkeur)** — `/run/gvmd/gvmd.sock`. Dit werkt alleen als
  het pad daadwerkelijk zichtbaar is voor het proces waarin de orchestrator
  draait. Als de orchestrator **niet** in dezelfde Docker Compose-stack
  draait als `gvmd` (waarschijnlijk, want de opdracht beschrijft ze als
  twee losse stacks), moet de Greenbone-compose het gvmd-socket-volume
  bind-mounten naar een hostpad, en moet dat pad vervolgens ook zichtbaar
  zijn voor de orchestrator (host-cron: direct; container: extra
  volume-mount). Dit is **niet getest** tegen een live instantie — verifieer
  dit zelf.
- **TLS op poort 9390 (fallback)** — vereist dat de Greenbone
  docker-compose `gvmd` (of een losse `gvmd-tls`/`gsad`-achtige listener,
  afhankelijk van de gekozen Greenbone-image) een poort naar de host of
  het gedeelde Docker-netwerk publiceert. Als dit nu niet het geval is:
  voeg in de Greenbone `docker-compose.yml` iets toe als:

  ```yaml
  services:
    gvmd:
      ports:
        - "9390:9390"   # of alleen binnen een gedeeld extern netwerk, geen host-publish
  ```

  Dit is de meest voorspelbare optie omdat hij geen gedeeld volume tussen
  twee onafhankelijke Compose-stacks vereist — alleen netwerkbereikbaarheid.

`orchestrator/gvm_orchestrator.py` doet in beide gevallen een expliciete
GMP-`authenticate()`-call (gebruikersnaam/wachtwoord); dit is niet
optioneel gemaakt omdat recente gvmd-versies dit ook over de socket
vereisen.

## Statusupdates: polling, geen GVM-alerts

**Gekozen: polling vanuit de orchestrator, elke 5 minuten via cron**
(zie `orchestrator/README.md`), niet een GVM-alert die naar de CRM
callback't.

Reden: een GVM-alert vereist dat `gvmd` uitgaand naar de CRM kan praten
(nog een netwerkpad open te zetten, in de omgekeerde richting van de
socket/TLS-verbinding hierboven), plus een SMTP-relay of HTTP-alert-method
configuratie binnen Greenbone. Polling hergebruikt de verbinding die de
orchestrator toch al opzet om scans te starten, voegt geen nieuw
netwerkpad toe, en de latency (max. 5 minuten) is verwaarloosbaar
vergeleken met de duur van een Discovery-scan.

## Aannames en beperkingen

Expliciet voor review — corrigeer waar nodig voordat dit verder gebouwd
wordt:

1. **Endpoint-prefix**: interne routes zitten op `/api/internal/*` in
   plaats van dezelfde paths als de opdracht letterlijk noemt, om
   botsing met de bestaande JWT-routes te vermijden (zie hierboven).
2. **`GET /api/internal/scans?status=pending`** is toegevoegd, niet
   expliciet gevraagd — nodig voor de gekozen architectuur (optie A).
3. **Consent-revoke endpoint** (`PATCH
   .../consent/:consentId/revoke`) is toegevoegd — zonder een manier om
   `revoked_at` via de API te zetten was dat veld anders alleen
   handmatig in de database te wijzigen, wat het doel van het veld
   ondermijnt.
4. **Scope-matching** ondersteunt alleen IPv4 CIDR-notatie (geen IPv6).
   Voor een MKB-scanpraktijk is dit vermoedelijk voldoende, maar dit is
   een aanname.
5. **Klant-upsert** (`POST /api/internal/clients`) matcht op exacte
   `company_name` als er geen `id` is meegegeven — geen fuzzy matching,
   geen matching op e-mail. Twee klanten met dezelfde bedrijfsnaam
   worden dus niet onderscheiden door dit endpoint.
6. **GVM scan-config/scanner/port-list lookup**: bij meerdere
   naam-treffers (bijv. filter `OpenVAS` matcht zowel `OpenVAS Default`
   als een eventuele tweede scanner) wordt een exacte
   naam-match geprefereerd, anders het eerste resultaat. Dit is niet
   tegen een live GVM-instantie getest.
7. **GVM-authenticatie**: `GVM_USERNAME`/`GVM_PASSWORD` worden voor zowel
   socket- als TLS-verbindingen gebruikt. Als de GVM-installatie socket-
   toegang zonder GMP-`authenticate()` toestaat (oudere versies deden dat
   soms), is dit onnodig maar onschadelijk.
8. **Orchestrator-deployment**: gedocumenteerd als host-cron (geen extra
   Docker-container) om het proces zo licht mogelijk te houden. Een
   Docker Compose-service is een prima alternatief als bind-mounten naar
   het gvmd-socket-volume dat makkelijker maakt dan cross-stack
   hostpad-mounting — die keuze hangt af van hoe de Greenbone-stack er in
   de praktijk uitziet, wat ik niet kan verifiëren zonder live toegang.
9. **Geen retry/backoff** in de orchestrator richting de CRM-API of GVM
   binnen één pass — een mislukte aanroep zet de scan op `failed` (voor
   GVM-aanroepen bij het starten) of wordt gewoon bij de volgende
   cron-run opnieuw geprobeerd (voor het pollen van `running` scans,
   waar een tijdelijke fout de scan niet verandert).
10. **`scan_config` is vrije tekst** in het scan-record (niet een enum),
    zodat elke scanconfig-naam die in de GVM-installatie bestaat gebruikt
    kan worden — de orchestrator faalt de scan pas (status `failed`) als
    de naam niet in GVM gevonden wordt.
