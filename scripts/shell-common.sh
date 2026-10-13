#!/usr/bin/env bash
# Shared by the root-level launchers. Do not source .env as shell code.
set -euo pipefail
MONITOR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$MONITOR_ROOT"

fail() { printf '%s\n' "$*" >&2; exit 1; }
require_user() {
    [[ "$(id -u)" != 0 ]] || fail 'Hãy chạy bằng Linux user của dashboard, không dùng sudo/root.'
}
require_node() {
    command -v node >/dev/null || fail 'Không tìm thấy Node. Hãy nạp NVM và chọn Node >= 20.19 trước.'
    node -e 'const [a,b] = process.versions.node.split(".").map(Number); if (a < 20 || (a === 20 && b < 19)) process.exit(1)' \
        || fail 'App cần Node >= 20.19. Hãy chọn phiên bản Node phù hợp qua NVM.'
}
ensure_dependencies() {
    require_node
    if ! node -e 'for (const name of ["dotenv", "express", "express-session", "pm2", "check-disk-space"]) require.resolve(name)' >/dev/null 2>&1; then
        command -v npm >/dev/null || fail 'Không tìm thấy npm trong PATH.'
        printf '%s\n' 'Cài dependencies từ package-lock.json...'
        npm ci --omit=dev
    fi
}
prompt_value() {
    local message="$1" default="$2" answer
    printf '%s [%s]: ' "$message" "$default"
    IFS= read -r answer || fail 'Không nhận được lựa chọn. Hãy chạy script trong terminal tương tác.'
    REPLY="${answer:-$default}"
}
prompt_secret() {
    local message="$1" default="$2" answer
    printf '%s: ' "$message"
    IFS= read -r -s answer || fail 'Không nhận được lựa chọn. Hãy chạy script trong terminal tương tác.'
    printf '\n'
    REPLY="${answer:-$default}"
}
select_option() {
    local message="$1"
    while true; do
        prompt_value "$message" 1
        case "$REPLY" in 1|2) return;; *) printf '%s\n' 'Chỉ chọn 1 hoặc 2.';; esac
    done
}
resolve_pm2() {
    require_user
    ensure_dependencies
    # Match backend precedence, including custom PM2_HOME from .env, without eval.
    MONITOR_PM2_HOME="$(node scripts/validate-env.js --pm2-home)"
    export PM2_HOME="$MONITOR_PM2_HOME"
    if command -v pm2 >/dev/null; then
        MONITOR_PM2="$(command -v pm2)"
    elif [[ -x "$MONITOR_ROOT/node_modules/.bin/pm2" ]]; then
        MONITOR_PM2="$MONITOR_ROOT/node_modules/.bin/pm2"
    else
        fail 'Không tìm thấy PM2. Hãy kiểm tra npm ci hoặc PATH của NVM.'
    fi
}
