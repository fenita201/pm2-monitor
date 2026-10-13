#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/shell-common.sh"
bash "$MONITOR_ROOT/setup.sh"
select_option 'Chạy app: 1 = chạy thường (foreground), 2 = chạy bằng PM2'
if [[ "$REPLY" == 2 ]]; then
    resolve_pm2
    exec "$MONITOR_PM2" startOrReload "$MONITOR_ROOT/ecosystem.config.js" --update-env
else
    exec node "$MONITOR_ROOT/server.js"
fi
