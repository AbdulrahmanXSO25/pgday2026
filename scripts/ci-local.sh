#!/usr/bin/env bash
set -euo pipefail

# ci-local.sh — single command to run all checks locally (Docker + pnpm dev alternative)
# Mirrors CI pipeline: lint, typecheck, test with coverage, build, security, e2e.
# Usage: ./scripts/ci-local.sh [--skip-e2e] [--skip-build]
# Requires: pnpm 9+, Node 22+, Docker (for MinIO/Maildev optional)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_E2E=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-e2e) SKIP_E2E=true ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

echo "==> PGDay Platform — CI local (root: $ROOT_DIR)"
echo "==> Node $(node -v)  pnpm $(pnpm -v)"

# 1) Install check
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "==> Installing deps (pnpm install)…"
  pnpm install --frozen-lockfile || pnpm install
fi

# 2) Lint
echo ""
echo "==> [1/6] lint (turbo lint)…"
pnpm turbo run lint --continue 2>&1 | tail -n 30

# 3) Typecheck
echo ""
echo "==> [2/6] typecheck (turbo typecheck)…"
pnpm turbo run typecheck --continue 2>&1 | tail -n 40

# 4) Unit tests + coverage (>=80% on critical paths via vitest workspace)
echo ""
echo "==> [3/6] test (vitest workspace + coverage)…"
pnpm test 2>&1 | tail -n 80
# Alternative: pnpm exec vitest run --coverage  (workspace root reads vitest.config.ts)

# 5) Build all apps/packages
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "==> [4/6] build (turbo build)…"
  pnpm turbo run build --continue 2>&1 | tail -n 50

  echo ""
  echo "==> Validating public-web has NO noindex, admin-web HAS noindex…"
  if grep -rq "noindex" "$ROOT_DIR/apps/public-web/next.config.ts" 2>/dev/null; then
    echo "❌ public-web next.config should NOT contain noindex"
    exit 1
  fi
  if ! grep -q "noindex" "$ROOT_DIR/apps/admin-web/next.config.ts" 2>/dev/null; then
    echo "❌ admin-web next.config MUST contain noindex"
    exit 1
  fi
  echo "✅ noindex guards OK"

  echo ""
  echo "==> Validating blue domination tokens preserved…"
  if ! grep -qi "#336791" "$ROOT_DIR/packages/ui/src/tokens.css"; then
    echo "❌ tokens.css missing #336791 (pg-blue)"
    exit 1
  fi
  if ! grep -qi "#eaf0f5" "$ROOT_DIR/packages/ui/src/tokens.css"; then
    echo "❌ tokens.css missing #EAF0F5 (bg-page)"
    exit 1
  fi
  echo "✅ tokens OK"
else
  echo "==> Skipping build (--skip-build)"
fi

# 6) Security — gitleaks (if installed) + secret guard
echo ""
echo "==> [5/6] secrets check…"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source "$ROOT_DIR" --no-git --redact --verbose || {
    echo "⚠️  gitleaks found potential secrets (see above)"
    exit 1
  }
else
  echo "ℹ️  gitleaks not installed — running lightweight guard (checking .gitignore + hardcoded patterns)"
  if ! grep -q ".env" "$ROOT_DIR/.gitignore"; then echo "❌ .gitignore must ignore .env"; exit 1; fi
  if ! grep -q ".dev.vars" "$ROOT_DIR/.gitignore"; then echo "❌ .gitignore must ignore .dev.vars"; exit 1; fi
  if grep -R --include="*.ts" --include="*.tsx" "sk_live\|AKIA\|BEGIN RSA PRIVATE KEY" "$ROOT_DIR/apps" "$ROOT_DIR/packages" 2>/dev/null; then
    echo "❌ potential hardcoded secret found"
    exit 1
  fi
  echo "✅ lightweight secret guard passed"
fi

# 7) E2E (Playwright)
if [ "$SKIP_E2E" = false ]; then
  echo ""
  echo "==> [6/6] Playwright E2E (api + ui)…"
  if command -v npx >/dev/null 2>&1 && [ -f "$ROOT_DIR/playwright.config.ts" ]; then
    # Install browsers on first run (cache)
    if [ ! -d "$ROOT_DIR/node_modules/@playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
      echo "ℹ️  Installing Playwright browsers…"
      npx playwright install --with-deps chromium 2>&1 | tail -n 20 || true
    fi
    # Prefer workspace api e2e that uses app.request (no server needed) — use PLAYWRIGHT_SKIP_WEBSERVER to avoid starting dev servers in CI
    PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test --reporter=list 2>&1 | tail -n 100
  else
    echo "⚠️  Playwright not available, skipping"
  fi
else
  echo "==> Skipping e2e (--skip-e2e)"
fi

# 8) Docs check
echo ""
echo "==> Docs — checking local dev instructions…"
if ! grep -q "docker compose" "$ROOT_DIR/README.md" 2>/dev/null; then
  echo "⚠️  README.md should mention 'docker compose' for local dev"
fi
if ! grep -q "pnpm dev" "$ROOT_DIR/README.md" 2>/dev/null; then
  echo "⚠️  README.md should mention 'pnpm dev'"
fi

echo ""
echo "✅ CI local complete — all checks passed"
echo "   Next: docker compose up -d (MinIO :9000/:9001, Maildev :1025/:1080) && pnpm dev (api :8787, public :3000, admin :3001)"
