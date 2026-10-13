#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/shell-common.sh"
require_user
ensure_dependencies
exec node "$MONITOR_ROOT/scripts/install-cockpit-link.js" "$@"
