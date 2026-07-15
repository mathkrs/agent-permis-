#!/usr/bin/env node
/**
 * Vérifie la disponibilité d'une date d'examen pratique de conduite sur
 * le portail Tradispo de l'État de Genève (OCV) et imprime un résultat
 * JSON sur stdout :
 *
 *   { "ok": true, "loggedIn": true, "available": false, "dates": [], "screenshot": "..." }
 *
 * En cas de doute (page inconnue, CAPTCHA, changement de structure du
 * site), le script échoue explicitement plutôt que de deviner, et
 * enregistre une capture d'écran + le HTML pour permettre l'ajustement
 * des sélecteurs.
 *
 * Identifiants requis en variables d'environnement (jamais en dur dans
 * le code, jamais commités) :
 *   FABER_NIP        ex: "69365295"
 *   FABER_BIRTHDATE  ex: "04.03.2005"  (format à confirmer avec le site réel)
 *
 * Tout le parcours (login -> page d'accueil -> clic "Choisir" -> lecture
 * du calendrier hebdomadaire de créneaux) a été validé contre le vrai
 * site. En cas d'échec malgré tout (site changé, CAPTCHA), voir le
 * dossier run-output/ pour diagnostiquer (voir README.md).
 */

const path = require('path');
const fs = require('fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: 'playwright_not_installed', detail: e.message }));
  process.exit(2);
}

const LOGIN_URL = 'https://ge.ch/tradispoweb_public/ui/app/init/conduite/prive/login';
const OUT_DIR = process.env.CHECK_OUT_DIR || path.join(__dirname, '..', 'run-output');

// Points d'ajustement principaux si les sélecteurs réels diffèrent.
const CONFIG = {
  timeoutMs: 30000,
  // Seules les dates dans cette fenêtre comptent comme une disponibilité
  // exploitable (bornes incluses). Remplaçables via DATE_RANGE_START /
  // DATE_RANGE_END (format AAAA-MM-JJ) en variable d'environnement.
  dateRange: {
    start: process.env.DATE_RANGE_START || '2026-07-15',
    end: process.env.DATE_RANGE_END || '2026-08-02',
  },
  // Sélecteurs confirmés sur le vrai formulaire (Angular/PrimeNG) de
  // ge.ch/tradispoweb_public : le champ NIP FABER est un <input> classique
  // (id="candidateId"), mais le champ date de naissance est un composant
  // <p-inputmask id="birthday"> dont l'<input> réel est imbriqué à
  // l'intérieur (le label pointe vers le composant, pas vers l'input, donc
  // getByLabel ne le trouve pas).
  loginSelectors: {
    nip: '#candidateId',
    birthday: '#birthday input',
    submit: 'form button[type="submit"]',
  },
  // Sélecteurs confirmés sur la page .../rendez-vous/chooseDate : la vue
  // "Choisir" ouvre un calendrier hebdomadaire (Lundi-Vendredi) dupliqué
  // deux fois dans le DOM (une version desktop visible, une version
  // mobile cachée par CSS) — on ne cible que la version desktop
  // (#desktop) pour ne pas compter chaque créneau deux fois. Chaque jour
  // affiche soit "Aucun rendez-vous libre", soit un ou plusieurs boutons
  // ".hour button" avec l'heure du créneau.
  calendarSelectors: {
    dayBlock: '#desktop [id="jour"]',
    dayDate: 'h3',
    slotButton: '.hour button',
    nextWeekButton: '#right .navButton',
  },
};

const FRENCH_MONTHS = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};

// Extrait la première date reconnaissable d'un texte de créneau et la
// renvoie en 'AAAA-MM-JJ', ou null si aucun format connu ne matche.
// Formats supportés : jj.mm.aaaa, jj/mm/aaaa, jj-mm-aaaa, "jj <mois> aaaa".
function extractDateISO(text) {
  let m = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = text.match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
  if (m) {
    const [, d, monthName, y] = m;
    const mo = FRENCH_MONTHS[monthName.toLowerCase()];
    if (mo) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function isWithinRange(isoDate, range) {
  return isoDate >= range.start && isoDate <= range.end;
}

async function dumpDebug(page, label) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const safe = label.replace(/[^a-z0-9_-]/gi, '_');
  const png = path.join(OUT_DIR, `${safe}.png`);
  const html = path.join(OUT_DIR, `${safe}.html`);
  try {
    await page.screenshot({ path: png, fullPage: true });
    fs.writeFileSync(html, await page.content());
  } catch (e) {
    // best effort
  }
  return { png, html };
}

// Parcourt le calendrier hebdomadaire (semaine affichée, puis clic sur
// ">" pour la suivante) et collecte tous les créneaux disponibles dont la
// date tombe dans dateRange. S'arrête dès que la dernière date vue dans
// la semaine courante dépasse dateRange.end, ou après maxWeeks par
// sécurité (au cas où le site n'annoncerait jamais avoir atteint la fin).
async function collectWeeklySlots(page, sel, dateRange, timeoutMs, maxWeeks = 12) {
  const results = [];
  for (let week = 0; week < maxWeeks; week++) {
    const dayBlocks = page.locator(sel.dayBlock);
    const count = await dayBlocks.count();
    let lastDateThisWeek = null;

    for (let i = 0; i < count; i++) {
      const block = dayBlocks.nth(i);
      const dateText = await block.locator(sel.dayDate).innerText().catch(() => '');
      const iso = extractDateISO(dateText);
      if (!iso) continue;
      lastDateThisWeek = iso;

      if (isWithinRange(iso, dateRange)) {
        const slotButtons = block.locator(sel.slotButton);
        const slotCount = await slotButtons.count();
        for (let s = 0; s < slotCount; s++) {
          const timeText = (await slotButtons.nth(s).innerText().catch(() => '')).trim();
          results.push({ date: iso, time: timeText, text: `${iso} ${timeText}` });
        }
      }
    }

    if (lastDateThisWeek && lastDateThisWeek >= dateRange.end) break;

    const nextBtn = page.locator(sel.nextWeekButton).first();
    if ((await nextBtn.count()) === 0) break;
    const disabled = await nextBtn.isDisabled().catch(() => true);
    if (disabled) break;
    await nextBtn.click();
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  }
  return results;
}

// Attend, en sondant régulièrement plutôt qu'avec une seule vérification
// après networkidle (peu fiable : la validation backend peut prendre plus
// de temps que ce que networkidle laisse deviner), que le sélecteur donné
// ait disparu de la page — utilisé pour détecter une vraie sortie de
// l'écran de login sans dépendre d'un minutage fixe.
async function waitUntilGone(page, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count === 0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

// Remplit un champ à "masque de saisie" (PrimeNG p-inputmask) : .fill()
// contourne le gestionnaire de touches du masque et laisse le champ vide
// ou invalide, donc on tape les chiffres un par un pour laisser le masque
// insérer lui-même les séparateurs (ex: "." pour 99.99.9999). Le premier
// caractère tapé juste après le clic est parfois perdu par le masque
// (course entre le focus et la frappe), ce qui décale toute la saisie
// ("04.03.2005" devient "40.32.0050") — on vérifie donc la valeur
// obtenue et on réessaie en cas de décalage.
async function fillMaskedDate(page, locator, rawDate) {
  const digitsOnly = rawDate.replace(/\D/g, '');
  const expected = `${digitsOnly.slice(0, 2)}.${digitsOnly.slice(2, 4)}.${digitsOnly.slice(4, 8)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await locator.click();
    await locator.press('Control+A').catch(() => {});
    await locator.press('Delete').catch(() => {});
    await page.waitForTimeout(150);
    await locator.pressSequentially(digitsOnly, { delay: 80 });
    await page.waitForTimeout(150);
    const value = await locator.inputValue().catch(() => '');
    if (value === expected) return true;
  }
  return false;
}

async function run() {
  const nip = process.env.FABER_NIP;
  const birthdate = process.env.FABER_BIRTHDATE;
  if (!nip || !birthdate) {
    console.error(JSON.stringify({ ok: false, error: 'missing_credentials' }));
    process.exit(2);
  }

  const result = { ok: false, loggedIn: false, available: false, dates: [], debug: {} };

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  let browser;
  try {
    browser = await chromium.launch({
      // Sans CHROMIUM_PATH, on laisse Playwright utiliser le Chromium qu'il
      // a lui-même téléchargé (npx playwright install chromium).
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
    });
  } catch (e) {
    result.error = 'browser_launch_failed';
    result.detail = e.message;
    console.log(JSON.stringify(result));
    process.exit(1);
  }
  const page = await browser.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: CONFIG.timeoutMs });

    // Bannière de cookies éventuelle.
    for (const text of [/accepter/i, /tout accepter/i, /ok/i]) {
      try {
        const btn = page.getByRole('button', { name: text });
        if (await btn.count()) {
          await btn.first().click({ timeout: 2000 });
          break;
        }
      } catch (_) {}
    }

    let filledNip = false;
    let filledBirthdate = false;
    try {
      const nipInput = page.locator(CONFIG.loginSelectors.nip);
      await nipInput.waitFor({ state: 'visible', timeout: CONFIG.timeoutMs });
      await nipInput.fill(nip);
      filledNip = true;

      const birthdayInput = page.locator(CONFIG.loginSelectors.birthday);
      await birthdayInput.waitFor({ state: 'visible', timeout: CONFIG.timeoutMs });
      filledBirthdate = await fillMaskedDate(page, birthdayInput, birthdate);
    } catch (_) {}

    if (!filledNip || !filledBirthdate) {
      result.debug = await dumpDebug(page, 'login-form-not-found');
      result.error = filledNip ? 'birthdate_fill_mismatch' : 'login_fields_not_found';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(3);
    }

    let clicked = false;
    try {
      const submitBtn = page.locator(CONFIG.loginSelectors.submit);
      // .click() attend automatiquement que le bouton devienne "enabled"
      // (le formulaire Angular l'active une fois les deux champs valides).
      await submitBtn.click({ timeout: CONFIG.timeoutMs });
      clicked = true;
    } catch (_) {}

    if (!clicked) {
      result.debug = await dumpDebug(page, 'submit-button-not-found');
      result.error = 'submit_button_not_found';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(3);
    }

    // Capture immédiate (avant d'attendre networkidle) au cas où le site
    // affiche un message d'erreur transitoire (toast) qui disparaît vite.
    await page.waitForTimeout(1000);
    await dumpDebug(page, 'after-submit-click');

    await page.waitForLoadState('networkidle', { timeout: CONFIG.timeoutMs }).catch(() => {});

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const captcha = /captcha/i.test(bodyText);
    if (captcha) {
      result.debug = await dumpDebug(page, 'captcha-detected');
      result.error = 'captcha_detected';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(4);
    }

    // Vérification fiable : on sonde jusqu'à ce que le bouton "Login" du
    // formulaire ait disparu (vraie sortie de l'écran de connexion), au
    // lieu d'une seule vérification ponctuelle après networkidle — la
    // validation côté serveur peut prendre plus de temps que ça.
    const loggedInOk = await waitUntilGone(page, CONFIG.loginSelectors.submit, CONFIG.timeoutMs);
    result.loggedIn = loggedInOk;

    if (!result.loggedIn) {
      result.debug = await dumpDebug(page, 'login-failed');
      result.error = 'login_failed';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(5);
    }

    // Si un rendez-vous est déjà réservé, la page d'accueil affiche un
    // tableau "Rendez-vous existants" à la place du lien "Choisir" (qui
    // sert uniquement à en prendre un nouveau). Ce n'est pas une panne :
    // on le signale simplement comme information, sans déclencher
    // d'alerte ni de notification "nouvelle disponibilité" à chaque
    // vérification.
    const existingTable = page.locator('dw-rendez-vous-list table');
    if ((await existingTable.count()) > 0) {
      const rowText = await existingTable
        .locator('tbody tr')
        .first()
        .innerText()
        .catch(() => '');
      result.ok = true;
      result.available = false;
      result.existingAppointment = rowText.replace(/\s+/g, ' ').trim();
      result.debug = await dumpDebug(page, 'existing-appointment');
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(0);
    }

    // Depuis la page d'accueil "Rendez-vous d'examens" (sans rendez-vous
    // existant), il faut cliquer sur le lien "Choisir" de la ligne
    // Pratique/B pour arriver sur le calendrier hebdomadaire des
    // créneaux (URL .../rendez-vous/chooseDate).
    try {
      const choisirLink = page.getByText('Choisir', { exact: true });
      await choisirLink.first().waitFor({ state: 'visible', timeout: CONFIG.timeoutMs });
      await choisirLink.first().click();
      await page.waitForLoadState('networkidle', { timeout: CONFIG.timeoutMs }).catch(() => {});
      // Le lieu d'examen ("Chargement lieux...") puis le calendrier se
      // chargent de façon asynchrone après la navigation — networkidle
      // seul ne suffit pas à garantir que ce soit terminé. On attend
      // explicitement l'apparition du <select id="lieu"> confirmé lors
      // d'un test manuel, puis un nouveau networkidle pour le calendrier
      // qui se charge une fois le lieu connu.
      await page.locator('#lieu').waitFor({ state: 'visible', timeout: CONFIG.timeoutMs }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: CONFIG.timeoutMs }).catch(() => {});
      await page.waitForTimeout(1000);
    } catch (e) {
      result.debug = await dumpDebug(page, 'choisir-link-not-found');
      result.error = 'choisir_link_not_found';
      result.detail = e.message;
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(3);
    }

    const slots = await collectWeeklySlots(
      page,
      CONFIG.calendarSelectors,
      CONFIG.dateRange,
      CONFIG.timeoutMs
    );

    result.ok = true;
    result.available = slots.length > 0;
    result.dates = slots;
    result.dateRange = CONFIG.dateRange;
    result.debug = await dumpDebug(page, 'chooseDate-page');
    console.log(JSON.stringify(result));
    await browser.close();
    process.exit(0);
  } catch (e) {
    try {
      result.debug = await dumpDebug(page, 'unexpected-error');
    } catch (_) {}
    result.error = 'unexpected_error';
    result.detail = e.message;
    console.log(JSON.stringify(result));
    await browser.close();
    process.exit(1);
  }

  await browser.close();
  process.exit(0);
}

run();
