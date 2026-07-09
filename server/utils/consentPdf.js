// Generates the "Toestemmingsverklaring Externe Vulnerability Scan" PDF for
// a client, using pdfkit (pure-JS, no headless Chrome — see docs/consent-pdf.md
// for why). The legal text shown depends on the client's service_type, kept
// as a lookup (SERVICE_CONSENT_TEXT) rather than separate template files so a
// new service or a wording change only needs a single edit.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { DATA_DIR } = require('../db');

const CONSENTS_DIR = path.join(DATA_DIR, 'consents');

// No physical business address exists anywhere in this repo (README, docs,
// or the codebase) at the time this was written. Rather than invent one,
// this is left as a visible TODO in the generated PDF's letterhead.
const COMPANY_NAME = 'Remmerswaal Security';
const COMPANY_ADDRESS_LINES = [
  '[TODO: vestigingsadres invullen — straat, huisnummer, postcode, plaats]',
];

const FIXED_CLAUSES = [
  'Opdrachtgever kan de hieronder gegeven toestemming te allen tijde schriftelijk intrekken. ' +
    'Intrekking ontslaat Remmerswaal Security direct van elke verdere verplichting of bevoegdheid ' +
    'om (vervolg)werkzaamheden binnen de omschreven scope uit te voeren.',
  'Het scannen, benaderen of onderzoeken van IT-systemen zonder voorafgaande, expliciete toestemming ' +
    'van de rechthebbende is in Nederland niet toegestaan en kan worden aangemerkt als computervredebreuk ' +
    '(art. 138ab e.v. Wetboek van Strafrecht). Dit document vormt de expliciete, schriftelijke toestemming ' +
    'die daarvoor is vereist en is de reden dat dit document bestaat.',
];

// Keyed by clients.service_type. This is the single place to add a new
// service or change wording — no per-service PDF templates.
const SERVICE_CONSENT_TEXT = {
  'Externe Scan': {
    heading: 'Aard van de werkzaamheden — Externe Vulnerability Scan',
    paragraphs: [
      'Remmerswaal Security voert een eenmalige externe vulnerability scan uit op de hieronder ' +
        'vermelde IP-adressen en/of domeinen ("de Scope"). Doel van de scan is het identificeren van ' +
        'kwetsbaarheden vanaf het publieke internet.',
      'De werkzaamheden zijn beperkt tot het opsporen en rapporteren van kwetsbaarheden. Er vindt geen ' +
        'exploitatie van gevonden kwetsbaarheden of andere vorm van aanval plaats, tenzij hierover apart ' +
        'en schriftelijk andere afspraken zijn gemaakt.',
      'Deze toestemming is eenmalig en niet-doorlopend: zij geldt uitsluitend voor de hierboven vermelde ' +
        'Scope en voor dit specifieke moment, en strekt zich niet uit tot toekomstige scans.',
    ],
  },
  'Security Audit': {
    heading: 'Aard van de werkzaamheden — Security Audit',
    paragraphs: [
      'Remmerswaal Security voert een eenmalige externe vulnerability scan uit op de hieronder ' +
        'vermelde IP-adressen en/of domeinen ("de Scope"). Doel van de scan is het identificeren van ' +
        'kwetsbaarheden vanaf het publieke internet.',
      'De werkzaamheden zijn beperkt tot het opsporen en rapporteren van kwetsbaarheden. Er vindt geen ' +
        'exploitatie van gevonden kwetsbaarheden of andere vorm van aanval plaats, tenzij hierover apart ' +
        'en schriftelijk andere afspraken zijn gemaakt.',
      'Daarnaast kan de audit intern netwerkonderzoek omvatten (bijvoorbeeld via VPN- of on-site-toegang) ' +
        'en een controle van webapplicaties. Opdrachtgever verklaart zich ermee bekend dat hiermee, indien ' +
        'van toepassing, ook toegang tot interne systemen en/of inloggegevens aan Remmerswaal Security kan ' +
        'worden verschaft. De precieze reikwijdte hiervan wordt voorafgaand apart met Opdrachtgever afgestemd.',
      'Deze toestemming is eenmalig en niet-doorlopend: zij geldt uitsluitend voor de hierboven vermelde ' +
        'Scope en voor dit specifieke moment, en strekt zich niet uit tot toekomstige audits.',
    ],
  },
  Retainer: {
    heading: 'Aard van de werkzaamheden — Retainer (doorlopende monitoring)',
    paragraphs: [
      'Remmerswaal Security voert, zolang het retainer-abonnement van Opdrachtgever loopt, doorlopend ' +
        '(onder andere maandelijkse) monitoring en vulnerability scans uit op de hieronder vermelde ' +
        'IP-adressen en/of domeinen ("de Scope"). Doel is het periodiek identificeren van kwetsbaarheden.',
      'De werkzaamheden zijn beperkt tot het opsporen en rapporteren van kwetsbaarheden. Er vindt geen ' +
        'exploitatie van gevonden kwetsbaarheden of andere vorm van aanval plaats, tenzij hierover apart ' +
        'en schriftelijk andere afspraken zijn gemaakt.',
      'LET OP — INTREKKING: Opdrachtgever kan deze doorlopende toestemming op elk moment schriftelijk ' +
        'intrekken. Intrekking voorkomt de eerstvolgende geplande scan en alle scans daarna; reeds ' +
        'uitgevoerde scans worden door intrekking niet met terugwerkende kracht ongedaan gemaakt.',
    ],
  },
};

class ConsentPdfError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ConsentPdfError';
    this.code = code;
  }
}

// Returns { heading, paragraphs, usedDefault }. Throws ConsentPdfError with
// code SERVICE_TYPE_NOT_APPLICABLE for KnowBe4 — that service is
// security-awareness training, not scanning, so no scan-consent text may
// ever be generated for it.
function getConsentTextForServiceType(serviceType) {
  if (serviceType === 'KnowBe4') {
    throw new ConsentPdfError(
      'Dit type toestemmingsdocument (scan-toestemming) is niet van toepassing op de dienst "KnowBe4" ' +
        '(security-awareness training, geen vulnerability scanning). Kies voor deze klant het juiste ' +
        'documenttype — dat bestaat momenteel nog niet in dit systeem.',
      'SERVICE_TYPE_NOT_APPLICABLE'
    );
  }

  if (serviceType && SERVICE_CONSENT_TEXT[serviceType]) {
    return { ...SERVICE_CONSENT_TEXT[serviceType], usedDefault: false };
  }

  // No/unknown service_type: fall back to the most conservative (one-off,
  // external-only) text, and flag it so the caller can warn the user.
  return { ...SERVICE_CONSENT_TEXT['Externe Scan'], usedDefault: true };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTimestampForFilename(date) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

function formatDateNl(date) {
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function buildDocumentReference(clientId, date) {
  return `RS-C${clientId}-${formatTimestampForFilename(date)}`;
}

function buildPdfBuffer({ client, scope, consentText, documentReference, generatedByName, now }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Letterhead ---
    doc.font('Helvetica-Bold').fontSize(16).text(COMPANY_NAME);
    doc.font('Helvetica').fontSize(9.5).fillColor('#444444');
    COMPANY_ADDRESS_LINES.forEach((line) => doc.text(line));
    doc.fillColor('#000000');
    doc.moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(14).text('Toestemmingsverklaring Externe Vulnerability Scan');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`Documentreferentie: ${documentReference}`);
    doc.text(`Datum: ${formatDateNl(now)}`);
    doc.fillColor('#000000');
    doc.moveDown(1);

    // --- Client details ---
    doc.font('Helvetica-Bold').fontSize(11).text('Klantgegevens');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Bedrijfsnaam: ${client.company_name || '-'}`);
    doc.text(`Contactpersoon: ${client.contact_person || '-'}`);
    doc.text(`E-mail: ${client.email || '-'}`);
    doc.moveDown(0.8);

    // --- Scope ---
    doc.font('Helvetica-Bold').fontSize(11).text('Scope (geautoriseerde IP-adressen / domeinen)');
    doc.font('Helvetica').fontSize(10).text(scope && scope.trim() ? scope.trim() : '(nog niet opgegeven)');
    doc.moveDown(0.8);

    // --- Service-specific clauses ---
    doc.font('Helvetica-Bold').fontSize(11).text(consentText.heading);
    doc.font('Helvetica').fontSize(10);
    consentText.paragraphs.forEach((p) => {
      doc.text(p, { align: 'justify' });
      doc.moveDown(0.5);
    });
    doc.moveDown(0.3);

    // --- Fixed clauses (always present) ---
    doc.font('Helvetica-Bold').fontSize(11).text('Algemene bepalingen');
    doc.font('Helvetica').fontSize(10);
    FIXED_CLAUSES.forEach((p) => {
      doc.text(p, { align: 'justify' });
      doc.moveDown(0.5);
    });
    doc.moveDown(1);

    // --- Signature block ---
    doc.font('Helvetica-Bold').fontSize(11).text('Ondertekening');
    doc.moveDown(0.5);

    const startY = doc.y;
    const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 24) / 2;
    const leftX = doc.page.margins.left;
    const rightX = leftX + colWidth + 24;

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Namens Remmerswaal Security', leftX, startY, { width: colWidth });
    doc.text(`Namens ${client.company_name || 'Opdrachtgever'}`, rightX, startY, { width: colWidth });

    doc.font('Helvetica').fontSize(10);
    doc.text(`Naam: ${generatedByName || '-'}`, leftX, startY + 18, { width: colWidth });
    doc.text('Naam: ______________________', rightX, startY + 18, { width: colWidth });

    doc.text('Functie: ______________________', leftX, startY + 38, { width: colWidth });
    doc.text('Functie: ______________________', rightX, startY + 38, { width: colWidth });

    doc.text(`Datum: ${formatDateNl(now)}`, leftX, startY + 58, { width: colWidth });
    doc.text('Datum: ______________________', rightX, startY + 58, { width: colWidth });

    doc.text('Handtekening:', leftX, startY + 78, { width: colWidth });
    doc.text('Handtekening:', rightX, startY + 78, { width: colWidth });
    doc.rect(leftX, startY + 94, colWidth, 50).stroke('#999999');
    doc.rect(rightX, startY + 94, colWidth, 50).stroke('#999999');

    doc.end();
  });
}

// Generates the PDF, writes it under DATA_DIR/consents/, and returns it
// together with the metadata the caller needs. Deliberately does not throw
// on a missing/empty scope — an incomplete document is preferable to a
// crashed request, and the PDF itself shows "(nog niet opgegeven)".
async function generateConsentPdf({ client, scope, generatedByName }) {
  if (!client || client.id === undefined || client.id === null) {
    throw new ConsentPdfError('client is verplicht.', 'INVALID_ARGUMENT');
  }

  const consentText = getConsentTextForServiceType(client.service_type);
  const now = new Date();
  const documentReference = buildDocumentReference(client.id, now);

  const buffer = await buildPdfBuffer({ client, scope, consentText, documentReference, generatedByName, now });

  fs.mkdirSync(CONSENTS_DIR, { recursive: true });
  const filename = `consent-${client.id}-${formatTimestampForFilename(now)}.pdf`;
  const filePath = path.join(CONSENTS_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  return {
    buffer,
    filename,
    filePath,
    documentReference,
    usedDefaultServiceType: consentText.usedDefault,
  };
}

function listConsentPdfs(clientId) {
  if (!fs.existsSync(CONSENTS_DIR)) return [];
  const prefix = `consent-${clientId}-`;
  return fs
    .readdirSync(CONSENTS_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.pdf'))
    .map((name) => {
      const stat = fs.statSync(path.join(CONSENTS_DIR, name));
      return { filename: name, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

module.exports = {
  CONSENTS_DIR,
  ConsentPdfError,
  generateConsentPdf,
  listConsentPdfs,
  getConsentTextForServiceType,
};
