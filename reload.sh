#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/shell-common.sh"
[[ -f .env ]] || fail 'Chưa có .env. Hãy chạy ./setup.sh trước.'
resolve_pm2
exec "$MONITOR_PM2" reload "$MONITOR_ROOT/ecosystem.config.js" --update-env
