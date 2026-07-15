# Agent de surveillance des disponibilités d'examen de conduite (OCV Genève)

Ce projet vérifie périodiquement les disponibilités d'examen pratique de
conduite sur le portail Tradispo de l'État de Genève
(`ge.ch/tradispoweb_public`), et notifie l'utilisateur par **email** et
**push mobile (ntfy.sh)** dès qu'une date est trouvée dans la fenêtre
souhaitée.

Conçu pour tourner **en local** (ton ordinateur), via une tâche
planifiée (cron / Planificateur de tâches Windows). Un environnement
Claude Code cloud a été testé mais ne peut pas faire tourner un
navigateur automatisé complet vers un site externe (voir « Pourquoi
en local » plus bas).

## État actuel — ⚠️ à lire avant d'activer

Ce script **n'a pas encore pu être exécuté avec succès contre le vrai
site** (le navigateur automatisé s'est heurté à un blocage réseau
propre à l'environnement cloud utilisé pour le développement — un
simple `curl`/`fetch` passait, mais pas le trafic Chromium). En
conséquence :

- Les sélecteurs utilisés dans `src/checkAvailability.js` (noms de
  champs, textes de boutons, messages d'indisponibilité) sont des
  **hypothèses raisonnables**, pas des valeurs confirmées.
- Il est possible que le site utilise un CAPTCHA sur le formulaire de
  connexion, ce qui empêcherait toute automatisation complète — le
  script le détecte et s'arrête proprement (`error: "captcha_detected"`)
  plutôt que de forcer quoi que ce soit.
- **Un premier run réel en local est nécessaire** pour ajuster `CONFIG`
  en haut de `src/checkAvailability.js` (labels de champs, sélecteurs
  de créneaux disponibles, messages d'indisponibilité). En cas
  d'échec, une capture d'écran + le HTML de la page sont sauvegardés
  dans `run-output/` pour permettre l'ajustement.

## Installation locale

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
git clone <ce dépôt>
cd agent-permis-
npm install
npx playwright install chromium   # télécharge le navigateur nécessaire
cp .env.example .env
```

Puis remplis `.env` :

- `FABER_NIP`, `FABER_BIRTHDATE` : déjà pré-remplis pour toi si tu as
  cloné cette branche, sinon voir la convocation OCV.
- `DATE_RANGE_START` / `DATE_RANGE_END` : fenêtre de dates acceptables
  (par défaut 2026-07-15 → 2026-08-02).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL_TO` :
  pour la notification email. Avec Gmail : `smtp.gmail.com`, port
  `587`, et un **mot de passe d'application** (pas ton mot de passe
  normal — à générer sur myaccount.google.com/apppasswords, nécessite
  la validation en 2 étapes).
- `NTFY_TOPIC` : nom de topic [ntfy.sh](https://ntfy.sh) unique et
  secret pour la notification push mobile. Installe l'app ntfy
  (iOS/Android) et abonne-toi au même topic.

Test manuel :

```bash
npm start
```

Ça doit afficher un JSON du type `{"available":false,"error":null}`
(ou `"error":"login_fields_not_found"` etc. si les sélecteurs doivent
être ajustés — regarde alors les fichiers dans `run-output/`).

## Planifier l'exécution automatique

### macOS / Linux (cron)

```bash
crontab -e
# Vérifie toutes les 15 minutes :
*/15 * * * * cd /chemin/vers/agent-permis- && /usr/bin/node src/runAndNotify.js >> cron.log 2>&1
```

### Windows (Planificateur de tâches)

1. Ouvrir "Planificateur de tâches" → "Créer une tâche de base"
2. Déclencheur : répéter toutes les 15 minutes
3. Action : démarrer un programme
   - Programme : `node`
   - Arguments : `src\runAndNotify.js`
   - Démarrer dans : chemin complet vers le dossier `agent-permis-`

## Fonctionnement

1. `src/checkAvailability.js` (Node.js + Playwright) : se connecte
   avec le NIP FABER + date de naissance, détecte les créneaux
   disponibles dans la fenêtre de dates configurée, imprime un JSON
   sur stdout.
2. `src/runAndNotify.js` : exécute le check, compare au dernier état
   connu (`state.json`, non commité) pour n'envoyer une notification
   que sur un **changement** (nouvelle disponibilité, ou nouvelle
   panne du vérificateur lui-même — site changé, CAPTCHA, etc.), puis
   envoie email + notification ntfy via `src/notify.js`.

## Identifiants et secrets

Identifiants (NIP FABER + date de naissance), mot de passe SMTP et
topic ntfy sont tous dans `.env` — fichier local, **jamais commité**
(voir `.gitignore`). Ne les partage avec personne : le topic ntfy en
particulier n'a aucune authentification, quiconque le connaît peut lire
tes notifications.

## Limites connues

- Aucune garantie face à un éventuel CAPTCHA ou changement de structure
  du site — à surveiller lors des premiers runs (une alerte est
  envoyée automatiquement si le vérificateur tombe en panne).
- Les identifiants FABER sont propres à une convocation OCV donnée ;
  s'ils expirent ou changent, mettre à jour `.env`.
