#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/shell-common.sh"
require_user
ensure_dependencies

create_env=yes
if [[ -e .env || -L .env ]]; then
    [[ -f .env && ! -L .env ]] || fail '.env phải là file thường, không phải symlink.'
    while true; do
        prompt_value 'Đã có .env. Enter để skip/giữ nguyên; nhập no để tạo mới' skip
        case "${REPLY,,}" in
            skip|yes|y) create_env=no; break;;
            no|n) break;;
            *) printf '%s\n' 'Nhấn Enter để giữ nguyên hoặc nhập no để tạo mới.';;
        esac
    done
fi

if [[ "$create_env" == yes ]]; then
    printf '%s\n' 'Tạo .env mới. Enter để dùng giá trị mặc định.'
    while true; do
        prompt_value 'PORT' 8877
        if [[ "$REPLY" =~ ^[0-9]{1,5}$ ]] && (( 10#$REPLY >= 1 && 10#$REPLY <= 65535 )); then
            SETUP_PORT="$REPLY"; break
        fi
        printf '%s\n' 'Port phải là số từ 1 đến 65535.'
    done
    prompt_value 'HOST (all = bind mặc định của app)' all
    SETUP_HOST="$REPLY"
    [[ "$SETUP_HOST" != all ]] || SETUP_HOST=''
    select_option 'Mode: 1 = single-user, 2 = multi-user'
    if [[ "$REPLY" == 2 ]]; then SETUP_MODE=multi-user; else SETUP_MODE=single-user; fi
    prompt_secret 'ADMIN_PASSWORD (Enter = admin123; ký tự nhập được ẩn)' admin123
    SETUP_PASSWORD="$REPLY"
    generated_secret="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
    prompt_secret 'SESSION_SECRET (Enter = tự sinh secret ngẫu nhiên)' "$generated_secret"
    SETUP_SECRET="$REPLY"
    SETUP_TARGETS='./config/pm2-targets.json'
    if [[ "$SETUP_MODE" == multi-user ]]; then
        prompt_value 'PM2_MONITOR_TARGETS_FILE' "$SETUP_TARGETS"
        SETUP_TARGETS="$REPLY"
    fi
    export SETUP_PORT SETUP_HOST SETUP_MODE SETUP_PASSWORD SETUP_SECRET SETUP_TARGETS
    node scripts/write-env.js
    unset SETUP_PASSWORD SETUP_SECRET generated_secret
fi
node scripts/validate-env.js
printf '%s\n' 'Setup hoàn tất.'
