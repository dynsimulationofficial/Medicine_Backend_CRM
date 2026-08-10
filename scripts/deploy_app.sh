#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/safdar/manage-lead-crm"
PROD_BRANCH="lead-crm-prod.1.0.1"

cd "$APP_DIR"

echo "🔄 Fetching branch..."
git fetch origin "$PROD_BRANCH"

echo "🔀 Switching branch..."
if git show-ref --verify --quiet "refs/heads/$PROD_BRANCH"; then
  git checkout "$PROD_BRANCH"
else
  git checkout -b "$PROD_BRANCH" "origin/$PROD_BRANCH"
fi

echo "⬇️ Pulling latest code..."
git pull origin "$PROD_BRANCH"

echo "⚙️ Running deployment script..."
chmod +x scripts/*.sh
./scripts/deploy.sh

echo "🚀 Deployment complete!"
