#!/bin/bash

set -e

# ===== CONFIG =====
PROJECT_DIR="/root/Medicine_Backend_CRM"
COMPOSE_FILE="docker-compose.yml"
BRANCH="main"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Auto Deployment Started"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd $PROJECT_DIR

echo "📂 Current Directory: $(pwd)"
echo "🌿 Working on branch: $BRANCH"

# Save current commit
OLD_COMMIT=$(git rev-parse HEAD)

echo "🔍 Checking latest code from GitHub..."

# Fetch latest
git fetch origin $BRANCH

# Latest remote commit
NEW_COMMIT=$(git rev-parse origin/$BRANCH)

# Compare commits
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    echo "✅ No new changes found."
    exit 0
fi

echo ""
echo "🆕 New commit detected!"
echo "OLD: $OLD_COMMIT"
echo "NEW: $NEW_COMMIT"

echo ""
echo "⬇️ Pulling latest code..."
git pull origin $BRANCH

echo ""
echo "🐳 Building and restarting containers..."
docker compose -f $COMPOSE_FILE up -d --build

echo ""
echo "⏳ Waiting for containers..."
sleep 15

echo ""
echo "📦 Running Containers:"
docker ps

echo ""
echo "📜 Checking logs for errors..."

ERRORS=$(docker compose logs --tail=40 2>&1 | grep -iE "error|failed|exception" || true)

if [ -z "$ERRORS" ]; then
    echo "✅ No errors found."
else
    echo "❌ Errors Found:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$ERRORS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

echo ""
echo "✅ Deployment Completed on branch: $BRANCH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"