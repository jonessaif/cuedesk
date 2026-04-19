#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
STAMP="$(date +"%Y%m%d-%H%M%S")"
TMP_DIR="$DIST_DIR/cuedesk-server-$STAMP"
ARCHIVE="$DIST_DIR/cuedesk-server-$STAMP.tar.gz"

mkdir -p "$DIST_DIR"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

# Core server/runtime files
cp -R "$ROOT_DIR/src" "$TMP_DIR/src"
cp -R "$ROOT_DIR/prisma" "$TMP_DIR/prisma"
cp -R "$ROOT_DIR/scripts" "$TMP_DIR/scripts"

for file in package.json package-lock.json next.config.ts tsconfig.json next-env.d.ts middleware.ts postcss.config.js tailwind.config.ts README.md .env .npmrc; do
  if [[ -f "$ROOT_DIR/$file" ]]; then
    cp "$ROOT_DIR/$file" "$TMP_DIR/$file"
  fi
done

cat > "$TMP_DIR/INSTALL_SERVER.md" <<'EOF'
# CueDesk Server Install (Another Device)

## 1) Prerequisites
- Node.js 20+
- npm

## 2) Install deps
```bash
npm install
```

## 3) Prisma setup
```bash
npx prisma generate
```

If DB schema changed and you need sync:
```bash
npx prisma db push
```

## 4) Build + Start
```bash
npm run build
npm run start
```

Server runs on:
- Local: `http://localhost:3000`
- Network: `http://0.0.0.0:3000`
EOF

tar -C "$DIST_DIR" -czf "$ARCHIVE" "$(basename "$TMP_DIR")"
rm -rf "$TMP_DIR"

echo "Server package created: $ARCHIVE"
