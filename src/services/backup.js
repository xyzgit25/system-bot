const fs = require('fs').promises;
const path = require('path');

/**
 * Erstellt ein Backup-System für JSON-Dateien
 * @param {Object} options - Konfigurationsoptionen
 * @param {string} options.dataDir - Pfad zum Datenverzeichnis
 * @param {string} options.backupDir - Pfad zum Backup-Verzeichnis
 * @param {number} options.intervalHours - Backup-Intervall in Stunden (Standard: 24)
 * @param {number} options.maxBackups - Maximale Anzahl an Backups (Standard: 7)
 * @param {boolean} options.enabled - Backup-System aktiviert/deaktiviert (Standard: true)
 */
function createBackupSystem({ dataDir = 'data', backupDir = 'backups', intervalHours = 24, maxBackups = 7, enabled = true }) {
    const dataPath = path.join(process.cwd(), dataDir);
    const backupsPath = path.join(process.cwd(), backupDir);
    let backupInterval = null;
    let isRunning = false;

    /**
     * Erstellt einen Zeitstempel für Backup-Ordner
     */
    function getTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    }

    /**
     * Liest alle JSON-Dateien aus dem Datenverzeichnis
     */
    async function getDataFiles() {
        try {
            const files = await fs.readdir(dataPath);
            return files.filter(file => file.endsWith('.json'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`⚠️ Datenverzeichnis ${dataPath} nicht gefunden. Erstelle es...`);
                await fs.mkdir(dataPath, { recursive: true });
                return [];
            }
            throw error;
        }
    }

    /**
     * Erstellt ein Backup aller JSON-Dateien
     * @returns {Promise<{success: boolean, backupPath: string, filesBackedUp: number, error?: string}>}
     */
    async function createBackup() {
        if (isRunning) {
            console.log('⏳ Backup läuft bereits, überspringe...');
            return { success: false, error: 'Backup läuft bereits' };
        }

        isRunning = true;
        const timestamp = getTimestamp();
        const backupFolderPath = path.join(backupsPath, timestamp);

        try {
            // Erstelle Backup-Verzeichnis
            await fs.mkdir(backupFolderPath, { recursive: true });

            // Lese alle JSON-Dateien
            const dataFiles = await getDataFiles();

            if (dataFiles.length === 0) {
                console.log('ℹ️ Keine JSON-Dateien zum Backup gefunden.');
                await fs.rmdir(backupFolderPath); // Lösche leeren Ordner
                isRunning = false;
                return { success: true, backupPath: null, filesBackedUp: 0 };
            }

            let filesBackedUp = 0;
            const errors = [];

            // Kopiere jede JSON-Datei
            for (const file of dataFiles) {
                try {
                    const sourcePath = path.join(dataPath, file);
                    const destPath = path.join(backupFolderPath, file);

                    // Prüfe ob Datei existiert
                    try {
                        await fs.access(sourcePath);
                    } catch {
                        console.warn(`⚠️ Datei ${file} existiert nicht, überspringe...`);
                        continue;
                    }

                    // Kopiere Datei
                    await fs.copyFile(sourcePath, destPath);
                    filesBackedUp++;
                } catch (error) {
                    errors.push({ file, error: error.message });
                    console.error(`❌ Fehler beim Backup von ${file}:`, error.message);
                }
            }

            // Erstelle Backup-Metadaten
            const metadata = {
                timestamp: new Date().toISOString(),
                filesBackedUp,
                totalFiles: dataFiles.length,
                errors: errors.length > 0 ? errors : undefined
            };

            await fs.writeFile(
                path.join(backupFolderPath, '_backup_metadata.json'),
                JSON.stringify(metadata, null, 2),
                'utf-8'
            );

            if (errors.length > 0) {
                console.warn(`⚠️ Backup abgeschlossen mit ${errors.length} Fehlern. ${filesBackedUp}/${dataFiles.length} Dateien gesichert.`);
            } else {
                console.log(`✅ Backup erfolgreich erstellt: ${timestamp} (${filesBackedUp} Dateien)`);
            }

            isRunning = false;
            return {
                success: errors.length === 0,
                backupPath: backupFolderPath,
                filesBackedUp,
                timestamp,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            isRunning = false;
            console.error('❌ Kritischer Fehler beim Erstellen des Backups:', error);
            return {
                success: false,
                error: error.message,
                backupPath: null,
                filesBackedUp: 0
            };
        }
    }

    /**
     * Bereinigt alte Backups und behält nur die neuesten
     */
    async function cleanupOldBackups() {
        try {
            // Erstelle Backup-Verzeichnis falls nicht vorhanden
            await fs.mkdir(backupsPath, { recursive: true });

            // Lese alle Backup-Ordner
            const entries = await fs.readdir(backupsPath, { withFileTypes: true });
            const backupFolders = entries
                .filter(entry => entry.isDirectory() && entry.name.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/))
                .map(entry => ({
                    name: entry.name,
                    path: path.join(backupsPath, entry.name)
                }));

            if (backupFolders.length <= maxBackups) {
                return { deleted: 0, kept: backupFolders.length };
            }

            // Sortiere nach Name (Zeitstempel) - neueste zuerst
            backupFolders.sort((a, b) => b.name.localeCompare(a.name));

            // Lösche alte Backups
            const toDelete = backupFolders.slice(maxBackups);
            let deleted = 0;

            for (const folder of toDelete) {
                try {
                    // Lösche gesamten Ordner rekursiv
                    await fs.rm(folder.path, { recursive: true, force: true });
                    deleted++;
                    console.log(`🗑️ Altes Backup gelöscht: ${folder.name}`);
                } catch (error) {
                    console.error(`❌ Fehler beim Löschen von Backup ${folder.name}:`, error.message);
                }
            }

            const kept = backupFolders.length - deleted;
            if (deleted > 0) {
                console.log(`🧹 Backup-Bereinigung: ${deleted} alte Backups gelöscht, ${kept} behalten`);
            }

            return { deleted, kept };
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Backup-Verzeichnis existiert noch nicht, kein Problem
                return { deleted: 0, kept: 0 };
            }
            console.error('❌ Fehler bei Backup-Bereinigung:', error);
            return { deleted: 0, kept: 0, error: error.message };
        }
    }

    /**
     * Startet das automatische Backup-System
     */
    function start() {
        if (!enabled) {
            console.log('ℹ️ Backup-System ist deaktiviert.');
            return;
        }

        if (backupInterval) {
            console.warn('⚠️ Backup-System läuft bereits.');
            return;
        }

        console.log(`🔄 Backup-System gestartet (Intervall: ${intervalHours} Stunden, Max Backups: ${maxBackups})`);

        // Erstelle sofort ein Backup beim Start
        createBackup().then(() => {
            cleanupOldBackups();
        }).catch(error => {
            console.error('❌ Fehler beim ersten Backup:', error);
        });

        // Setze Intervall für regelmäßige Backups
        const intervalMs = intervalHours * 60 * 60 * 1000;
        backupInterval = setInterval(async () => {
            const result = await createBackup();
            if (result.success) {
                await cleanupOldBackups();
            }
        }, intervalMs);
    }

    /**
     * Stoppt das automatische Backup-System
     */
    function stop() {
        if (backupInterval) {
            clearInterval(backupInterval);
            backupInterval = null;
            console.log('⏹️ Backup-System gestoppt.');
        }
    }

    /**
     * Listet alle verfügbaren Backups auf
     */
    async function listBackups() {
        try {
            await fs.mkdir(backupsPath, { recursive: true });
            const entries = await fs.readdir(backupsPath, { withFileTypes: true });
            const backupFolders = entries
                .filter(entry => entry.isDirectory() && entry.name.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/))
                .map(entry => ({
                    name: entry.name,
                    path: path.join(backupsPath, entry.name)
                }))
                .sort((a, b) => b.name.localeCompare(a.name));

            const backupsWithMetadata = [];

            for (const folder of backupFolders) {
                try {
                    const metadataPath = path.join(folder.path, '_backup_metadata.json');
                    let metadata = null;
                    try {
                        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
                        metadata = JSON.parse(metadataContent);
                    } catch {
                        // Keine Metadaten vorhanden, verwende Ordner-Name als Timestamp
                        metadata = { timestamp: folder.name };
                    }

                    backupsWithMetadata.push({
                        ...folder,
                        metadata
                    });
                } catch (error) {
                    console.warn(`⚠️ Fehler beim Lesen von Backup ${folder.name}:`, error.message);
                }
            }

            return backupsWithMetadata;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Stellt ein Backup wieder her
     * @param {string} backupName - Name des Backup-Ordners (z.B. "2024-01-15_14-30-00")
     */
    async function restoreBackup(backupName) {
        const backupPath = path.join(backupsPath, backupName);

        try {
            // Prüfe ob Backup existiert
            await fs.access(backupPath);

            // Lese alle Dateien im Backup
            const files = await fs.readdir(backupPath);
            const jsonFiles = files.filter(file => file.endsWith('.json') && file !== '_backup_metadata.json');

            if (jsonFiles.length === 0) {
                throw new Error('Keine JSON-Dateien im Backup gefunden');
            }

            // Erstelle Backup der aktuellen Daten (Sicherheit)
            const safetyBackup = await createBackup();
            if (!safetyBackup.success) {
                console.warn('⚠️ Konnte kein Sicherheits-Backup erstellen. Stelle trotzdem wieder her...');
            }

            // Kopiere Dateien zurück
            let restored = 0;
            for (const file of jsonFiles) {
                try {
                    const sourcePath = path.join(backupPath, file);
                    const destPath = path.join(dataPath, file);

                    await fs.copyFile(sourcePath, destPath);
                    restored++;
                } catch (error) {
                    console.error(`❌ Fehler beim Wiederherstellen von ${file}:`, error.message);
                }
            }

            console.log(`✅ Backup wiederhergestellt: ${backupName} (${restored} Dateien)`);
            return { success: true, restored, totalFiles: jsonFiles.length };
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Backup ${backupName} nicht gefunden`);
            }
            throw error;
        }
    }

    return {
        createBackup,
        cleanupOldBackups,
        start,
        stop,
        listBackups,
        restoreBackup,
        isEnabled: enabled,
        getBackupPath: () => backupsPath,
        getDataPath: () => dataPath
    };
}

module.exports = {
    createBackupSystem
};

