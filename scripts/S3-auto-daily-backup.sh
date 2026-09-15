#!/usr/bin/env bash

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

set -Eeuo pipefail

# CONFIG
DB_CONTAINER="medicine-db-production"
DB_NAME="medicine_production_db"
DB_USER="postgres"

BACKUP_DIR="/root/backups"

S3_BUCKET="medicine-crm-production-backup-bucket-2026"
S3_PREFIX="production-db-backups"

RETENTION_DAYS=2

DATE=$(date +%F-%H-%M)

FILE="$BACKUP_DIR/erp_$DATE.sql.gz"

LOG_FILE="/root/backup.log"

mkdir -p "$BACKUP_DIR"

echo "" >> "$LOG_FILE"
echo "====================" >> "$LOG_FILE"
echo "📅 $(date) START" >> "$LOG_FILE"
echo "🗄️ Database: $DB_NAME" >> "$LOG_FILE"

echo "📦 Taking PostgreSQL backup..." >> "$LOG_FILE"

# CREATE BACKUP
if docker exec "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" "$DB_NAME" \
    | gzip > "$FILE"; then

    echo "✅ PostgreSQL dump completed" >> "$LOG_FILE"

else
    echo "❌ PostgreSQL dump failed" >> "$LOG_FILE"
    rm -f "$FILE"
    exit 1
fi

# VERIFY BACKUP
if [ ! -f "$FILE" ]; then
    echo "❌ Backup file missing" >> "$LOG_FILE"
    exit 1
fi

SIZE=$(stat -c%s "$FILE")

echo "📏 Backup Size: $SIZE bytes" >> "$LOG_FILE"

if [ "$SIZE" -lt 1000 ]; then
    echo "❌ Backup too small" >> "$LOG_FILE"
    rm -f "$FILE"
    exit 1
fi

echo "✅ Backup created: $FILE" >> "$LOG_FILE"

# UPLOAD TO S3
echo "☁️ Uploading backup to S3..." >> "$LOG_FILE"

if aws s3 cp "$FILE" "s3://$S3_BUCKET/$S3_PREFIX/"; then
    echo "✅ Uploaded to S3" >> "$LOG_FILE"
else
    echo "❌ S3 upload failed" >> "$LOG_FILE"
    exit 1
fi

# S3 RETENTION CLEANUP
echo "🧹 Cleaning old S3 backups..." >> "$LOG_FILE"

aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" | while read -r line; do

    createDate=$(echo "$line" | awk '{print $1" "$2}')
    fileName=$(echo "$line" | awk '{print $4}')

    if [[ -n "$fileName" ]]; then

        fileDate=$(date -d "$createDate" +%s)
        olderThan=$(date -d "$RETENTION_DAYS days ago" +%s)

        if [[ $fileDate -lt $olderThan ]]; then
            echo "🗑️ Deleting old backup: $fileName" >> "$LOG_FILE"
            aws s3 rm "s3://$S3_BUCKET/$S3_PREFIX/$fileName"
        fi

    fi

done

echo "✅ DONE" >> "$LOG_FILE"