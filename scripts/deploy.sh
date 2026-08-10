#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/safdar/manage-lead-crm"
cd "$APP_DIR"

echo "📦 Pulling latest Docker image..."
docker compose pull backend || true

echo "🚀 Restarting backend service..."
docker compose up -d backend

sleep 2
echo "📜 Backend logs:"
docker compose logs --tail=80 backend || true

echo "✅ Deploy script done."
