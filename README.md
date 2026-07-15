# Agent de surveillance des disponibilités d'examen de conduite (OCV Genève)

Ce projet vérifie périodiquement les disponibilités d'examen pratique de
conduite sur le portail Tradispo de l'État de Genève
(`ge.ch/tradispoweb_public`), et notifie l'utilisateur par **email** et
**push mobile (ntfy.sh)** dès qu'une date est trouvée dans la fenêtre
souhaitée.

Conçu pour tourner **en local** (ton ordinateur), via une tâche
planifiée (cron / Planificateur de tâches Windows). Un environnement
Claude Code cloud a été testé mais ne peut pas faire tourner un
navigateur automatisé complet vers un site externe — le trafic HTTP
simple (curl/fetch) passe, mais les connexions Chromium sont coupées
par l'infrastructure réseau du cloud, d'où le choix d'une exécution
locale.

## État actuel

Le parcours complet a été validé contre le vrai site : connexion (NIP
FABER + date de naissance), navigation vers le calendrier de créneaux,
lecture des disponibilités réelles, notification. Testé en conditions
réelles via une tâche planifiée Windows tournant toutes les 15 minutes.

Le script gère aussi le cas où un rendez-vous est **déjà réservé** : la
page d'accueil affiche alors un tableau "Rendez-vous existants" au lieu
du calendrier ; le script le détecte et le signale simplement comme
information (`existingAppointment`), sans fausse alerte de panne.

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

- `FABER_NIP`, `FABER_BIRTHDATE` : identifiants de la convocation OCV
  (voir la lettre/convocation).
- `DATE_RANGE_START` / `DATE_RANGE_END` : fenêtre de dates acceptables
  (format AAAA-MM-JJ).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL_TO` :
  pour la notification email. Avec Gmail : `smtp.gmail.com`, port
  `587`, et un **mot de passe d'application** (pas ton mot de passe
  normal — à générer sur myaccount.google.com/apppasswords, nécessite
  la validation en 2 étapes). Laisser vide pour désactiver l'email.
- `NTFY_TOPIC` : nom de topic [ntfy.sh](https://ntfy.sh) unique et
  secret pour la notification push mobile. Installe l'app ntfy
  (iOS/Android) et abonne-toi au même topic.

Test manuel :

```bash
npm start
```

Ça doit afficher un JSON du type `{"available":false,"error":null}`. Si
le site a changé de structure depuis, ça peut échouer avec un message
d'erreur explicite (`login_fields_not_found`, `choisir_link_not_found`,
`captcha_detected`, etc.) — dans ce cas, regarde les fichiers
sauvegardés dans `run-output/` (capture d'écran + HTML de la page au
moment de l'échec) pour ajuster les sélecteurs dans
`src/checkAvailability.js`.

## Planifier l'exécution automatique

### macOS / Linux (cron)

```bash
crontab -e
# Vérifie toutes les 15 minutes :
*/15 * * * * cd /chemin/vers/agent-permis- && /usr/bin/node src/runAndNotify.js >> cron.log 2>&1
```

### Windows (Planificateur de tâches, sans fenêtre visible)

Lancer `node` directement via le Planificateur de tâches fait
apparaître une fenêtre de terminal à chaque exécution. Pour l'éviter,
`run-hidden.vbs` (à la racine du projet) lance le script en arrière-plan
sans aucune fenêtre visible.

Dans un terminal PowerShell ou cmd, à la racine du projet (adapter le
chemin si besoin) :

```
schtasks /create /tn "VerificationPermisConduite" /tr "wscript.exe \"C:\chemin\vers\agent-permis-\run-hidden.vbs\"" /sc minute /mo 15 /st 00:00 /f
```

⚠️ Sous **PowerShell**, ajouter `--%` juste après `schtasks` sinon les
guillemets imbriqués cassent la commande :

```
schtasks --% /create /tn "VerificationPermisConduite" /tr "wscript.exe \"C:\chemin\vers\agent-permis-\run-hidden.vbs\"" /sc minute /mo 15 /st 00:00 /f
```

Pour tester immédiatement sans attendre 15 minutes :
```
schtasks /run /tn "VerificationPermisConduite"
```

Note : la tâche ne tourne que si l'ordinateur est allumé et la session
ouverte (comportement par défaut du Planificateur de tâches, pas un
service qui tourne "dans le cloud").

## Fonctionnement

1. `src/checkAvailability.js` (Node.js + Playwright) : se connecte
   avec le NIP FABER + date de naissance, clique sur "Choisir" pour
   ouvrir le calendrier hebdomadaire, parcourt les semaines jusqu'à
   couvrir la fenêtre de dates configurée, et imprime un résultat JSON
   sur stdout (créneaux trouvés, ou rendez-vous déjà existant, ou
   erreur explicite).
2. `src/runAndNotify.js` : exécute le check, compare au dernier état
   connu (`state.json`, non commité) pour n'envoyer une notification
   que sur un **changement** (nouvelle disponibilité, ou nouvelle
   panne du vérificateur lui-même — site changé, CAPTCHA, etc.), puis
   envoie email + notification ntfy via `src/notify.js`.
3. `run-hidden.vbs` : lanceur optionnel pour Windows qui exécute
   `runAndNotify.js` sans fenêtre visible, à utiliser avec le
   Planificateur de tâches.

## Identifiants et secrets

Identifiants (NIP FABER + date de naissance), mot de passe SMTP et
topic ntfy sont tous dans `.env` — fichier local, **jamais commité**
(voir `.gitignore`). Ne les partage avec personne : le topic ntfy en
particulier n'a aucune authentification, quiconque le connaît peut lire
tes notifications.

## Limites connues

- Aucune garantie face à un éventuel CAPTCHA ou changement de structure
  du site — une alerte est envoyée automatiquement si le vérificateur
  tombe en panne (mais pas si un rendez-vous est déjà réservé, ce n'est
  pas une panne).
- Les identifiants FABER sont propres à une convocation OCV donnée ;
  s'ils expirent ou changent, mettre à jour `.env`.
- Fonctionne uniquement pendant que l'ordinateur est allumé et la
  session utilisateur ouverte.
