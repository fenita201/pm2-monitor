#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/shell-common.sh"
resolve_pm2
select_option 'PM2 pm2-dashboard: 1 = stop, 2 = remove khỏi danh sách PM2'
if [[ "$REPLY" == 2 ]]; then
    exec "$MONITOR_PM2" delete pm2-dashboard
else
    exec "$MONITOR_PM2" stop pm2-dashboard
fi
