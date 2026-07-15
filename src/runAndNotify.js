#!/usr/bin/env node
/**
 * Point d'entrée à lancer périodiquement (cron / Tâche planifiée
 * Windows). Exécute la vérification de disponibilité, compare au
 * dernier état connu (state.json, non commité) pour éviter les
 * notifications en double, et notifie par email + ntfy.sh en cas de
 * nouvelle disponibilité — ou en cas de panne du vérificateur
 * lui-même (site changé, CAPTCHA détecté, etc.), pour ne pas rester
 * des semaines sans surveillance réelle sans le savoir.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sendEmail, sendNtfy } = require('./notify');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'state.json');
const SITE_URL = 'https://ge.ch/tradispoweb_public/ui/app/init/conduite/prive/login';

const STRUCTURAL_ERRORS = new Set([
  'captcha_detected',
  'login_failed',
  'login_fields_not_found',
  'submit_button_not_found',
]);

function loadPrevState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function runCheck() {
  try {
    const stdout = execFileSync('node', [path.join(ROOT, 'src', 'checkAvailability.js')], {
      encoding: 'utf8',
      env: process.env,
    });
    return stdout;
  } catch (e) {
    // checkAvailability.js quitte avec un code non-zéro sur les erreurs
    // gérées (login échoué, captcha, etc.) mais imprime quand même un
    // JSON de diagnostic sur stdout avant de sortir.
    return e.stdout ? e.stdout.toString() : '';
  }
}

async function main() {
  const stdout = runCheck();
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
  let result;
  try {
    result = JSON.parse(lastLine);
  } catch (e) {
    console.error('[runAndNotify] sortie du check illisible:', stdout);
    process.exit(1);
  }

  const prev = loadPrevState();
  const prevAvailable = !!(prev && prev.result && prev.result.available);
  const prevErrorNotified = !!(prev && prev.lastErrorNotified);

  const newState = { result, checkedAt: new Date().toISOString(), lastErrorNotified: prevErrorNotified };

  if (result.available && !prevAvailable) {
    const dateList = result.dates.map((d) => d.date).join(', ');
    const subject = `Date d'examen de conduite disponible : ${dateList}`;
    const body = [
      `Une ou plusieurs dates sont disponibles entre ${result.dateRange.start} et ${result.dateRange.end} :`,
      '',
      ...result.dates.map((d) => `- ${d.date} (${d.text})`),
      '',
      `Réserve vite : ${SITE_URL}`,
    ].join('\n');

    await sendEmail(subject, body);
    await sendNtfy(`Date(s) dispo: ${dateList}. Reserve vite: ${SITE_URL}`, {
      title: 'Examen de conduite disponible !',
      priority: 'urgent',
      tags: 'car,rotating_light',
    });
    newState.lastErrorNotified = false;
    console.log('[runAndNotify] nouvelle disponibilité -> notifications envoyées');
  } else if (result.error && STRUCTURAL_ERRORS.has(result.error) && !prevErrorNotified) {
    const subject = `Vérificateur d'examen de conduite en panne (${result.error})`;
    const body = [
      `Le script n'arrive plus à vérifier les disponibilités (erreur: ${result.error}).`,
      'Le site a peut-être changé de structure, ou affiche un CAPTCHA.',
      `Vérifie manuellement : ${SITE_URL}`,
    ].join('\n');

    await sendEmail(subject, body);
    await sendNtfy(body, { title: 'Verificateur en panne', priority: 'high', tags: 'warning' });
    newState.lastErrorNotified = true;
    console.log('[runAndNotify] panne détectée -> alerte envoyée');
  } else if (!result.error) {
    newState.lastErrorNotified = false;
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
  console.log(JSON.stringify({ available: result.available, error: result.error || null }));
}

main().catch((e) => {
  console.error('[runAndNotify] échec inattendu:', e);
  process.exit(1);
});
