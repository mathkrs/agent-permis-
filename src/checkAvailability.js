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
 * IMPORTANT : ce script n'a jamais pu être exécuté contre le vrai site
 * (accès réseau bloqué au moment de l'écriture). Les sélecteurs listés
 * dans CONFIG ci-dessous sont des hypothèses à valider/corriger lors du
 * premier run réel (voir README.md).
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
  // Textes / labels probables des champs de connexion (FABER = identifiant
  // figurant sur la convocation/lettre OCV).
  nipLabelPatterns: [/faber/i, /n°?\s*nip/i, /identifiant/i],
  birthdateLabelPatterns: [/naissance/i, /date de naissance/i],
  submitTextPatterns: [/connexion/i, /se connecter/i, /valider/i, /continuer/i],
  // Textes indiquant explicitement "pas de date dispo" sur la page de résultat.
  noAvailabilityPatterns: [/aucune disponibilit/i, /pas de rendez-vous/i, /aucun rendez-vous disponible/i, /aucune date/i],
  // Sélecteur générique des cases de calendrier cliquables/disponibles.
  availableSlotSelectors: [
    '.available:not(.disabled)',
    '[data-available="true"]',
    'button.slot-available',
    'td.calendar-day.available',
  ],
};

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

async function fillByLabelPatterns(page, patterns, value) {
  // Essaie plusieurs stratégies Playwright pour trouver le bon champ,
  // car on ne connaît pas la structure DOM réelle du formulaire.
  for (const pattern of patterns) {
    try {
      const byLabel = page.getByLabel(pattern);
      if (await byLabel.count()) {
        await byLabel.first().fill(value);
        return true;
      }
    } catch (_) {}
    try {
      const byPlaceholder = page.getByPlaceholder(pattern);
      if (await byPlaceholder.count()) {
        await byPlaceholder.first().fill(value);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function clickByTextPatterns(page, patterns) {
  for (const pattern of patterns) {
    try {
      const btn = page.getByRole('button', { name: pattern });
      if (await btn.count()) {
        await btn.first().click();
        return true;
      }
    } catch (_) {}
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

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    headless: true,
  });
  const page = await browser.newPage();

  const result = { ok: false, loggedIn: false, available: false, dates: [], debug: {} };

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

    const filledNip = await fillByLabelPatterns(page, CONFIG.nipLabelPatterns, nip);
    const filledBirthdate = await fillByLabelPatterns(page, CONFIG.birthdateLabelPatterns, birthdate);

    if (!filledNip || !filledBirthdate) {
      result.debug = await dumpDebug(page, 'login-form-not-found');
      result.error = 'login_fields_not_found';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(3);
    }

    const clicked = await clickByTextPatterns(page, CONFIG.submitTextPatterns);
    if (!clicked) {
      result.debug = await dumpDebug(page, 'submit-button-not-found');
      result.error = 'submit_button_not_found';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(3);
    }

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

    // Heuristique très simple : si le formulaire de login a disparu et
    // qu'on ne voit pas de message d'erreur de connexion, on considère
    // que le login a réussi.
    const loginErrorVisible = /identifiant.*incorrect|erreur de connexion|invalide/i.test(bodyText);
    result.loggedIn = !loginErrorVisible;

    if (!result.loggedIn) {
      result.debug = await dumpDebug(page, 'login-failed');
      result.error = 'login_failed';
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(5);
    }

    const noAvailability = CONFIG.noAvailabilityPatterns.some((p) => p.test(bodyText));

    let availableSlots = [];
    for (const sel of CONFIG.availableSlotSelectors) {
      try {
        const els = await page.locator(sel).all();
        if (els.length) {
          for (const el of els) {
            const t = (await el.innerText().catch(() => '')).trim();
            if (t) availableSlots.push(t);
          }
        }
      } catch (_) {}
    }

    result.ok = true;
    result.available = !noAvailability && availableSlots.length > 0;
    result.dates = availableSlots;
    result.debug = await dumpDebug(page, 'post-login-state');

    console.log(JSON.stringify(result));
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
