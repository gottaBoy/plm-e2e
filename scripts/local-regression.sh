#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${PLM_E2E_BASE_URL:-http://127.0.0.1:30250/ibizplm-plmweb/}"
USERNAME="${PLM_E2E_USERNAME:-aibizhi}"
PASSWORD="${PLM_E2E_PASSWORD:-123456}"

export PLM_E2E_BASE_URL="$BASE_URL"
export PLM_E2E_USERNAME="$USERNAME"
export PLM_E2E_PASSWORD="$PASSWORD"

cd "$ROOT"

printf '\n[1/5] Applying local PLM migrations\n'
"$ROOT/../plm/deploy/compose/migrate.sh"

printf '\n[2/5] Reloading the bind-mounted PLM model service\n'
docker restart plmservice
until docker inspect --format '{{.State.Health.Status}}' plmservice 2>/dev/null | grep -qx healthy; do
  sleep 2
done

printf '\n[3/5] Running focused article-page and account regressions\n'
pnpm exec playwright test \
  tests/isolated-article-page.spec.ts \
  tests/local-accounts.spec.ts \
  --project=desktop

printf '\n[4/5] Running the complete desktop regression\n'
pnpm exec playwright test --project=desktop

printf '\n[5/5] Running the complete mobile regression\n'
pnpm exec playwright test --project=mobile

printf '\nLocal PLM regression passed.\n'
