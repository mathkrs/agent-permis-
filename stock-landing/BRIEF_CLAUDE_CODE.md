# Brief projet — stock (landing)

Contexte pour reprendre le travail sur `landing.html` (et `soon.html`) sans casser ce qui existe déjà.

## Le projet

**stock** est un SaaS d'inventaire et de point de vente pour petits commerçants chiliens (almacén, panadería, ferretería, minimarket, botillería, boutique de vêtements). Le fichier `landing.html` est la page vitrine. `soon.html` est une page "en construction" (avec Frank, l'assistant/mascotte) vers laquelle pointent tous les boutons d'action pour l'instant, en attendant que l'app soit branchée.

## Règles de design à respecter absolument

- **Deux thèmes** pilotés par `data-theme="slate"` (sombre, par défaut) et `data-theme="jour"` (clair) sur l'élément `.page`, via des variables CSS (`--bg`, `--ink`, `--accent`, etc.). Ne jamais coder une couleur en dur dans une nouvelle section : toujours utiliser les variables existantes pour que les deux thèmes restent cohérents.
- **Logo** : un seul α, dans le carré bleu dégradé (`linear-gradient(160deg,#5b86e8,#2f5fd0)`). Ne jamais répéter le α dans le mot "stock" à côté.
- **Polices** : Space Grotesk (texte), Sora (logo/chiffres), IBM Plex Mono (montants/quantités).
- **Prix** : 19.900 CLP, licence à vie, paiement unique (pas d'abonnement). Ne jamais suggérer un modèle d'abonnement.

## Règles de contenu / ton — très important

- **Vouvoiement systématique** dans les 3 langues : **usted** en espagnol, **vous** en français. Jamais de tutoiement (tú/tu), même si tu en retrouves des restes ailleurs dans le code — il faut les corriger.
- **Jamais le mot "gratis / gratuit / free"** en avant sur les CTA d'essai — on parle de "14 días para conocerlo con calma" / équivalents naturels, pas de traduction littérale.
- **Jamais "sin tarjeta" / "no card"** dans les réassurances (source de confusion identifiée par l'utilisateur).
- **Pas de traduction littérale** d'une langue à l'autre. Chaque langue doit sonner native : préférer chercher comment de vrais sites SaaS du secteur formulent la même idée plutôt que de traduire mot à mot. Exemple appliqué : "Alertas inteligentes" → FR n'est PAS "Alertes intelligentes" (calque) mais **"Alertes en temps réel"**.
- **Mots à éviter en français** : "Quincaillerie" (peu utilisé) → remplacé par "Bricolage".
- L'utilisateur préfère désormais **écrire lui-même** les titres/descriptions finaux dans son propre style ; le rôle de l'assistant IA est de corriger la syntaxe/orthographe et d'intégrer proprement dans le code, pas de générer le texte final à sa place.

## Système multilingue (ES / EN / FR)

- Sélecteur ES/EN/FR fonctionnel dans le header et le footer (`setLang('es'|'en'|'fr')`).
- Détection automatique de la langue du navigateur au premier chargement + mémorisation via `localStorage` (`sa_lang`).
- Dictionnaire central `I18N` (objet JS, clés `k0`, `k1`, ... + quelques clés nommées comme `h1a`, `h1b`, `badge1`) injecté en `<script>`, chaque entrée a `{es, en, fr}`.
- Les éléments traduits portent un attribut `data-i18n="kXX"`. La fonction `applyLang(lang)` parcourt tous les `[data-i18n]` et remplace le texte.
- **Piège identifié à surveiller** : certains éléments ont un enfant `<span>` avant le texte (ex. puce colorée, coche ✓) — dans ce cas le texte à remplacer n'est pas le premier enfant. Toujours vérifier après ajout qu'aucun texte ne reste bloqué dans une langue (bug déjà rencontré sur la section prix et le bandeau "mises à jour gratuites").
- La FAQ est un objet séparé `FAQ_ALL = {es:[...], en:[...], fr:[...]}` regénéré via `renderFaq()` à chaque changement de langue — ne pas oublier de mettre à jour les 3 langues en même temps si un contenu FAQ change.

## Thème clair (jour)

Volontairement adouci en pastel (pas de blanc pur agressif) : `--bg:#e9edf6; --navbg:#f5f7fc; --panel:#f7f9fd; --surf:#f4f6fb; --sectionAlt:#dfe5f0`. Garder cette philosophie pour toute nouvelle section : jamais de `#fff` pur en fond dans le thème clair.

## Interactions

Les transitions doivent rester douces (jamais de mouvement brusque) : la FAQ utilise `cubic-bezier(.25,.8,.25,1)` avec des durées ~0.5s, à réutiliser pour toute nouvelle interaction (accordéons, hovers, reveals au scroll).

## État actuel de `landing.html`

Déjà fait : hero, bandeau "types de commerce" (avec Ropa y tienda), section "cada venta descuenta el stock" animée, "cómo funciona" (3 étapes), "funciones" (4 cartes), panel démo, section mobile, prix (Básico / Licencia completa), section contact "sur mesure" (mentionne que stock existe en 3 langues et s'adapte sur demande), FAQ, footer (3 colonnes, sans placeholder "Empresa"). Logo header cliquable vers le haut de page. Tous les CTA renvoient vers `soon.html` (page Frank "en construction", à styliser plus tard avec un vrai design Frank fourni séparément par l'utilisateur — ne pas retravailler le Frank actuel, juste une version provisoire).

## À corriger / vérifier en priorité

1. Repasser sur **tout** le fichier pour traquer d'éventuels restes de tutoiement (tú/tu/ton/tes) en français et espagnol, en particulier dans des sections qui n'auraient pas encore été relues.
2. Vérifier qu'aucun texte ne reste bloqué dans la mauvaise langue après un `setLang()` (tester ES/EN/FR sur toute la page, pas seulement le hero).
3. Les **noms de produits** dans les cartes démo (Café molido, Bolsas kraft, etc.) sont encore des placeholders — l'utilisateur fournira ses propres noms à intégrer.

## À ajouter (quand fourni par l'utilisateur)

- Un vrai design de Frank (fourni séparément, probablement en SVG/HTML) à intégrer dans `soon.html` à la place du Frank provisoire actuel, en gardant la structure (thèmes, langues, bouton retour).
- Textes finaux réécrits par l'utilisateur (titres, descriptions, section "sur mesure").
- Page `terminos.html` (conditions d'utilisation), à créer sur le même design system que `privacy.html`.
- Remplacer l'email placeholder dans `privacy.html`.

## Ce qu'il ne faut PAS faire

- Ne pas réintroduire de tutoiement.
- Ne pas remettre "gratis/gratuit" en avant sur les CTA.
- Ne pas changer le prix (19.900, paiement unique).
- Ne pas casser le système `data-i18n` existant en ajoutant du texte sans clé i18n correspondante dans les 3 langues.
- Ne pas dupliquer le α du logo dans le wordmark.
