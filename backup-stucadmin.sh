#!/bin/bash
# ============================================
# StucAdmin Backup Script
# Draait elke nacht om 03:00 via cron
# Bewaart laatste 7 dagen lokaal + Google Drive
# ============================================

BACKUP_DIR="/home/info/backups"
STUCADMIN_DIR="/home/info/stucadmin"
STUCADMIN_DATA_DIR="/home/info/stucadmin-data"
DAYS_TO_KEEP=7
DATE=$(date +%Y-%m-%d_%H-%M)
BACKUP_NAME="stucadmin-backup-$DATE"

echo "============================================"
echo "🔄 StucAdmin Backup gestart: $(date)"
echo "============================================"

# Maak backup directories
mkdir -p "$BACKUP_DIR/$BACKUP_NAME"

# 1. Backup .data/ folder (alle JSON data)
echo "📦 Backup .data/ folder..."
if [ -d "$STUCADMIN_DIR/.data" ]; then
    cp -r "$STUCADMIN_DIR/.data" "$BACKUP_DIR/$BACKUP_NAME/data"
    echo "   ✅ .data/ gekopieerd"
else
    echo "   ⚠️ .data/ niet gevonden"
fi

# 2. Backup .users.json (admin accounts)
echo "👤 Backup admin users..."
if [ -f "$STUCADMIN_DIR/.users.json" ]; then
    cp "$STUCADMIN_DIR/.users.json" "$BACKUP_DIR/$BACKUP_NAME/"
    echo "   ✅ .users.json gekopieerd"
else
    echo "   ⚠️ .users.json niet gevonden"
fi

# 3. Backup stucadmin-data/ folder (google tokens, offerteaanvragen, uploads)
echo "📁 Backup stucadmin-data/..."
if [ -d "$STUCADMIN_DATA_DIR" ]; then
    cp -r "$STUCADMIN_DATA_DIR" "$BACKUP_DIR/$BACKUP_NAME/stucadmin-data"
    echo "   ✅ stucadmin-data/ gekopieerd"
else
    echo "   ⚠️ stucadmin-data/ niet gevonden"
fi

# 4. Maak tar.gz archief
echo "🗜️ Comprimeren..."
cd "$BACKUP_DIR"
tar -czf "$BACKUP_NAME.tar.gz" "$BACKUP_NAME"
rm -rf "$BACKUP_NAME"
echo "   ✅ $BACKUP_NAME.tar.gz gemaakt"

# 5. Verwijder lokale backups ouder dan X dagen
echo "🧹 Oude lokale backups opruimen (ouder dan $DAYS_TO_KEEP dagen)..."
find "$BACKUP_DIR" -name "stucadmin-backup-*.tar.gz" -mtime +$DAYS_TO_KEEP -delete
REMAINING=$(ls -1 "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)
echo "   ✅ $REMAINING lokale backups bewaard"

# 6. Upload naar Google Drive
echo "☁️ Uploaden naar Google Drive..."
if command -v rclone &> /dev/null; then
    rclone copy "$BACKUP_DIR/$BACKUP_NAME.tar.gz" gdrive:StucAdmin-Backups/ --progress
    if [ $? -eq 0 ]; then
        echo "   ✅ Geüpload naar Google Drive"
        
        # Verwijder oude backups op Google Drive (ouder dan 30 dagen)
        echo "🧹 Oude Google Drive backups opruimen..."
        rclone delete gdrive:StucAdmin-Backups/ --min-age 30d
        echo "   ✅ Google Drive opgeruimd (30 dagen bewaard)"
    else
        echo "   ❌ Google Drive upload mislukt!"
    fi
else
    echo "   ⚠️ rclone niet geïnstalleerd, geen Google Drive backup"
fi

# 7. Toon backup grootte
SIZE=$(du -h "$BACKUP_DIR/$BACKUP_NAME.tar.gz" | cut -f1)
echo ""
echo "============================================"
echo "✅ Backup voltooid!"
echo "   📁 Lokaal: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
echo "   ☁️ Google Drive: StucAdmin-Backups/"
echo "   📊 Grootte: $SIZE"
echo "   🕐 Tijd: $(date)"
echo "============================================"
