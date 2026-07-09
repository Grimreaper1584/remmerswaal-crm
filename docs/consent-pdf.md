# Consent-PDF-generator (toestemmingsverklaring)

Dashboard-functie waarmee je vanuit een klantrecord met één klik een PDF
genereert met de scan-toestemmingsvoorwaarden, om te printen/mailen voor
ondertekening door de klant. JWT-beveiligd, onderdeel van de gewone
ingelogde CRM-interface (`server/routes/clients.js`) — **niet** onderdeel
van de API-key-beveiligde `/api/internal/*` GVM-integratie uit
[`docs/gvm-integration.md`](gvm-integration.md). Die twee staan volledig
los van elkaar.

## Inhoud

- [PDF-library](#pdf-library)
- [Opslag](#opslag)
- [Dienst-specifieke tekst](#dienst-specifieke-tekst)
- [Endpoints](#endpoints)
- [Data-model](#data-model)
- [Aannames](#aannames)

## PDF-library

[`pdfkit`](https://pdfkit.org/) — pure JavaScript, geen headless
Chrome/Puppeteer nodig. Er stond nog geen PDF-library in de repo. Voor een
simpel, tekstgedreven zakelijk document is een lichte library ruim
voldoende, en dat scheelt geheugengebruik op een 4GB VPS die naast de CRM
ook al de Greenbone/GVM-stack draait (zie architectuurkeuze in
`docs/gvm-integration.md` voor dezelfde afweging bij de orchestrator).

## Opslag

PDF's worden geschreven naar `DATA_DIR/consents/` — dus
`/app/data/consents/` in de Docker-deployment, naast `crm.sqlite`
(`/app/data/crm.sqlite`). Bestandsnaam: `consent-{client_id}-{YYYYMMDD-HHmmss}.pdf`.

Omdat dit binnen `DATA_DIR` valt, wordt het automatisch meegenomen door de
bestaande backup-opdracht uit de README (dezelfde Docker-volume,
`remmerswaal_crm_data`, wordt in zijn geheel getard):

```bash
docker run --rm -v remmerswaal_crm_data:/data -v $(pwd):/backup alpine tar czf /backup/crm-backup.tar.gz -C /data .
```

Er is geen aparte back-upstap nodig — de PDF's zitten al in dezelfde
volume als de database.

## Dienst-specifieke tekst

De juridische tekst per dienst zit in één lookup-object,
`SERVICE_CONSENT_TEXT` in `server/utils/consentPdf.js`, geïndexeerd op
`clients.service_type`. Dat houdt het onderhoudbaar: een nieuwe dienst of
een tekstwijziging is één blok in dat object, geen nieuw PDF-template.

- **Externe Scan** — eenmalige, niet-doorlopende toestemming voor een
  externe scan; alleen identificatie van kwetsbaarheden, geen exploitatie.
- **Security Audit** — dezelfde basis als Externe Scan, plus een passage
  over mogelijk intern netwerkonderzoek (VPN/on-site) en
  webapplicatie-controle, met een expliciete vermelding dat dit ook
  toegang tot interne systemen/inloggegevens kan betekenen (apart
  af te stemmen).
- **Retainer** — doorlopende toestemming (periodieke monitoring/scans
  zolang het abonnement loopt), met een prominente clausule dat de klant
  op elk moment schriftelijk kan intrekken; intrekking voorkomt de
  eerstvolgende geplande scan maar maakt eerdere scans niet ongedaan.
- **KnowBe4** — géén scan-gerelateerde dienst (security-awareness
  training). De generator genereert hiervoor bewust **geen** PDF: het
  endpoint antwoordt met `400` en een duidelijke foutmelding, zodat er
  nooit misleidende scan-toestemmingstekst in een PDF voor een
  trainingsklant terechtkomt.
- **Leeg/onbekend `service_type`** — valt terug op de Externe-Scan-tekst
  (de meest beperkte/veilige variant) en flagt dit; de UI toont in dat
  geval een waarschuwing dat er geen dienst is geselecteerd bij de klant.

Ongeacht de dienst bevat elk document ook vaste tekst: dat toestemming
te allen tijde ingetrokken kan worden, en een verwijzing naar
computervredebreuk (art. 138ab e.v. Wetboek van Strafrecht) als de
juridische grondslag waarom dit document bestaat.

## Endpoints

Alle routes zitten onder het bestaande, JWT-beveiligde `/api/clients/*`
(`server/routes/clients.js`) — dezelfde auth als de rest van het
dashboard, geen nieuwe auth-laag.

### `POST /api/clients/:id/consent-pdf`

Body: `{ "scope": "10.0.0.0/24, voorbeeld.nl" }`. `service_type` wordt
**niet** los meegegeven — die haalt de endpoint zelf op uit het
klantrecord (`clients.service_type`) bij `:id`, zodat de gekozen tekst
altijd overeenkomt met wat er in het CRM voor die klant staat.

Retourneert het PDF direct als download
(`Content-Type: application/pdf`, `Content-Disposition: attachment`).
`400` bij ontbrekende scope of bij `service_type = "KnowBe4"`.

```bash
curl -s -X POST http://localhost:3000/api/clients/1/consent-pdf \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "scope": "10.0.0.0/24, voorbeeld.nl" }' \
  -o consent-1.pdf
```

### `GET /api/clients/:id/consent-pdfs`

Lijst van eerder gegenereerde documenten voor deze klant (bestandsnaam,
documentreferentie, dienst, scope, aanmaakdatum), nieuwste eerst.

```bash
curl -s http://localhost:3000/api/clients/1/consent-pdfs -H "Authorization: Bearer <jwt>"
```

### `GET /api/clients/:id/consent-pdfs/:filename`

Niet expliciet gevraagd in de opdracht, maar toegevoegd zodat de
"eerder gegenereerde PDF's"-lijst in de UI ook daadwerkelijk een
downloadlink kan aanbieden. Het bestand wordt opgezocht via
`consent_documents` (gescopet op `client_id`), niet direct via het
URL-pad, zodat dit endpoint niet naar een willekeurig bestand of het
document van een andere klant gewezen kan worden.

## Data-model

```sql
consent_documents
  id, client_id, filename, document_reference, service_type, scope, created_at
```

Zie [Aannames](#aannames) hieronder voor waarom dit een eigen tabel is en
niet de bestaande `client_consents` uit de GVM-integratie.

## Aannames

Expliciet voor review:

1. **Briefhoofdadres**: nergens in deze repo (README, docs, code) stond
   een fysiek vestigingsadres van Remmerswaal Security. In plaats van iets
   te verzinnen, staat er in het gegenereerde PDF een zichtbare
   `[TODO: vestigingsadres invullen — straat, huisnummer, postcode,
   plaats]`-regel onder de bedrijfsnaam. Vul dit in
   `COMPANY_ADDRESS_LINES` in `server/utils/consentPdf.js` in zodra het
   echte adres bekend is.
2. **Eigen `consent_documents`-tabel in plaats van `client_consents`**:
   de bestaande `client_consents`-tabel (GVM-integratie) heeft
   `authorized_by TEXT NOT NULL` en de rijen daarin worden door de
   scan-gating-logica (`/api/internal/clients/:id/scans`) behandeld als
   **actieve, geldige autorisatie om te scannen** — elke niet-ingetrokken
   rij met een dekkende scope is voldoende om een scan te mogen
   aanmaken. Een zojuist gegenereerd, nog niet ondertekend PDF is geen van
   beide: er is nog geen daadwerkelijke autorisatie, en `authorized_by`
   is nu eenmaal verplicht in die tabel. Een placeholder-waarde invullen
   (bijv. een lege string) zou ofwel de NOT NULL-constraint schenden, ofwel
   een consent-record aanmaken dat er via de gating-logica voor zorgt dat
   een scan al toegestaan lijkt vóórdat de klant heeft getekend — dat is
   precies het gat dat de consent-gating juist moet voorkomen. Vandaar een
   eigen, ontkoppelde `consent_documents`-tabel die alleen bijhoudt welke
   PDF's zijn gegenereerd (voor de "eerder gegenereerde documenten"-lijst
   in de UI), zonder de betekenis van `client_consents` te verzwakken.
   Wanneer een klant het document daadwerkelijk heeft ondertekend, leg je
   dat nu handmatig vast in `client_consents` (via
   `POST /api/internal/clients/:id/consent`, met `document_reference`
   verwijzend naar het bestand) — er is geen automatische koppeling of
   handtekeningdetectie.
3. **`GET /api/clients/:id/consent-pdfs/:filename`** is toegevoegd
   (niet expliciet gevraagd) zodat de lijst met eerder gegenereerde PDF's
   ook daadwerkelijk downloadbaar is vanuit de UI.
4. **Validatie van `scope`**: het endpoint vereist een niet-lege scope
   (`400` zonder). De onderliggende generatiefunctie zelf (`generateConsentPdf`)
   crasht echter niet op een ontbrekende scope — die toont dan
   `(nog niet opgegeven)` in het PDF — zodat de functie ook los
   (bijvoorbeeld door een toekomstig ander aanroeppad) veilig te gebruiken
   is.
