const {
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { createBackupSystem } = require('../../services/backup');

function createBackupFeature({ client, sendLog, env }) {
    // Backup-Konfiguration aus ENV-Variablen
    const backupEnabled = env.BACKUP_ENABLED !== 'false'; // Standard: aktiviert
    const backupIntervalHours = parseInt(env.BACKUP_INTERVAL_HOURS || '24', 10); // Standard: 24 Stunden
    const maxBackups = parseInt(env.BACKUP_MAX_COUNT || '7', 10); // Standard: 7 Backups
    const dataDir = env.BACKUP_DATA_DIR || 'data';
    const backupDir = env.BACKUP_DIR || 'backups';

    const backupSystem = createBackupSystem({
        dataDir,
        backupDir,
        intervalHours: backupIntervalHours,
        maxBackups,
        enabled: backupEnabled
    });

    async function handleBackupCommand(interaction) {
        const subcommand = interaction.options.getSubcommand();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (subcommand === 'create') {
                // Manuelles Backup erstellen
                const result = await backupSystem.createBackup();

                if (result.success) {
                    // Parse timestamp from format YYYY-MM-DD_HH-MM-SS
                    const timestampParts = result.timestamp.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
                    let backupDate;
                    if (timestampParts) {
                        const [, year, month, day, hour, minute] = timestampParts;
                        const date = new Date(year, month - 1, day, hour, minute);
                        backupDate = date.toLocaleString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    } else {
                        backupDate = new Date().toLocaleString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }

                    const content = `**## <:settings:1434660812395384870> Backup erstellt**\n\n` +
                        `**<:clock:1434717138073030797> Zeitstempel**\n` +
                        `• ${backupDate}\n` +
                        `• \`${result.timestamp}\`\n\n` +
                        `**<:info:1434647594457497784> Details**\n` +
                        `• Dateien gesichert: **${result.filesBackedUp}**\n` +
                        `• Pfad: \`${result.backupPath}\``;

                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await interaction.editReply({
                        content: '',
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });

                    // Log
                    sendLog('Backup erstellt', `Manuelles Backup erstellt: ${result.timestamp}`, '<:settings:1434660812395384870>').catch(() => {});
                } else {
                    const errorContent = `**## <:close:1434661746643308675> Fehler beim Erstellen des Backups**\n\n` +
                        `**<:info:1434647594457497784> Fehler**\n` +
                        `• ${result.error || 'Unbekannter Fehler'}\n\n` +
                        `Bitte versuche es erneut oder kontaktiere einen Administrator.`;

                    const errorContainer = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(errorContent))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await interaction.editReply({
                        content: '',
                        components: [errorContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                }
            } else if (subcommand === 'list') {
                // Liste aller Backups
                const backups = await backupSystem.listBackups();

                if (backups.length === 0) {
                    const noBackupsContent = `**## <:settings:1434660812395384870> Backup-Liste**\n\n` +
                        `**<:info:1434647594457497784> Keine Backups gefunden**\n` +
                        `• Es wurden noch keine Backups erstellt.\n` +
                        `• Verwende \`/backup create\` um ein Backup zu erstellen.`;

                    const noBackupsContainer = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(noBackupsContent))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await interaction.editReply({
                        content: '',
                        components: [noBackupsContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                    return;
                }

                // Formatiere Backup-Liste
                let backupListContent = `**## <:settings:1434660812395384870> Backup-Liste**\n\n` +
                    `**<:info:1434647594457497784> Verfügbare Backups**\n` +
                    `• Gesamt: **${backups.length}**\n\n`;

                // Zeige maximal 10 Backups an
                const displayBackups = backups.slice(0, 10);
                for (let i = 0; i < displayBackups.length; i++) {
                    const backup = displayBackups[i];
                    const date = backup.metadata?.timestamp 
                        ? new Date(backup.metadata.timestamp).toLocaleString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        : backup.name.replace(/_/g, ' ').replace(/-/g, ':');
                    
                    const filesInfo = backup.metadata?.filesBackedUp 
                        ? ` • **${backup.metadata.filesBackedUp}** Dateien`
                        : '';

                    backupListContent += `**${i + 1}.** \`${backup.name}\`\n` +
                        `   <:clock:1434717138073030797> ${date}${filesInfo}\n\n`;
                }

                if (backups.length > 10) {
                    backupListContent += `*... und ${backups.length - 10} weitere Backups*\n\n`;
                }

                backupListContent += `**<:haken:1434664861664804875> Wiederherstellen**\n` +
                    `Verwende \`/backup restore backup_name:<name>\` zum Wiederherstellen`;

                const listContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(backupListContent))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.editReply({
                    content: '',
                    components: [listContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            } else if (subcommand === 'restore') {
                // Backup wiederherstellen
                const backupName = interaction.options.getString('backup_name', true);

                try {
                    const result = await backupSystem.restoreBackup(backupName);

                    if (result.success) {
                        const restoreContent = `**## <:haken:1434664861664804875> Backup wiederhergestellt**\n\n` +
                            `**<:settings:1434660812395384870> Backup-Details**\n` +
                            `• Backup: \`${backupName}\`\n` +
                            `• Dateien wiederhergestellt: **${result.restored}/${result.totalFiles}**\n\n` +
                            `**<:info:1434647594457497784> Wichtig**\n` +
                            `• Der Bot muss möglicherweise neu gestartet werden, damit die Änderungen wirksam werden.`;

                        const restoreContainer = new ContainerBuilder()
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(restoreContent))
                            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                        await interaction.editReply({
                            content: '',
                            components: [restoreContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        // Log
                        sendLog('Backup wiederhergestellt', `Backup ${backupName} wurde wiederhergestellt von ${interaction.user.tag}`, '<:settings:1434660812395384870>').catch(() => {});
                    }
                } catch (error) {
                    const errorContent = `**## <:close:1434661746643308675> Fehler beim Wiederherstellen**\n\n` +
                        `**<:info:1434647594457497784> Fehler**\n` +
                        `• ${error.message}\n\n` +
                        `**<:settings:1434660812395384870> Hilfe**\n` +
                        `• Stelle sicher, dass der Backup-Name korrekt ist.\n` +
                        `• Verwende \`/backup list\` um alle Backups anzuzeigen.`;

                    const errorContainer = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(errorContent))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await interaction.editReply({
                        content: '',
                        components: [errorContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                }
            }
        } catch (error) {
            console.error('Fehler beim Backup-Command:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Unerwarteter Fehler beim Ausführen des Backup-Befehls!'
            });
        }
    }

    return {
        commandHandlers: {
            backup: handleBackupCommand
        },
        backupSystem // Exportiere für direkten Zugriff in app.js
    };
}

module.exports = {
    createBackupFeature
};

