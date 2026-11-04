#!/usr/bin/env bash
# Creates .env from .env.example with freshly generated random secrets. Never overwrites an existing .env.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env already exists; leaving it untouched."; exit 0; fi
rand() { node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
sed -e "s|^CSRF_SECRET=.*|CSRF_SECRET=$(rand)|" \
    -e "s|^RSVP_TOKEN_SECRET=.*|RSVP_TOKEN_SECRET=$(rand)|" \
    -e "s|^PSEUDONYM_SECRET=.*|PSEUDONYM_SECRET=$(rand)|" \
    -e "s|^MESSAGING_WEBHOOK_SECRET=.*|MESSAGING_WEBHOOK_SECRET=$(rand)|" .env.example > .env
echo "Created .env with generated secrets (local use only; it is git-ignored)."
