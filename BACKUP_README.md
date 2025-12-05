# Backup-System Dokumentation

Das automatische Backup-System sichert alle JSON-Dateien aus dem `data/` Verzeichnis regelmäßig.

## Konfiguration

Das Backup-System kann über Umgebungsvariablen konfiguriert werden:

### ENV-Variablen

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `BACKUP_ENABLED` | `true` | Aktiviert/deaktiviert das Backup-System (`true`/`false`) |
| `BACKUP_INTERVAL_HOURS` | `24` | Backup-Intervall in Stunden (z.B. `24` für täglich, `168` für wöchentlich) |
| `BACKUP_MAX_COUNT` | `7` | Maximale Anzahl an Backups (ältere werden automatisch gelöscht) |
| `BACKUP_DATA_DIR` | `data` | Verzeichnis mit den zu sichernden JSON-Dateien |
| `BACKUP_DIR` | `backups` | Verzeichnis für die Backups |

### Beispiel-Konfiguration

```env
# Backup täglich um Mitternacht
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_MAX_COUNT=7

# Backup wöchentlich
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=168
BACKUP_MAX_COUNT=4

# Backup deaktivieren
BACKUP_ENABLED=false
```

## Backup-Struktur

Backups werden im Format `YYYY-MM-DD_HH-MM-SS` gespeichert:

```
backups/
├── 2024-01-15_14-30-00/
│   ├── bewerbung-data.json
│   ├── giveaways.json
│   ├── levels.json
│   ├── sticky-messages.json
│   ├── ticket-activity.json
│   ├── tickets.json
│   └── _backup_metadata.json
├── 2024-01-16_14-30-00/
│   └── ...
└── ...
```

## Commands

### `/backup create`
Erstellt ein manuelles Backup aller Daten.

**Berechtigung:** Administrator

### `/backup list`
Zeigt alle verfügbaren Backups an.

**Berechtigung:** Administrator

### `/backup restore backup_name:<name>`
Stellt ein Backup wieder her.

**Berechtigung:** Administrator

**Beispiel:**
```
/backup restore backup_name:2024-01-15_14-30-00
```

**⚠️ Wichtig:** Vor der Wiederherstellung wird automatisch ein Sicherheits-Backup der aktuellen Daten erstellt.

## Automatisches Backup

- Das Backup-System startet automatisch beim Bot-Start
- Das erste Backup wird sofort erstellt
- Weitere Backups werden im konfigurierten Intervall erstellt
- Alte Backups werden automatisch gelöscht (basierend auf `BACKUP_MAX_COUNT`)

## Wiederherstellung

1. Liste alle Backups mit `/backup list`
2. Wähle das gewünschte Backup
3. Stelle es mit `/backup restore backup_name:<name>` wieder her
4. **Wichtig:** Starte den Bot neu, damit die Änderungen wirksam werden

## Fehlerbehandlung

- Bei Fehlern wird eine Fehlermeldung angezeigt
- Fehlerhafte Dateien werden übersprungen, andere Dateien werden trotzdem gesichert
- Alle Fehler werden in der Konsole geloggt
- Metadaten enthalten Informationen über fehlgeschlagene Backups

## Best Practices

1. **Regelmäßige Backups:** Verwende ein Intervall von 24 Stunden für tägliche Backups
2. **Backup-Aufbewahrung:** Behalte mindestens 7 Backups (1 Woche)
3. **Externe Backups:** Kopiere wichtige Backups regelmäßig auf einen externen Server
4. **Test-Wiederherstellung:** Teste die Wiederherstellung regelmäßig, um sicherzustellen, dass alles funktioniert

