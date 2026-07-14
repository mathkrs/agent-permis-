#!/usr/bin/env bash
# Charge .env, exécute la vérification de disponibilité, et met à jour
# l'état local pour permettre à l'appelant (session Claude déclenchée par
# la Routine planifiée) de savoir s'il s'agit d'une NOUVELLE disponibilité
# à notifier ou d'un état déjà connu.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo '{"ok": false, "error": "missing_env_file"}' >&2
  exit 2
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
set +e
RESULT="$(node src/checkAvailability.js)"
NODE_EXIT=$?
set -e
echo "$RESULT"

STATE_FILE="state.json"
PREV_AVAILABLE="false"
if [ -f "$STATE_FILE" ]; then
  PREV_AVAILABLE="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$STATE_FILE')).available)}catch(e){console.log('false')}")"
fi

echo "$RESULT" > "$STATE_FILE"

NEW_AVAILABLE="$(node -e "try{console.log(JSON.parse(process.argv[1]).available)}catch(e){console.log('false')}" "$RESULT")"

if [ "$NEW_AVAILABLE" = "true" ] && [ "$PREV_AVAILABLE" != "true" ]; then
  echo "NEW_AVAILABILITY_DETECTED" >&2
fi

exit "$NODE_EXIT"
