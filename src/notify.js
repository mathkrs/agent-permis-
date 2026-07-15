const nodemailer = require('nodemailer');

async function sendEmail(subject, text) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFY_EMAIL_TO) {
    console.error('[notify] email ignoré: variables SMTP_* / NOTIFY_EMAIL_TO manquantes dans .env');
    return false;
  }
  const port = Number(SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({ from: SMTP_USER, to: NOTIFY_EMAIL_TO, subject, text });
  return true;
}

// ntfy.sh : service de notification push gratuit, sans compte. Le
// destinataire s'abonne au "topic" dans l'app mobile ntfy (iOS/Android)
// ou sur https://ntfy.sh/<topic>. Le topic doit être traité comme un
// secret (quiconque le connaît peut lire/poster dessus).
async function sendNtfy(message, opts = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.error('[notify] ntfy ignoré: variable NTFY_TOPIC manquante dans .env');
    return false;
  }
  const url = `https://ntfy.sh/${encodeURIComponent(topic)}`;
  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  // En-têtes HTTP: rester en ASCII pour éviter les soucis d'encodage.
  if (opts.title) headers['Title'] = opts.title;
  if (opts.priority) headers['Priority'] = opts.priority;
  if (opts.tags) headers['Tags'] = opts.tags;
  const res = await fetch(url, { method: 'POST', body: message, headers });
  if (!res.ok) {
    console.error('[notify] échec envoi ntfy:', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

module.exports = { sendEmail, sendNtfy };
