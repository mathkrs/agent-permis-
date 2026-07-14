# Agent de surveillance des disponibilités d'examen de conduite (OCV Genève)

Ce projet automatise la vérification périodique des disponibilités
d'examen pratique de conduite sur le portail Tradispo de l'État de
Genève (`ge.ch/tradispoweb_public`), et notifie l'utilisateur dès qu'une
date est trouvée.

## État actuel — ⚠️ à lire avant d'activer

Ce script **n'a pas encore pu être testé contre le vrai site**. Au
moment de son écriture, l'environnement d'exécution cloud bloquait les
connexions sortantes vers `ge.ch` (politique réseau restrictive). En
conséquence :

- Les sélecteurs utilisés dans `src/checkAvailability.js` (noms de
  champs, textes de boutons, messages d'indisponibilité) sont des
  **hypothèses raisonnables**, pas des valeurs confirmées.
- Il est possible que le site utilise un CAPTCHA sur le formulaire de
  connexion, ce qui empêcherait toute automatisation complète — le
  script le détecte et s'arrête proprement (`error: "captcha_detected"`)
  plutôt que de forcer quoi que ce soit.
- Un premier run réel est nécessaire pour ajuster `CONFIG` en haut du
  fichier `src/checkAvailability.js` (labels de champs, sélecteurs de
  créneaux disponibles, messages d'indisponibilité).

**Prochaine étape pour rendre l'agent opérationnel** : élargir la
politique réseau de l'environnement Claude Code (paramètres de
l'environnement sur https://claude.ai/code) pour autoriser `ge.ch`, puis
relancer un check pour que les sélecteurs soient corrigés sur la base du
HTML réel (capturé automatiquement dans `run-output/` à chaque run en
cas d'échec).

## Fonctionnement

1. `src/checkAvailability.js` (Node.js + Playwright) :
   - se connecte à la page de login avec le NIP FABER et la date de
     naissance (lus depuis les variables d'environnement, jamais en
     dur dans le code) ;
   - détecte si des créneaux d'examen sont disponibles ;
   - imprime un résultat JSON sur stdout, ex :
     `{"ok":true,"loggedIn":true,"available":false,"dates":[]}`.
2. `scripts/run-check.sh` : charge `.env`, exécute le script, compare
   au dernier état connu (`state.json`, non commité) pour détecter une
   **nouvelle** disponibilité (évite de notifier en boucle tant que
   rien ne change).
3. Une Routine planifiée (déclenchement récurrent Claude Code, minimum
   toutes les heures) relance périodiquement `scripts/run-check.sh`
   dans cette même session, et déclenche une notification push vers le
   téléphone de l'utilisateur (via Remote Control) si une nouvelle
   disponibilité est détectée.

## Identifiants

Les identifiants (NIP FABER + date de naissance) sont stockés dans
`.env` (fichier local, jamais commité — voir `.gitignore`). Copier
`.env.example` vers `.env` et remplir les valeurs si besoin de
reconfigurer.

## Limites connues

- Fréquence de vérification limitée à **1x/heure** au minimum, par
  contrainte du système de déclenchement planifié (« Routine »).
- Aucune garantie face à un éventuel CAPTCHA ou changement de structure
  du site — à surveiller lors des premiers runs.
- La notification actuelle est uniquement une **notification push**
  Claude Code (nécessite que le Remote Control soit connecté au
  téléphone). Une notification email peut être ajoutée ultérieurement
  si besoin (connecteur Gmail ou envoi SMTP direct depuis le script).
