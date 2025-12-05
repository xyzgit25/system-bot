const {
    REST,
    Routes,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { getEnv } = require('./config/env');
const { createClient } = require('./core/client');
const { registerLogging } = require('./features/logging');
const { createTicketFeature } = require('./features/tickets');
const { createGiveawayFeature } = require('./features/giveaways');
const { createLevelFeature } = require('./features/levels');
const { createCommunityFeature } = require('./features/community');
const { createPaypalFeature } = require('./features/paypal');
const { createModerationFeature } = require('./features/moderation');
const { createAutomodFeature } = require('./features/automod');
const { createInfoFeature } = require('./features/info');
const { createEmbedFeature } = require('./features/embeds');
const { createStickyFeature } = require('./features/sticky');
const { createPollFeature } = require('./features/polls');
const { createBackupFeature } = require('./features/backup');
const { createCommandRegistry } = require('./commands/registry');
const { getCommandDefinitions } = require('./commands/definitions');

const env = getEnv();
const client = createClient();

function parseIdList(value) {
    if (!value) return [];
    return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

async function autoDeployCommands() {
    if (env.AUTO_DEPLOY_COMMANDS !== 'true') {
        console.log('ℹ️ AUTO_DEPLOY_COMMANDS deaktiviert. Überspringe Slash-Command-Deployment.');
        return;
    }

    if (!env.APPLICATION_ID) {
        console.warn('⚠️ AUTO_DEPLOY_COMMANDS aktiv, aber APPLICATION_ID fehlt. Überspringe Deployment.');
        return;
    }

    // Standardmäßig globale Commands verwenden (schneller und zuverlässiger)
    // Nur wenn USE_GUILD_COMMANDS=true gesetzt ist, werden Guild-Commands verwendet
    const useGuildCommands = env.USE_GUILD_COMMANDS === 'true';
    const guildIds = useGuildCommands ? parseIdList(env.COMMAND_GUILD_IDS || env.GUILD_ID) : [];

    const rest = new REST({ version: '10' }).setToken(env.TOKEN);
    const payload = getCommandDefinitions();
    const clearBeforeDeploy = env.COMMAND_CLEAR_BEFORE_DEPLOY === 'true';

    try {
        console.log('⚙️ Auto-Deployment der Slash Commands gestartet...');
        
        if (!useGuildCommands || guildIds.length === 0) {
            // Standardmäßig globale Commands deployen (schneller und zuverlässiger)
            if (clearBeforeDeploy) {
                try {
                    await rest.put(Routes.applicationCommands(env.APPLICATION_ID), { body: [] });
                    console.log('🧹 Alte globale Slash Commands entfernt.');
                } catch (error) {
                    console.warn('⚠️ Fehler beim Entfernen globaler Commands (kann ignoriert werden):', error.message);
                }
            }
            
            console.log(`[deploy] Sende ${payload.length} Commands global …`);
            await rest.put(Routes.applicationCommands(env.APPLICATION_ID), { body: payload });
            console.log('✅ Globale Slash Commands automatisch deployed.');
        } else {
            // Nur wenn USE_GUILD_COMMANDS=true gesetzt ist, Guild-Commands verwenden
            if (clearBeforeDeploy) {
                try {
                    await rest.put(Routes.applicationCommands(env.APPLICATION_ID), { body: [] });
                    console.log('🧹 Globale Slash Commands entfernt (nur Guild-Deployment).');
                } catch (error) {
                    console.warn('⚠️ Fehler beim Entfernen globaler Commands (kann ignoriert werden):', error.message);
                }
            }

            for (const guildId of guildIds) {
                try {
                    if (clearBeforeDeploy) {
                        try {
                            await rest.put(Routes.applicationGuildCommands(env.APPLICATION_ID, guildId), { body: [] });
                            console.log(`🧹 Alte Slash Commands für Gilde ${guildId} entfernt.`);
                        } catch (error) {
                            // Ignoriere Fehler beim Entfernen, wenn Bot nicht mehr auf Server ist
                            if (error.code === 50001 || error.status === 404) {
                                console.warn(`⚠️ Gilde ${guildId} nicht gefunden oder kein Zugriff (Bot wurde möglicherweise gekickt). Überspringe...`);
                                continue;
                            }
                            throw error;
                        }
                    }
                    
                    console.log(`[deploy] Sende ${payload.length} Commands an Gilde ${guildId} …`);
                    await rest.put(Routes.applicationGuildCommands(env.APPLICATION_ID, guildId), { body: payload });
                    console.log(`✅ Slash Commands automatisch für Gilde ${guildId} deployed.`);
                } catch (error) {
                    // Prüfe ob Bot von Server gekickt wurde oder keinen Zugriff hat
                    if (error.code === 50001 || error.status === 404 || error.message?.includes('Unknown Guild')) {
                        console.warn(`⚠️ Gilde ${guildId} nicht gefunden oder kein Zugriff (Bot wurde möglicherweise gekickt). Überspringe...`);
                        continue;
                    }
                    console.error(`❌ Fehler beim Deployment für Gilde ${guildId}:`, error.message);
                }
            }
        }
    } catch (error) {
        console.error('❌ Kritischer Fehler beim Auto-Deployment der Slash Commands:', error);
        console.log('⚠️ Bot startet trotzdem...');
    }
}

const { sendLog, commandHandlers: loggingCommands } = registerLogging(client, env);
const tickets = createTicketFeature({ client, sendLog, env });
const giveaways = createGiveawayFeature({ client, sendLog });
const levels = createLevelFeature({ client, sendLog, env });
const community = createCommunityFeature({ client, sendLog, env });
const paypal = createPaypalFeature({ client, sendLog, env });
const moderation = createModerationFeature({ client, sendLog });
const automod = createAutomodFeature({ client, sendLog, moderation });
const info = createInfoFeature({ client, moderation, levels, env });
const embeds = createEmbedFeature({ client, sendLog });
const sticky = createStickyFeature({ client, sendLog });
const polls = createPollFeature({ client, sendLog });
const backup = createBackupFeature({ client, sendLog, env });

async function handleBotStatusCommand(interaction) {
    await interaction.deferReply();

    try {
        const uptime = process.uptime();
        const uptimeDays = Math.floor(uptime / 86400);
        const uptimeHours = Math.floor((uptime % 86400) / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);
        const uptimeSeconds = Math.floor(uptime % 60);

        const memoryUsage = process.memoryUsage();
        const memoryMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
        const memoryTotalMB = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);

        const guildCount = client.guilds.cache.size;
        const userCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const channelCount = client.channels.cache.size;

        const nodeVersion = process.version;
        const platform = process.platform;

        const ping = client.ws.ping;
        const pingStatus = ping < 100 ? '<:haken:1434664861664804875> Gut' : ping < 200 ? '<:info:1434647594457497784> Ok' : '<:close:1434661746643308675> Hoch';

        const statusContent =
            `**## <:settings:1434660812395384870> Bot-Status**\n\n` +
            `**<:info:1434647594457497784> Verbindung**\n` +
            `• Status: <:haken:1434664861664804875> Online\n` +
            `• Ping: **${ping}ms** ${pingStatus}\n` +
            `• Uptime: **${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s**\n\n` +
            `**<:user:1434651323579502672> Statistiken**\n` +
            `• Server: **${guildCount.toLocaleString('de-DE')}**\n` +
            `• User: **${userCount.toLocaleString('de-DE')}**\n` +
            `• Kanäle: **${channelCount.toLocaleString('de-DE')}**\n\n` +
            `**<:settings:1434660812395384870> System**\n` +
            `• Node.js: **${nodeVersion}**\n` +
            `• Platform: **${platform}**\n` +
            `• Memory: **${memoryMB} MB / ${memoryTotalMB} MB**`;

        const statusContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusContent))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.editReply({
            content: '',
            components: [statusContainer],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (error) {
        console.error('Fehler beim Abrufen des Bot-Status:', error);
        await interaction.editReply({
            content: '<:close:1434661746643308675> Fehler beim Abrufen des Bot-Status!'
        });
    }
}

async function handleStatsCommand(interaction) {
    await interaction.deferReply();

    try {
        const guild = interaction.guild;
        const totalMembers = guild.memberCount;
        const onlineMembers = guild.members.cache.filter((m) => m.presence?.status === 'online').size;

        const activeTicketsCount = tickets.activeTickets?.size || 0;
        const activeGiveawaysCount = Array.from(giveaways.activeGiveaways?.values() || []).filter(
            (g) => !g.ended && g.endTime > Date.now()
        ).length;
        const totalGiveawaysCount = giveaways.activeGiveaways?.size || 0;
        const totalUsersWithLevels = levels.userLevels?.size || 0;

        const uptime = process.uptime();
        const uptimeDays = Math.floor(uptime / 86400);
        const uptimeHours = Math.floor((uptime % 86400) / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);

        const statsContent =
            `**## <:info:1434647594457497784> Bot-Statistiken**\n\n` +
            `**<:ticket:1434718078587109458> Tickets**\n` +
            `• Aktive Tickets: **${activeTicketsCount}**\n\n` +
            `**<:preis:1434717917269852181> Giveaways**\n` +
            `• Aktive Giveaways: **${activeGiveawaysCount}**\n` +
            `• Gesamt Giveaways: **${totalGiveawaysCount}**\n\n` +
            `**<:settings:1434660812395384870> Level-System**\n` +
            `• User mit Level: **${totalUsersWithLevels}**\n\n` +
            `**<:user:1434651323579502672> Server**\n` +
            `• Mitglieder: **${totalMembers.toLocaleString('de-DE')}**\n` +
            `• Online: **${onlineMembers.toLocaleString('de-DE')}**\n\n` +
            `**<:clock:1434717138073030797> Bot-Uptime**\n` +
            `• ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;

        const statsContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsContent))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.editReply({
            content: '',
            components: [statsContainer],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (error) {
        console.error('Fehler beim Abrufen der Statistiken:', error);
        await interaction.editReply({
            content: '<:close:1434661746643308675> Fehler beim Abrufen der Statistiken!'
        });
    }
}

const commandRegistry = createCommandRegistry([
    tickets.commandHandlers,
    giveaways.commandHandlers,
    levels.commandHandlers,
    community.commandHandlers,
    paypal.commandHandlers,
    moderation.commandHandlers,
    automod.commandHandlers,
    info.commandHandlers,
    embeds.commandHandlers,
    sticky.commandHandlers,
    polls.commandHandlers,
    backup.commandHandlers,
    loggingCommands,
    { stats: handleStatsCommand, 'bot-status': handleBotStatusCommand }
]);

const buttonHandlers = new Map([
    ...Object.entries(tickets.buttonHandlers || {}),
    ...Object.entries(giveaways.buttonHandlers || {}),
    ...Object.entries(community.buttonHandlers || {}),
    ...Object.entries(paypal.buttonHandlers || {}),
    ...Object.entries(automod.buttonHandlers || {})
]);

const selectMenuHandlers = new Map([
    ...Object.entries(tickets.selectMenuHandlers || {}),
    ...Object.entries(automod.selectMenuHandlers || {})
]);

const modalHandlers = new Map([
    ...Object.entries(tickets.modalHandlers || {}),
    ...Object.entries(paypal.modalHandlers || {}),
    ...Object.entries(automod.modalHandlers || {})
]);

client.once('ready', async () => {
    console.log(`✅ Bot ist online als ${client.user.tag}!`);
    
    await tickets.loadTickets();
    await tickets.scanTicketChannels();
    if (typeof tickets.pruneTickets === 'function') {
        await tickets.pruneTickets();
    }
    if (typeof tickets.setupInactivityChecker === 'function') {
        tickets.setupInactivityChecker();
    }

    await giveaways.loadGiveaways();
    await levels.loadLevels();
    await moderation.loadModerationData();
    await automod.loadAutomodData();
    await sticky.loadStickyData();
    await polls.loadPollData();

    // Starte Backup-System
    if (backup.backupSystem) {
        backup.backupSystem.start();
    }

    console.log('✅ Initialisierung abgeschlossen');
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const handler = commandRegistry.get(interaction.commandName);
            if (!handler) {
        return;
    }

        let commandLog = `**Befehl:** \`/${interaction.commandName}\`\n`;
        commandLog += `**Ausgeführt von:** <@${interaction.user.id}> (${interaction.user.tag})\n`;
            if (interaction.channel) {
                commandLog += `**Kanal:** <#${interaction.channel.id}>\n`;
            }
        if (interaction.options?.data?.length > 0) {
                commandLog += `**Optionen:** ${interaction.options.data
                    .map((option) => `${option.name}: ${option.value}`)
                    .join(', ')}`;
            }
            sendLog('Command Ausgeführt', commandLog, '<:settings:1434660812395384870>').catch((error) =>
                console.error('Log-Fehler:', error)
            );

            await handler(interaction);
    } else if (interaction.isStringSelectMenu()) {
            const handler = selectMenuHandlers.get(interaction.customId);
            if (!handler) {
                return;
        }
            await handler(interaction);
    } else if (interaction.isButton()) {
            // Dynamische Poll-Buttons behandeln
            if (interaction.customId.startsWith('poll|')) {
                await polls.handlePollVote(interaction);
                return;
            }

            const handler = buttonHandlers.get(interaction.customId);
            if (!handler) {
                return;
            }
            await handler(interaction);
        } else if (interaction.isModalSubmit()) {
            const handler = modalHandlers.get(interaction.customId);
            if (!handler) {
                return;
            }
            await handler(interaction);
        }
    } catch (error) {
        console.error('Fehler bei Interaction-Handler:', error);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ 
                content: '<:close:1434661746643308675> Unerwarteter Fehler bei der Ausführung.',
                flags: require('discord.js').MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
});

// Starte Bot-Login sofort und führe Auto-Deployment im Hintergrund aus,
// damit der Bot nicht auf das (langsame / ggf. rate-limitete) Deployment warten muss.
client.login(env.TOKEN)
    .then(() => {
        // Deployment im Hintergrund; Fehler nur loggen, Bot läuft trotzdem weiter.
        autoDeployCommands().catch((error) => {
            console.error('❌ Fehler beim Auto-Deploy:', error);
            console.log('⚠️ Bot läuft weiter, aber Commands wurden ggf. nicht aktualisiert.');
        });
    })
    .catch((error) => {
        console.error('❌ Fehler beim Bot-Login:', error);
    });

