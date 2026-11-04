#!/usr/bin/env bash
# Lightweight secret scan for CI/pre-commit. Fails on private keys, cloud/API tokens and committed .env files.
# (Use a dedicated scanner such as gitleaks in addition for real deployments.)
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
# Text files only, skipping dependency/build output, binaries and lockfiles. Test fixtures are excluded on purpose.
FILES=$(find . \( -type d \( -name node_modules -o -name .next -o -name dist -o -name .git -o -name coverage -o -name test \) -prune \) -o \
  \( -type f -size -1024k ! -name 'package-lock.json' ! -name '*.png' ! -name '*.ico' ! -name '*.woff*' ! -name '.env' -print \))
scan() { # name regex
  local hits
  hits=$(echo "$FILES" | xargs grep -IEn -e "$2" 2>/dev/null | grep -v 'scripts/check-secrets.sh' | cut -c1-160 || true)
  if [ -n "$hits" ]; then echo "POSSIBLE SECRET ($1):"; echo "$hits" | head -5; fail=1; fi
}
scan "private key"         '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
scan "AWS access key"      'AKIA[0-9A-Z]{16}'
scan "Slack token"         'xox[baprs]-[A-Za-z0-9-]{10,}'
scan "GitHub token"        'gh[pousr]_[A-Za-z0-9]{36,}'
scan "Meta/WhatsApp token" 'EAA[A-Za-z0-9]{40,}'
scan "hard-coded secret"   "(api[_-]?key|secret|token|password)[\"' ]*[:=][\"' ]*[A-Za-z0-9/+_-]{32,}[\"']"
if [ -d .git ] && git ls-files --error-unmatch .env >/dev/null 2>&1; then echo ".env is tracked by git"; fail=1; fi
[ $fail -eq 0 ] && echo "No secrets found."
exit $fail
