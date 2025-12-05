const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SeparatorBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createAutomodFeature({ client, sendLog, moderation }) {
    const { map: automodConfigs, load: loadAutomodConfigs, save: saveAutomodConfigs } = createJsonBackedMap('automod.json');
    const { map: spamTracker, load: loadSpamTracker, save: saveSpamTracker } = createJsonBackedMap('spam-tracker.json');
    const { map: raidTracker, load: loadRaidTracker, save: saveRaidTracker } = createJsonBackedMap('raid-tracker.json');

    // Standard-Schimpfwörter (kann später erweitert werden)
    const defaultBadWords = [
        'hurensohn', 'hure', 'fotze', 'schwuchtel', 'schwul', 'faggot',
        'nigger', 'neger', 'spast', 'behindert', 'retard', 'idiot',
        'dummkopf', 'arschloch', 'fick', 'ficken', 'scheiße', 'scheisse'
    ];

    // Standard-Link-Domains (kann später erweitert werden)
    // Hinweis: discord.gg wird hier absichtlich nicht als erlaubte Domain gelistet,
    // da Einladungslinks standardmäßig geblockt werden sollen.
    const defaultAllowedDomains = ['discord.com', 'youtube.com', 'youtu.be', 'twitch.tv'];

    function getDefaultConfig() {
        return {
            enabled: false,
            spam: {
                enabled: false,
                maxMessages: 5,
                timeWindow: 10000, // 10 Sekunden
                action: 'delete', // delete, warn, timeout
                timeoutDuration: 60000 // 1 Minute (nur bei action: timeout)
            },
            caps: {
                enabled: false,
                minLength: 10,
                capsPercentage: 70, // 70% Großbuchstaben
                action: 'delete',
                timeoutDuration: 60000 // 1 Minute (nur bei action: timeout)
            },
            links: {
                enabled: false,
                allowedDomains: defaultAllowedDomains,
                action: 'delete',
                timeoutDuration: 60000 // 1 Minute (nur bei action: timeout)
            },
            badWords: {
                enabled: false,
                words: defaultBadWords,
                action: 'delete',
                timeoutDuration: 60000 // 1 Minute (nur bei action: timeout)
            },
            antiRaid: {
                enabled: false,
                maxJoins: 5,
                timeWindow: 60000, // 1 Minute
                action: 'ban', // ban, kick, timeout
                timeoutDuration: 3600000 // 1 Stunde (nur bei action: timeout)
            },
            whitelist: {
                roles: [],
                channels: [],
                users: []
            },
            logChannel: null
        };
    }

    function migrateConfig(config) {
        // Migriere alte Config-Struktur zu neuer Struktur
        if (!config) return getDefaultConfig();

        // Stelle sicher, dass alle neuen Felder vorhanden sind
        const defaultConfig = getDefaultConfig();
        
        // Migriere caps.percentage zu caps.capsPercentage
        if (config.caps && config.caps.percentage && !config.caps.capsPercentage) {
            config.caps.capsPercentage = config.caps.percentage;
            delete config.caps.percentage;
        }

        // Füge timeoutDuration hinzu, falls nicht vorhanden
        if (config.spam && !config.spam.timeoutDuration) {
            config.spam.timeoutDuration = defaultConfig.spam.timeoutDuration;
        }
        if (config.caps && !config.caps.timeoutDuration) {
            config.caps.timeoutDuration = defaultConfig.caps.timeoutDuration;
        }
        if (config.links && !config.links.timeoutDuration) {
            config.links.timeoutDuration = defaultConfig.links.timeoutDuration;
        }
        if (config.badWords && !config.badWords.timeoutDuration) {
            config.badWords.timeoutDuration = defaultConfig.badWords.timeoutDuration;
        }
        if (config.antiRaid && !config.antiRaid.timeoutDuration) {
            config.antiRaid.timeoutDuration = defaultConfig.antiRaid.timeoutDuration;
        }

        // Stelle sicher, dass allowedDomains initialisiert ist
        if (config.links && !config.links.allowedDomains) {
            config.links.allowedDomains = [...defaultAllowedDomains];
        }

        // Stelle sicher, dass words initialisiert ist
        if (config.badWords && !config.badWords.words) {
            config.badWords.words = [...defaultBadWords];
        }

        // Stelle sicher, dass whitelist initialisiert ist
        if (!config.whitelist) {
            config.whitelist = defaultConfig.whitelist;
        }

        return config;
    }

    function getConfig(guildId) {
        const config = automodConfigs.get(guildId);
        if (!config) {
            const defaultConfig = getDefaultConfig();
            automodConfigs.set(guildId, defaultConfig);
            return defaultConfig;
        }
        // Migriere alte Configs
        const migratedConfig = migrateConfig(config);
        if (migratedConfig !== config) {
            automodConfigs.set(guildId, migratedConfig);
        }
        return migratedConfig;
    }

    function isWhitelisted(member, channel, config) {
        const whitelist = config.whitelist || {};
        
        // Prüfe User
        if (whitelist.users && whitelist.users.includes(member.id)) {
            return true;
        }

        // Prüfe Rollen
        if (whitelist.roles && whitelist.roles.length > 0) {
            for (const roleId of whitelist.roles) {
                if (member.roles.cache.has(roleId)) {
                    return true;
                }
            }
        }

        // Prüfe Kanal
        if (whitelist.channels && whitelist.channels.includes(channel.id)) {
            return true;
        }

        // Prüfe Admin/Mod Rechte
        if (member.permissions.has(PermissionFlagsBits.Administrator) || 
            member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return true;
        }

        return false;
    }

    async function checkSpam(message, config) {
        if (!config.spam.enabled) return false;

        const key = `${message.guild.id}-${message.author.id}`;
        const now = Date.now();
        
        let userMessages = spamTracker.get(key) || { messages: [], lastCleanup: now };
        
        // Bereinige alte Nachrichten
        userMessages.messages = userMessages.messages.filter(
            timestamp => now - timestamp < config.spam.timeWindow
        );

        // Füge aktuelle Nachricht hinzu
        userMessages.messages.push(now);
        userMessages.lastCleanup = now;
        spamTracker.set(key, userMessages);

        // Prüfe ob Spam
        if (userMessages.messages.length >= config.spam.maxMessages) {
            await handleViolation(message, 'spam', config.spam.action, config);
            return true;
        }

        return false;
    }

    async function checkCaps(message, config) {
        if (!config.caps.enabled) return false;
        if (message.content.length < config.caps.minLength) return false;

        const capsCount = (message.content.match(/[A-ZÄÖÜ]/g) || []).length;
        const capsPercentage = (capsCount / message.content.length) * 100;

        // Bug-Fix: Verwende capsPercentage statt percentage
        const threshold = config.caps.capsPercentage || config.caps.percentage || 70;
        if (capsPercentage >= threshold) {
            await handleViolation(message, 'caps', config.caps.action, config);
            return true;
        }

        return false;
    }

    async function checkLinks(message, config) {
        if (!config.links.enabled) return false;

        const content = message.content;
        
        // Blockiere Discord-Einladungen immer (discord.gg/... oder discord.com/invite/...)
        const inviteAlwaysBlock = /discord\.gg\/\S+|discord(?:app)?\.com\/invite\/\S+/i;
        if (inviteAlwaysBlock.test(content)) {
            await handleViolation(message, 'links', config.links.action, config);
            return true;
        }

        // Verbesserter Regex: erkennt alle Arten von URLs
        // Einfacherer und robusterer Ansatz
        const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s<>"']*)?/gi;
        
        let allMatches = [];
        let match;
        
        // Reset regex lastIndex
        urlRegex.lastIndex = 0;
        
        // Finde alle Matches
        while ((match = urlRegex.exec(content)) !== null) {
            if (match[0]) {
                allMatches.push(match[0]);
            }
        }
        
        // Zusätzlich: Suche nach discord.gg speziell (falls der Regex es verpasst)
        const discordInviteRegex = /discord\.gg\/[a-zA-Z0-9]+/gi;
        const discordMatches = content.match(discordInviteRegex) || [];
        allMatches.push(...discordMatches);
        
        // Entferne Duplikate und bereinige Matches
        allMatches = [...new Set(allMatches)].map(m => m.trim()).filter(m => m.length > 0);

        if (allMatches.length === 0) return false;

        // Verwende erlaubte Domains aus Config, oder Standard-Liste wenn nicht gesetzt
        let allowedDomains = config.links.allowedDomains;
        if (!allowedDomains || allowedDomains.length === 0) {
            // Wenn keine erlaubten Domains in der Config sind, verwende Standard-Liste
            allowedDomains = [...defaultAllowedDomains];
        }

        const hasBlockedLink = allMatches.some(match => {
            try {
                let domain = '';
                const cleanMatch = match.trim();
                
                // Wenn bereits eine vollständige URL (mit Protokoll)
                if (cleanMatch.toLowerCase().startsWith('http://') || cleanMatch.toLowerCase().startsWith('https://')) {
                    try {
                        // Versuche URL zu parsen
                        const url = new URL(cleanMatch);
                        domain = url.hostname;
                    } catch {
                        // Fallback: extrahiere Domain manuell
                        domain = cleanMatch.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0];
                    }
                } else if (cleanMatch.toLowerCase().startsWith('www.')) {
                    // www. URLs
                    domain = cleanMatch.replace(/^www\./i, '').split('/')[0].split('?')[0].split('#')[0];
                } else {
                    // Domain ohne Protokoll (z.B. discord.gg, example.com)
                    // Entferne mögliche Satzzeichen am Ende (Punkt, Komma, etc.)
                    domain = cleanMatch
                        .replace(/[.,;:!?]+$/, '')  // Entferne Satzzeichen am Ende
                        .split('/')[0]               // Alles vor dem ersten /
                        .split('?')[0]               // Alles vor dem ersten ?
                        .split('#')[0]               // Alles vor dem ersten #
                        .split(':')[0]               // Alles vor dem ersten :
                        .replace(/^\.+|\.+$/g, '')   // Entferne führende/trailing Punkte
                        .trim();
                }
                
                // Normalisiere Domain (lowercase, entferne www.)
                domain = domain.toLowerCase().replace(/^www\./, '').trim();
                
                // Ignoriere sehr kurze Strings (wahrscheinlich keine echten Domains)
                if (domain.length < 3) return false;
                
                // Ignoriere IP-Adressen (z.B. 192.168.1.1)
                if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false;
                
                
                // Wenn keine erlaubten Domains gesetzt sind, blockiere alle Links
                if (allowedDomains.length === 0) {
                    return true; // Blockiere alle Links
                }
                
                // Prüfe ob Domain in erlaubter Liste ist
                const isAllowed = allowedDomains.some(allowed => {
                    const normalizedAllowed = allowed.toLowerCase().replace(/^www\./, '').trim();
                    
                    // Exakte Übereinstimmung
                    if (domain === normalizedAllowed) {
                        return true;
                    }
                    
                    // Subdomain (z.B. subdomain.discord.gg erkennt discord.gg)
                    if (domain.endsWith('.' + normalizedAllowed)) {
                        return true;
                    }
                    
                    // Hauptdomain-Vergleich (z.B. discord.gg erkennt discord.gg)
                    const domainParts = domain.split('.');
                    const allowedParts = normalizedAllowed.split('.');
                    
                    if (domainParts.length >= 2 && allowedParts.length >= 2) {
                        // Vergleiche die letzten beiden Teile (z.B. discord.gg)
                        const domainMain = domainParts.slice(-2).join('.');
                        const allowedMain = allowedParts.slice(-2).join('.');
                        if (domainMain === allowedMain) {
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                // Wenn nicht erlaubt, blockieren
                if (!isAllowed) {
                }
                return !isAllowed;
            } catch (error) {
                // Bei Fehler beim Parsen = blockieren (könnte ein Link sein)
                console.error('Fehler beim Parsen des Links:', cleanMatch, error);
                return true;
            }
        });

        if (hasBlockedLink) {
            await handleViolation(message, 'links', config.links.action, config);
            return true;
        }

        return false;
    }

    async function checkBadWords(message, config) {
        if (!config.badWords.enabled) return false;

        const content = message.content.toLowerCase();
        const badWords = config.badWords.words || [];

        const hasBadWord = badWords.some(word => {
            // Prüfe ob das Wort im Text vorkommt (als ganzes Wort)
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(content);
        });

        if (hasBadWord) {
            await handleViolation(message, 'badwords', config.badWords.action, config);
            return true;
        }

        return false;
    }

    async function checkAntiRaid(member, config) {
        if (!config.antiRaid.enabled) return false;

        const key = `${member.guild.id}`;
        const now = Date.now();
        
        let raidData = raidTracker.get(key) || { joins: [], lastCleanup: now };
        
        // Bereinige alte Joins
        raidData.joins = raidData.joins.filter(
            timestamp => now - timestamp < config.antiRaid.timeWindow
        );

        // Füge aktuellen Join hinzu
        raidData.joins.push(now);
        raidData.lastCleanup = now;
        raidTracker.set(key, raidData);

        // Prüfe ob Raid
        if (raidData.joins.length >= config.antiRaid.maxJoins) {
            await handleRaidViolation(member, config);
            return true;
        }

        return false;
    }

    async function handleViolation(message, violationType, action, config) {
        try {
            // Lösche Nachricht
            await message.delete().catch(() => {});

            const violationNames = {
                spam: 'Spam',
                caps: 'Caps Lock',
                links: 'Links',
                badwords: 'Schimpfwörter'
            };

            // Führe Aktion aus
            if (action === 'warn' && moderation && moderation.warnings) {
                // Füge Warnung direkt hinzu (gleiche Logik wie in moderation/index.js)
                const key = `${message.guild.id}-${message.author.id}`;
                const userWarnings = moderation.warnings.get(key) || { count: 0, warnings: [] };
                userWarnings.count = (userWarnings.count || 0) + 1;
                userWarnings.warnings = userWarnings.warnings || [];
                userWarnings.warnings.push({
                    moderatorId: client.user.id,
                    reason: `Automatische Verwarnung: ${violationNames[violationType]}`,
                    timestamp: Date.now()
                });
                moderation.warnings.set(key, userWarnings);
            } else if (action === 'timeout') {
                try {
                    // Verwende konfigurierbare Timeout-Dauer
                    let timeoutDuration = 60000; // Standard: 1 Minute
                    if (violationType === 'spam' && config.spam.timeoutDuration) {
                        timeoutDuration = config.spam.timeoutDuration;
                    } else if (violationType === 'caps' && config.caps.timeoutDuration) {
                        timeoutDuration = config.caps.timeoutDuration;
                    } else if (violationType === 'links' && config.links.timeoutDuration) {
                        timeoutDuration = config.links.timeoutDuration;
                    } else if (violationType === 'badwords' && config.badWords.timeoutDuration) {
                        timeoutDuration = config.badWords.timeoutDuration;
                    }
                    await message.member.timeout(timeoutDuration, `Automatischer Timeout: ${violationNames[violationType]}`);
                } catch (error) {
                    console.error('Fehler beim Timeout:', error);
                }
            }

            // Log
            if (config.logChannel) {
                const logChannel = message.guild.channels.cache.get(config.logChannel);
                if (logChannel) {
                    const logContainer = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`**## <:close:1434661746643308675> Automoderation Verstoß**`)
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `• <:user:1434651323579502672> **User:** <@${message.author.id}> (${message.author.tag})\n` +
                                `• <:info:1434647594457497784> **Verstoß:** ${violationNames[violationType]}\n` +
                                `• <:settings:1434660812395384870> **Aktion:** ${action === 'delete' ? 'Gelöscht' : action === 'warn' ? 'Verwarnt' : 'Timeout'}\n` +
                                `• <:announce:1434651478114435113> **Kanal:** <#${message.channel.id}>\n` +
                                `• **Nachricht:** ${message.content.substring(0, 200)}${message.content.length > 200 ? '...' : ''}`
                            )
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await logChannel.send({
                        content: '',
                        components: [logContainer],
                        flags: MessageFlags.IsComponentsV2
                    }).catch(() => {});
                }
            }

            // Sende Log über sendLog
            await sendLog(
                'Automoderation Verstoß',
                `**User:** <@${message.author.id}> (${message.author.tag})\n**Verstoß:** ${violationNames[violationType]}\n**Aktion:** ${action}\n**Kanal:** <#${message.channel.id}>`,
                '<:close:1434661746643308675>'
            ).catch(() => {});

        } catch (error) {
            console.error('Fehler beim Behandeln der Verletzung:', error);
            // Versuche zumindest die Nachricht zu löschen, auch wenn der Rest fehlschlägt
            try {
                await message.delete().catch(() => {});
            } catch (deleteError) {
                // Ignoriere Fehler beim Löschen
            }
        }
    }

    async function handleRaidViolation(member, config) {
        try {
            const action = config.antiRaid.action;

            if (action === 'ban') {
                await member.ban({ reason: 'Anti-Raid: Zu viele Joins in kurzer Zeit' });
            } else if (action === 'kick') {
                await member.kick('Anti-Raid: Zu viele Joins in kurzer Zeit');
            } else if (action === 'timeout') {
                const timeoutDuration = config.antiRaid.timeoutDuration || 3600000; // Standard: 1 Stunde
                await member.timeout(timeoutDuration, 'Anti-Raid: Zu viele Joins in kurzer Zeit');
            }

            await sendLog(
                'Anti-Raid Aktiviert',
                `**User:** <@${member.user.id}> (${member.user.tag})\n**Aktion:** ${action}\n**Grund:** Zu viele Joins in kurzer Zeit`,
                '<:close:1434661746643308675>'
            ).catch(() => {});

        } catch (error) {
            console.error('Fehler beim Behandeln des Raids:', error);
        }
    }

    async function loadAutomodData() {
        await loadAutomodConfigs();
        await loadSpamTracker();
        await loadRaidTracker();
        
        // Migriere alle geladenen Configs
        let migratedCount = 0;
        for (const [guildId, config] of automodConfigs.entries()) {
            const migratedConfig = migrateConfig(config);
            if (migratedConfig !== config) {
                automodConfigs.set(guildId, migratedConfig);
                migratedCount++;
            }
        }
        
        // Speichere migrierte Configs
        if (migratedCount > 0) {
            await saveAutomodConfigs();
            console.log(`✅ Automoderation-Daten geladen und ${migratedCount} Config(s) migriert`);
        } else {
            console.log(`✅ Automoderation-Daten geladen`);
        }
    }

    async function saveAutomodData() {
        await saveAutomodConfigs();
        await saveSpamTracker();
        await saveRaidTracker();
    }

    // Event-Listener für Nachrichten
    client.on('messageCreate', async (message) => {
        if (!message.guild || message.author.bot) return;

        try {
            const config = getConfig(message.guild.id);
            if (!config.enabled) return;

            // Prüfe Whitelist
            if (isWhitelisted(message.member, message.channel, config)) {
                return;
            }

            // Prüfe alle Filter (in Reihenfolge, stoppe bei erstem Verstoß)
            if (await checkSpam(message, config)) return;
            if (await checkCaps(message, config)) return;
            if (await checkLinks(message, config)) return;
            if (await checkBadWords(message, config)) return;
        } catch (error) {
            console.error('Fehler beim Prüfen der Automoderation:', error);
            // Fehler nicht weiterwerfen, um Bot nicht zu crashen
        }
    });

    // Event-Listener für Member Joins (Anti-Raid)
    client.on('guildMemberAdd', async (member) => {
        try {
            const config = getConfig(member.guild.id);
            if (!config.enabled || !config.antiRaid.enabled) return;

            // Prüfe Whitelist
            if (isWhitelisted(member, member.guild.systemChannel || member.guild.channels.cache.first(), config)) {
                return;
            }

            await checkAntiRaid(member, config);
        } catch (error) {
            console.error('Fehler beim Prüfen des Anti-Raid:', error);
            // Fehler nicht weiterwerfen, um Bot nicht zu crashen
        }
    });

    // Handler-Funktionen für jeden Subcommand
    async function handleToggle(interaction, guildId, config) {
            const enabled = interaction.options.getBoolean('enabled');
            config.enabled = enabled;
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**## <:settings:1434660812395384870> Automoderation ${enabled ? 'Aktiviert' : 'Deaktiviert'}**`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `Die Automoderation wurde ${enabled ? 'aktiviert' : 'deaktiviert'}.`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleSpam(interaction, guildId, config) {
            config.spam.enabled = interaction.options.getBoolean('enabled');
            if (interaction.options.getInteger('max_messages')) {
                config.spam.maxMessages = interaction.options.getInteger('max_messages');
            }
            if (interaction.options.getInteger('time_window')) {
                config.spam.timeWindow = interaction.options.getInteger('time_window') * 1000;
            }
            if (interaction.options.getString('action')) {
                config.spam.action = interaction.options.getString('action');
            }
            if (interaction.options.getInteger('timeout_duration')) {
                config.spam.timeoutDuration = interaction.options.getInteger('timeout_duration') * 1000; // Sekunden zu Millisekunden
            }
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const timeoutDuration = config.spam.timeoutDuration ? `${config.spam.timeoutDuration / 1000}s` : '60s (Standard)';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Spam-Filter Konfiguriert**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• **Status:** ${config.spam.enabled ? 'Aktiviert' : 'Deaktiviert'}\n` +
                        `• **Max. Nachrichten:** ${config.spam.maxMessages}\n` +
                        `• **Zeitfenster:** ${config.spam.timeWindow / 1000} Sekunden\n` +
                        `• **Aktion:** ${config.spam.action === 'delete' ? 'Löschen' : config.spam.action === 'warn' ? 'Verwarnen' : 'Timeout'}\n` +
                        `${config.spam.action === 'timeout' ? `• **Timeout-Dauer:** ${timeoutDuration}\n` : ''}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleCaps(interaction, guildId, config) {
            config.caps.enabled = interaction.options.getBoolean('enabled');
            if (interaction.options.getInteger('min_length')) {
                config.caps.minLength = interaction.options.getInteger('min_length');
            }
            if (interaction.options.getInteger('caps_percentage')) {
                config.caps.capsPercentage = interaction.options.getInteger('caps_percentage');
            }
            if (interaction.options.getString('action')) {
                config.caps.action = interaction.options.getString('action');
            }
            if (interaction.options.getInteger('timeout_duration')) {
                config.caps.timeoutDuration = interaction.options.getInteger('timeout_duration') * 1000; // Sekunden zu Millisekunden
            }
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const capsPercentage = config.caps.capsPercentage || config.caps.percentage || 70;
            const timeoutDuration = config.caps.timeoutDuration ? `${config.caps.timeoutDuration / 1000}s` : '60s (Standard)';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Caps-Filter Konfiguriert**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• **Status:** ${config.caps.enabled ? 'Aktiviert' : 'Deaktiviert'}\n` +
                        `• **Mindestlänge:** ${config.caps.minLength} Zeichen\n` +
                        `• **Caps-Prozentsatz:** ${capsPercentage}%\n` +
                        `• **Aktion:** ${config.caps.action === 'delete' ? 'Löschen' : config.caps.action === 'warn' ? 'Verwarnen' : 'Timeout'}\n` +
                        `${config.caps.action === 'timeout' ? `• **Timeout-Dauer:** ${timeoutDuration}\n` : ''}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleLinks(interaction, guildId, config) {
            config.links.enabled = interaction.options.getBoolean('enabled');
            if (interaction.options.getString('action')) {
                config.links.action = interaction.options.getString('action');
            }
            if (interaction.options.getInteger('timeout_duration')) {
                config.links.timeoutDuration = interaction.options.getInteger('timeout_duration') * 1000; // Sekunden zu Millisekunden
            }
            // Stelle sicher, dass allowedDomains initialisiert ist
            if (!config.links.allowedDomains) {
                config.links.allowedDomains = [...defaultAllowedDomains];
            }
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const allowedList = config.links.allowedDomains.length > 0 
                ? config.links.allowedDomains.join(', ') 
                : 'Keine (alle Links werden blockiert)';
            const timeoutDuration = config.links.timeoutDuration ? `${config.links.timeoutDuration / 1000}s` : '60s (Standard)';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Link-Filter Konfiguriert**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• **Status:** ${config.links.enabled ? 'Aktiviert' : 'Deaktiviert'}\n` +
                        `• **Aktion:** ${config.links.action === 'delete' ? 'Löschen' : config.links.action === 'warn' ? 'Verwarnen' : 'Timeout'}\n` +
                        `${config.links.action === 'timeout' ? `• **Timeout-Dauer:** ${timeoutDuration}\n` : ''}` +
                        `• **Erlaubte Domains:** ${allowedList}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleAllowedDomains(interaction, guildId, config) {
            const action = interaction.options.getString('action');
            
            // Stelle sicher, dass allowedDomains initialisiert ist
            if (!config.links.allowedDomains) {
                config.links.allowedDomains = [...defaultAllowedDomains];
            }

            if (action === 'list') {
                const allowedList = config.links.allowedDomains.length > 0 
                    ? config.links.allowedDomains.map(d => `• ${d}`).join('\n')
                    : 'Keine (alle Links werden blockiert)';

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Erlaubte Domains**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(allowedList)
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else if (action === 'clear') {
                config.links.allowedDomains = [];
                automodConfigs.set(guildId, config);
                await saveAutomodData();

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:haken:1434664861664804875> Erlaubte Domains Gelöscht**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('Alle erlaubten Domains wurden entfernt. Alle Links werden jetzt blockiert.')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else {
                const domain = interaction.options.getString('domain');
                if (!domain) {
                    return interaction.reply({
                        content: '<:close:1434661746643308675> Bitte gib eine Domain an!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Normalisiere Domain (lowercase, entferne www., entferne http:// etc.)
                let normalizedDomain = domain.toLowerCase().trim();
                normalizedDomain = normalizedDomain.replace(/^https?:\/\//, '');
                normalizedDomain = normalizedDomain.replace(/^www\./, '');
                normalizedDomain = normalizedDomain.split('/')[0].split('?')[0].split('#')[0];

                if (action === 'add') {
                    if (config.links.allowedDomains.includes(normalizedDomain)) {
                        return interaction.reply({
                            content: '<:info:1434647594457497784> Diese Domain ist bereits in der Liste!',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    config.links.allowedDomains.push(normalizedDomain);
                    automodConfigs.set(guildId, config);
                    await saveAutomodData();

                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('**## <:haken:1434664861664804875> Domain Hinzugefügt**')
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`Die Domain \`${normalizedDomain}\` wurde zur erlaubten Liste hinzugefügt.`)
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await interaction.reply({
                        content: '',
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                } else if (action === 'remove') {
                    const index = config.links.allowedDomains.indexOf(normalizedDomain);
                    if (index === -1) {
                        return interaction.reply({
                            content: '<:info:1434647594457497784> Diese Domain ist nicht in der Liste!',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    config.links.allowedDomains.splice(index, 1);
                    automodConfigs.set(guildId, config);
                    await saveAutomodData();

                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('**## <:haken:1434664861664804875> Domain Entfernt**')
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`Die Domain \`${normalizedDomain}\` wurde von der erlaubten Liste entfernt.`)
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await interaction.reply({
                        content: '',
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                }
            }
    }

    async function handleBadWords(interaction, guildId, config) {
            config.badWords.enabled = interaction.options.getBoolean('enabled');
            if (interaction.options.getString('action')) {
                config.badWords.action = interaction.options.getString('action');
            }
            if (interaction.options.getInteger('timeout_duration')) {
                config.badWords.timeoutDuration = interaction.options.getInteger('timeout_duration') * 1000; // Sekunden zu Millisekunden
            }
            // Stelle sicher, dass words initialisiert ist
            if (!config.badWords.words) {
                config.badWords.words = [...defaultBadWords];
            }
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const wordCount = config.badWords.words ? config.badWords.words.length : 0;
            const timeoutDuration = config.badWords.timeoutDuration ? `${config.badWords.timeoutDuration / 1000}s` : '60s (Standard)';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Schimpfwort-Filter Konfiguriert**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• **Status:** ${config.badWords.enabled ? 'Aktiviert' : 'Deaktiviert'}\n` +
                        `• **Aktion:** ${config.badWords.action === 'delete' ? 'Löschen' : config.badWords.action === 'warn' ? 'Verwarnen' : 'Timeout'}\n` +
                        `${config.badWords.action === 'timeout' ? `• **Timeout-Dauer:** ${timeoutDuration}\n` : ''}` +
                        `• **Schimpfwörter:** ${wordCount} Wörter`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleBadWordsManage(interaction, guildId, config) {
            const action = interaction.options.getString('action');
            
            // Stelle sicher, dass words initialisiert ist
            if (!config.badWords.words) {
                config.badWords.words = [...defaultBadWords];
            }

            if (action === 'list') {
                const wordsList = config.badWords.words.length > 0 
                    ? config.badWords.words.map(w => `• \`${w}\``).join('\n')
                    : 'Keine Schimpfwörter konfiguriert';
                
                const wordsDisplay = wordsList.length > 1000 
                    ? wordsList.substring(0, 1000) + '\n... (zu viele zum Anzeigen)'
                    : wordsList;

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Schimpfwörter Liste**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `**Anzahl:** ${config.badWords.words.length}\n\n${wordsDisplay}`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else if (action === 'add') {
                const word = interaction.options.getString('word');
                if (!word) {
                    return interaction.reply({
                        content: '<:close:1434661746643308675> Bitte gib ein Wort an!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const normalizedWord = word.toLowerCase().trim();
                if (config.badWords.words.includes(normalizedWord)) {
                    return interaction.reply({
                        content: '<:info:1434647594457497784> Dieses Wort ist bereits in der Liste!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                config.badWords.words.push(normalizedWord);
                automodConfigs.set(guildId, config);
                await saveAutomodData();

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:haken:1434664861664804875> Schimpfwort Hinzugefügt**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`Das Wort \`${normalizedWord}\` wurde zur Liste hinzugefügt.`)
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else if (action === 'remove') {
                const word = interaction.options.getString('word');
                if (!word) {
                    return interaction.reply({
                        content: '<:close:1434661746643308675> Bitte gib ein Wort an!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const normalizedWord = word.toLowerCase().trim();
                const index = config.badWords.words.indexOf(normalizedWord);
                if (index === -1) {
                    return interaction.reply({
                        content: '<:info:1434647594457497784> Dieses Wort ist nicht in der Liste!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                config.badWords.words.splice(index, 1);
                automodConfigs.set(guildId, config);
                await saveAutomodData();

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:haken:1434664861664804875> Schimpfwort Entfernt**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`Das Wort \`${normalizedWord}\` wurde von der Liste entfernt.`)
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } else if (action === 'clear') {
                config.badWords.words = [];
                automodConfigs.set(guildId, config);
                await saveAutomodData();

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:haken:1434664861664804875> Schimpfwörter Gelöscht**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('Alle Schimpfwörter wurden entfernt. Die Standard-Liste wird beim nächsten Neustart wiederhergestellt.')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
    }

    async function handleAntiRaid(interaction, guildId, config) {
            config.antiRaid.enabled = interaction.options.getBoolean('enabled');
            if (interaction.options.getInteger('max_joins')) {
                config.antiRaid.maxJoins = interaction.options.getInteger('max_joins');
            }
            if (interaction.options.getInteger('time_window')) {
                config.antiRaid.timeWindow = interaction.options.getInteger('time_window') * 1000;
            }
            if (interaction.options.getString('action')) {
                config.antiRaid.action = interaction.options.getString('action');
            }
            if (interaction.options.getInteger('timeout_duration')) {
                config.antiRaid.timeoutDuration = interaction.options.getInteger('timeout_duration') * 1000; // Sekunden zu Millisekunden
            }
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const timeoutDuration = config.antiRaid.timeoutDuration ? `${config.antiRaid.timeoutDuration / 1000}s` : '3600s (Standard)';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Anti-Raid Konfiguriert**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• **Status:** ${config.antiRaid.enabled ? 'Aktiviert' : 'Deaktiviert'}\n` +
                        `• **Max. Joins:** ${config.antiRaid.maxJoins}\n` +
                        `• **Zeitfenster:** ${config.antiRaid.timeWindow / 1000} Sekunden\n` +
                        `• **Aktion:** ${config.antiRaid.action === 'ban' ? 'Bannen' : config.antiRaid.action === 'kick' ? 'Kicken' : 'Timeout'}\n` +
                        `${config.antiRaid.action === 'timeout' ? `• **Timeout-Dauer:** ${timeoutDuration}\n` : ''}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleWhitelist(interaction, guildId, config) {
            const type = interaction.options.getString('type');
            const action = interaction.options.getString('action');

            if (!config.whitelist) {
                config.whitelist = { roles: [], channels: [], users: [] };
            }

            if (action === 'list') {
                const rolesList = config.whitelist.roles.length > 0
                    ? config.whitelist.roles.map(id => `<@&${id}>`).join(', ')
                    : 'Keine';
                const channelsList = config.whitelist.channels.length > 0
                    ? config.whitelist.channels.map(id => `<#${id}>`).join(', ')
                    : 'Keine';
                const usersList = config.whitelist.users.length > 0
                    ? config.whitelist.users.map(id => `<@${id}>`).join(', ')
                    : 'Keine';

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Whitelist**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `• **Rollen:** ${rolesList}\n` +
                            `• **Kanäle:** ${channelsList}\n` +
                            `• **User:** ${usersList}`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await interaction.reply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return;
            }

            let targetId = null;
            if (type === 'role') {
                const role = interaction.options.getRole('role');
                if (!role) {
                    return interaction.reply({
                        content: '<:close:1434661746643308675> Bitte gib eine Rolle an!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                targetId = role.id;
            } else if (type === 'channel') {
                const channel = interaction.options.getChannel('channel');
                if (!channel) {
                    return interaction.reply({
                        content: '<:close:1434661746643308675> Bitte gib einen Kanal an!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                targetId = channel.id;
            } else if (type === 'user') {
                const user = interaction.options.getUser('user');
                if (!user) {
                    return interaction.reply({
                        content: '<:close:1434661746643308675> Bitte gib einen User an!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                targetId = user.id;
            }

            const listKey = type === 'role' ? 'roles' : type === 'channel' ? 'channels' : 'users';
            const list = config.whitelist[listKey] || [];

            if (action === 'add') {
                if (list.includes(targetId)) {
                    return interaction.reply({
                        content: '<:info:1434647594457497784> Dieser Eintrag ist bereits in der Whitelist!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                list.push(targetId);
                config.whitelist[listKey] = list;
            } else if (action === 'remove') {
                const index = list.indexOf(targetId);
                if (index === -1) {
                    return interaction.reply({
                        content: '<:info:1434647594457497784> Dieser Eintrag ist nicht in der Whitelist!',
                        flags: MessageFlags.Ephemeral
                    });
                }
                list.splice(index, 1);
                config.whitelist[listKey] = list;
            }

            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**## <:haken:1434664861664804875> Whitelist ${action === 'add' ? 'Hinzugefügt' : 'Entfernt'}**`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `Der ${type === 'role' ? 'Rolle' : type === 'channel' ? 'Kanal' : 'User'} wurde ${action === 'add' ? 'zur Whitelist hinzugefügt' : 'von der Whitelist entfernt'}.`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleLogChannel(interaction, guildId, config) {
            const channel = interaction.options.getChannel('channel');
            config.logChannel = channel ? channel.id : null;
            automodConfigs.set(guildId, config);
            await saveAutomodData();

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Log-Kanal Gesetzt**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        channel
                            ? `Der Log-Kanal wurde auf <#${channel.id}> gesetzt.`
                            : 'Der Log-Kanal wurde deaktiviert.'
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    async function handleStatus(interaction, guildId, config) {
            const capsPercentage = config.caps.capsPercentage || config.caps.percentage || 70;
            const spamTimeout = config.spam.timeoutDuration ? `${config.spam.timeoutDuration / 1000}s` : '60s';
            const capsTimeout = config.caps.timeoutDuration ? `${config.caps.timeoutDuration / 1000}s` : '60s';
            const linksTimeout = config.links.timeoutDuration ? `${config.links.timeoutDuration / 1000}s` : '60s';
            const badWordsTimeout = config.badWords.timeoutDuration ? `${config.badWords.timeoutDuration / 1000}s` : '60s';
            const antiRaidTimeout = config.antiRaid.timeoutDuration ? `${config.antiRaid.timeoutDuration / 1000}s` : '3600s';
            const badWordsCount = config.badWords.words ? config.badWords.words.length : 0;
            const allowedDomainsCount = config.links.allowedDomains ? config.links.allowedDomains.length : 0;

            const statusContent =
                `**## <:settings:1434660812395384870> Automoderation Status**\n\n` +
                `**Allgemein**\n` +
                `• Status: ${config.enabled ? '<:haken:1434664861664804875> Aktiviert' : '<:close:1434661746643308675> Deaktiviert'}\n` +
                `• Log-Kanal: ${config.logChannel ? `<#${config.logChannel}>` : 'Nicht gesetzt'}\n\n` +
                `**Filter**\n` +
                `• Spam: ${config.spam.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${config.spam.maxMessages} Nachrichten/${config.spam.timeWindow / 1000}s, ${config.spam.action === 'timeout' ? `Timeout: ${spamTimeout}` : config.spam.action})\n` +
                `• Caps: ${config.caps.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (Min: ${config.caps.minLength} Zeichen, ${capsPercentage}%, ${config.caps.action === 'timeout' ? `Timeout: ${capsTimeout}` : config.caps.action})\n` +
                `• Links: ${config.links.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${allowedDomainsCount} erlaubte Domains, ${config.links.action === 'timeout' ? `Timeout: ${linksTimeout}` : config.links.action})\n` +
                `• Schimpfwörter: ${config.badWords.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${badWordsCount} Wörter, ${config.badWords.action === 'timeout' ? `Timeout: ${badWordsTimeout}` : config.badWords.action})\n` +
                `• Anti-Raid: ${config.antiRaid.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${config.antiRaid.maxJoins} Joins/${config.antiRaid.timeWindow / 1000}s, ${config.antiRaid.action === 'timeout' ? `Timeout: ${antiRaidTimeout}` : config.antiRaid.action})\n\n` +
                `**Whitelist**\n` +
                `• Rollen: ${config.whitelist?.roles?.length || 0}\n` +
                `• Kanäle: ${config.whitelist?.channels?.length || 0}\n` +
                `• User: ${config.whitelist?.users?.length || 0}`;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusContent))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    // Panel-Funktion für interaktive Konfiguration
    function buildAutomodPanel(config) {
        const capsPercentage = config.caps.capsPercentage || config.caps.percentage || 70;
        const badWordsCount = config.badWords.words ? config.badWords.words.length : 0;
        const allowedDomainsCount = config.links.allowedDomains ? config.links.allowedDomains.length : 0;

        const panelContent = 
            `**## <:settings:1434660812395384870> Automoderation Panel**\n\n` +
            `**<:info:1434647594457497784> Allgemein**\n` +
            `• Status: ${config.enabled ? '<:haken:1434664861664804875> Aktiviert' : '<:close:1434661746643308675> Deaktiviert'}\n` +
            `• Log-Kanal: ${config.logChannel ? `<#${config.logChannel}>` : 'Nicht gesetzt'}\n\n` +
            `**<:settings:1434660812395384870> Filter**\n` +
            `• Spam: ${config.spam.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${config.spam.maxMessages} Nachrichten/${config.spam.timeWindow / 1000}s)\n` +
            `• Caps: ${config.caps.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (Min: ${config.caps.minLength} Zeichen, ${capsPercentage}%)\n` +
            `• Links: ${config.links.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${allowedDomainsCount} erlaubte Domains)\n` +
            `• Schimpfwörter: ${config.badWords.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${badWordsCount} Wörter)\n` +
            `• Anti-Raid: ${config.antiRaid.enabled ? '<:haken:1434664861664804875> Aktiv' : '<:close:1434661746643308675> Inaktiv'} (${config.antiRaid.maxJoins} Joins/${config.antiRaid.timeWindow / 1000}s)\n\n` +
            `**<:haken:1434664861664804875> Whitelist**\n` +
            `• Rollen: ${config.whitelist?.roles?.length || 0} | Kanäle: ${config.whitelist?.channels?.length || 0} | User: ${config.whitelist?.users?.length || 0}\n\n` +
            `**Verwende die Buttons unten, um die Automoderation zu konfigurieren.**`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(panelContent))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        // Buttons für Haupt-Toggle
        const toggleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('automod_toggle_main')
                .setLabel(config.enabled ? 'Deaktivieren' : 'Aktivieren')
                .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(config.enabled ? '<:close:1434661746643308675>' : '<:haken:1434664861664804875>')
        );

        // Buttons für Filter-Toggle
        const filterRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('automod_toggle_spam')
                .setLabel('Spam')
                .setStyle(config.spam.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(config.spam.enabled ? '<:haken:1434664861664804875>' : '<:close:1434661746643308675>'),
            new ButtonBuilder()
                .setCustomId('automod_toggle_caps')
                .setLabel('Caps')
                .setStyle(config.caps.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(config.caps.enabled ? '<:haken:1434664861664804875>' : '<:close:1434661746643308675>'),
            new ButtonBuilder()
                .setCustomId('automod_toggle_links')
                .setLabel('Links')
                .setStyle(config.links.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(config.links.enabled ? '<:haken:1434664861664804875>' : '<:close:1434661746643308675>'),
            new ButtonBuilder()
                .setCustomId('automod_toggle_badwords')
                .setLabel('Schimpfwörter')
                .setStyle(config.badWords.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(config.badWords.enabled ? '<:haken:1434664861664804875>' : '<:close:1434661746643308675>'),
            new ButtonBuilder()
                .setCustomId('automod_toggle_antiraid')
                .setLabel('Anti-Raid')
                .setStyle(config.antiRaid.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji(config.antiRaid.enabled ? '<:haken:1434664861664804875>' : '<:close:1434661746643308675>')
        );

        // Select Menu für erweiterte Konfiguration
        const configSelect = new StringSelectMenuBuilder()
            .setCustomId('automod_config_select')
            .setPlaceholder('Erweiterte Konfiguration...')
            .addOptions([
                {
                    label: 'Spam konfigurieren',
                    description: 'Spam-Filter Einstellungen ändern',
                    value: 'config_spam',
                    emoji: '<:settings:1434660812395384870>'
                },
                {
                    label: 'Caps konfigurieren',
                    description: 'Caps-Filter Einstellungen ändern',
                    value: 'config_caps',
                    emoji: '<:settings:1434660812395384870>'
                },
                {
                    label: 'Links konfigurieren',
                    description: 'Link-Filter Einstellungen ändern',
                    value: 'config_links',
                    emoji: '<:settings:1434660812395384870>'
                },
                {
                    label: 'Schimpfwörter verwalten',
                    description: 'Schimpfwörter hinzufügen/entfernen',
                    value: 'config_badwords',
                    emoji: '<:settings:1434660812395384870>'
                },
                {
                    label: 'Anti-Raid konfigurieren',
                    description: 'Anti-Raid Einstellungen ändern',
                    value: 'config_antiraid',
                    emoji: '<:settings:1434660812395384870>'
                },
                {
                    label: 'Whitelist verwalten',
                    description: 'Rollen, Kanäle oder User zur Whitelist hinzufügen',
                    value: 'config_whitelist',
                    emoji: '<:haken:1434664861664804875>'
                },
                {
                    label: 'Log-Kanal setzen',
                    description: 'Kanal für Automod-Logs festlegen',
                    value: 'config_logchannel',
                    emoji: '<:info:1434647594457497784>'
                }
            ]);

        const configRow = new ActionRowBuilder().addComponents(configSelect);

        container.addActionRowComponents(toggleRow, filterRow, configRow);

        return container;
    }

    async function handleAutomodPanel(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);

        const panel = buildAutomodPanel(config);

        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    // Button-Handler für Panel-Interaktionen
    async function handleAutomodToggleMain(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);
        config.enabled = !config.enabled;
        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    async function handleAutomodToggleFilter(interaction, filterType) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);

        switch (filterType) {
            case 'spam':
                config.spam.enabled = !config.spam.enabled;
                break;
            case 'caps':
                config.caps.enabled = !config.caps.enabled;
                break;
            case 'links':
                config.links.enabled = !config.links.enabled;
                break;
            case 'badwords':
                config.badWords.enabled = !config.badWords.enabled;
                break;
            case 'antiraid':
                config.antiRaid.enabled = !config.antiRaid.enabled;
                break;
        }

        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    async function handleAutomodConfigSelect(interaction) {
        const value = interaction.values[0];
        
        if (value.startsWith('config_')) {
            const configType = value.replace('config_', '');
            const guildId = interaction.guild.id;
            const config = getConfig(guildId);

            // Modals können nicht direkt von Select Menus geöffnet werden
            // Wir zeigen stattdessen eine Nachricht mit einem Button, der das Modal öffnet
            if (configType === 'spam' || configType === 'caps' || configType === 'links' || configType === 'antiraid') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const configNames = {
                    'spam': 'Spam-Filter',
                    'caps': 'Caps-Filter',
                    'links': 'Link-Filter',
                    'antiraid': 'Anti-Raid'
                };

                const content = 
                    `**## <:settings:1434660812395384870> ${configNames[configType]} Konfiguration**\n\n` +
                    `**<:info:1434647594457497784> Hinweis**\n` +
                    `Klicke auf den Button unten, um die Konfiguration zu öffnen.`;

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                const button = new ButtonBuilder()
                    .setCustomId(`automod_open_modal_${configType}`)
                    .setLabel(`${configNames[configType]} konfigurieren`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<:settings:1434660812395384870>');

                container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

                await interaction.editReply({
                    content: '',
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            } else if (configType === 'badwords') {
                await showBadWordsManagePanel(interaction, config);
            } else if (configType === 'whitelist') {
                await showWhitelistSelectMenu(interaction, config);
            } else if (configType === 'logchannel') {
                await showLogChannelSelectMenu(interaction, config);
            }
        }
    }

    // Modal für Spam-Konfiguration
    async function showSpamConfigModal(interaction, config) {
        const modal = new ModalBuilder()
            .setCustomId('automod_config_spam')
            .setTitle('Spam-Filter Konfiguration');

        const maxMessagesInput = new TextInputBuilder()
            .setCustomId('spam_max_messages')
            .setLabel('Max. Nachrichten')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 5')
            .setValue(String(config.spam.maxMessages || 5))
            .setRequired(true)
            .setMaxLength(2);

        const timeWindowInput = new TextInputBuilder()
            .setCustomId('spam_time_window')
            .setLabel('Zeitfenster (Sekunden)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 10')
            .setValue(String((config.spam.timeWindow || 10000) / 1000))
            .setRequired(true)
            .setMaxLength(2);

        const actionInput = new TextInputBuilder()
            .setCustomId('spam_action')
            .setLabel('Aktion (delete/warn/timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('delete, warn oder timeout')
            .setValue(config.spam.action || 'delete')
            .setRequired(true)
            .setMaxLength(10);

        const timeoutInput = new TextInputBuilder()
            .setCustomId('spam_timeout_duration')
            .setLabel('Timeout-Dauer (Sekunden, nur bei timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 60')
            .setValue(String((config.spam.timeoutDuration || 60000) / 1000))
            .setRequired(false)
            .setMaxLength(6);

        modal.addComponents(
            new ActionRowBuilder().addComponents(maxMessagesInput),
            new ActionRowBuilder().addComponents(timeWindowInput),
            new ActionRowBuilder().addComponents(actionInput),
            new ActionRowBuilder().addComponents(timeoutInput)
        );

        await interaction.showModal(modal);
    }

    // Modal für Caps-Konfiguration
    async function showCapsConfigModal(interaction, config) {
        const modal = new ModalBuilder()
            .setCustomId('automod_config_caps')
            .setTitle('Caps-Filter Konfiguration');

        const minLengthInput = new TextInputBuilder()
            .setCustomId('caps_min_length')
            .setLabel('Mindestlänge')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 10')
            .setValue(String(config.caps.minLength || 10))
            .setRequired(true)
            .setMaxLength(3);

        const capsPercentageInput = new TextInputBuilder()
            .setCustomId('caps_percentage')
            .setLabel('Caps-Prozentsatz (%)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 70')
            .setValue(String(config.caps.capsPercentage || config.caps.percentage || 70))
            .setRequired(true)
            .setMaxLength(3);

        const actionInput = new TextInputBuilder()
            .setCustomId('caps_action')
            .setLabel('Aktion (delete/warn/timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('delete, warn oder timeout')
            .setValue(config.caps.action || 'delete')
            .setRequired(true)
            .setMaxLength(10);

        const timeoutInput = new TextInputBuilder()
            .setCustomId('caps_timeout_duration')
            .setLabel('Timeout-Dauer (Sekunden, nur bei timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 60')
            .setValue(String((config.caps.timeoutDuration || 60000) / 1000))
            .setRequired(false)
            .setMaxLength(6);

        modal.addComponents(
            new ActionRowBuilder().addComponents(minLengthInput),
            new ActionRowBuilder().addComponents(capsPercentageInput),
            new ActionRowBuilder().addComponents(actionInput),
            new ActionRowBuilder().addComponents(timeoutInput)
        );

        await interaction.showModal(modal);
    }

    // Modal für Links-Konfiguration
    async function showLinksConfigModal(interaction, config) {
        const modal = new ModalBuilder()
            .setCustomId('automod_config_links')
            .setTitle('Link-Filter Konfiguration');

        const actionInput = new TextInputBuilder()
            .setCustomId('links_action')
            .setLabel('Aktion (delete/warn/timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('delete, warn oder timeout')
            .setValue(config.links.action || 'delete')
            .setRequired(true)
            .setMaxLength(10);

        const timeoutInput = new TextInputBuilder()
            .setCustomId('links_timeout_duration')
            .setLabel('Timeout-Dauer (Sekunden, nur bei timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 60')
            .setValue(String((config.links.timeoutDuration || 60000) / 1000))
            .setRequired(false)
            .setMaxLength(6);

        const allowedDomainsInput = new TextInputBuilder()
            .setCustomId('links_allowed_domains')
            .setLabel('Erlaubte Domains (kommagetrennt)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('z.B. discord.com, youtube.com, twitch.tv')
            .setValue((config.links.allowedDomains || []).join(', '))
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(
            new ActionRowBuilder().addComponents(actionInput),
            new ActionRowBuilder().addComponents(timeoutInput),
            new ActionRowBuilder().addComponents(allowedDomainsInput)
        );

        await interaction.showModal(modal);
    }

    // Panel für Schimpfwörter-Verwaltung
    async function showBadWordsManagePanel(interaction, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!config.badWords.words) {
            config.badWords.words = [...defaultBadWords];
        }

        const wordsList = config.badWords.words.length > 0 
            ? config.badWords.words.slice(0, 20).map(w => `• \`${w}\``).join('\n')
            : 'Keine Schimpfwörter konfiguriert';

        const content = 
            `**## <:settings:1434660812395384870> Schimpfwörter-Verwaltung**\n\n` +
            `**<:info:1434647594457497784> Aktuelle Liste**\n` +
            `${wordsList}${config.badWords.words.length > 20 ? `\n\n*... und ${config.badWords.words.length - 20} weitere*` : ''}\n\n` +
            `**Gesamt:** ${config.badWords.words.length} Wörter\n\n` +
            `**Verwende das Modal unten, um Wörter hinzuzufügen oder zu entfernen.**`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        // Buttons für Add/Remove
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('automod_badwords_add')
                .setLabel('Wort hinzufügen')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:haken:1434664861664804875>'),
            new ButtonBuilder()
                .setCustomId('automod_badwords_remove')
                .setLabel('Wort entfernen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:close:1434661746643308675>'),
            new ButtonBuilder()
                .setCustomId('automod_badwords_clear')
                .setLabel('Alle löschen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:delete:1434661904743137280>')
        );

        container.addActionRowComponents(buttonRow);

        await interaction.editReply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }

    // Modal für Anti-Raid-Konfiguration
    async function showAntiRaidConfigModal(interaction, config) {
        const modal = new ModalBuilder()
            .setCustomId('automod_config_antiraid')
            .setTitle('Anti-Raid Konfiguration');

        const maxJoinsInput = new TextInputBuilder()
            .setCustomId('antiraid_max_joins')
            .setLabel('Max. Joins')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 5')
            .setValue(String(config.antiRaid.maxJoins || 5))
            .setRequired(true)
            .setMaxLength(2);

        const timeWindowInput = new TextInputBuilder()
            .setCustomId('antiraid_time_window')
            .setLabel('Zeitfenster (Sekunden)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 60')
            .setValue(String((config.antiRaid.timeWindow || 60000) / 1000))
            .setRequired(true)
            .setMaxLength(3);

        const actionInput = new TextInputBuilder()
            .setCustomId('antiraid_action')
            .setLabel('Aktion (ban/kick/timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('ban, kick oder timeout')
            .setValue(config.antiRaid.action || 'ban')
            .setRequired(true)
            .setMaxLength(10);

        const timeoutInput = new TextInputBuilder()
            .setCustomId('antiraid_timeout_duration')
            .setLabel('Timeout-Dauer (Sekunden, nur bei timeout)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 3600')
            .setValue(String((config.antiRaid.timeoutDuration || 3600000) / 1000))
            .setRequired(false)
            .setMaxLength(6);

        modal.addComponents(
            new ActionRowBuilder().addComponents(maxJoinsInput),
            new ActionRowBuilder().addComponents(timeWindowInput),
            new ActionRowBuilder().addComponents(actionInput),
            new ActionRowBuilder().addComponents(timeoutInput)
        );

        await interaction.showModal(modal);
    }

    // Select Menu für Whitelist
    async function showWhitelistSelectMenu(interaction, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const rolesList = config.whitelist?.roles?.length > 0
            ? config.whitelist.roles.map(id => `<@&${id}>`).join(', ')
            : 'Keine';
        const channelsList = config.whitelist?.channels?.length > 0
            ? config.whitelist.channels.map(id => `<#${id}>`).join(', ')
            : 'Keine';
        const usersList = config.whitelist?.users?.length > 0
            ? config.whitelist.users.map(id => `<@${id}>`).join(', ')
            : 'Keine';

        const content = 
            `**## <:haken:1434664861664804875> Whitelist-Verwaltung**\n\n` +
            `**<:info:1434647594457497784> Aktuelle Whitelist**\n` +
            `• Rollen: ${rolesList}\n` +
            `• Kanäle: ${channelsList}\n` +
            `• User: ${usersList}\n\n` +
            `**Verwende die Buttons unten, um Einträge hinzuzufügen oder zu entfernen.**`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('automod_whitelist_type')
            .setPlaceholder('Wähle einen Typ...')
            .addOptions([
                { label: 'Rolle hinzufügen', value: 'add_role', emoji: '<:haken:1434664861664804875>' },
                { label: 'Kanal hinzufügen', value: 'add_channel', emoji: '<:haken:1434664861664804875>' },
                { label: 'User hinzufügen', value: 'add_user', emoji: '<:haken:1434664861664804875>' },
                { label: 'Rolle entfernen', value: 'remove_role', emoji: '<:close:1434661746643308675>' },
                { label: 'Kanal entfernen', value: 'remove_channel', emoji: '<:close:1434661746643308675>' },
                { label: 'User entfernen', value: 'remove_user', emoji: '<:close:1434661746643308675>' }
            ]);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        await interaction.editReply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }

    // Select Menu für Log-Kanal
    async function showLogChannelSelectMenu(interaction, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const content = 
            `**## <:info:1434647594457497784> Log-Kanal**\n\n` +
            `**Aktueller Log-Kanal:** ${config.logChannel ? `<#${config.logChannel}>` : 'Nicht gesetzt'}\n\n` +
            `**Verwende den Button unten, um einen Kanal auszuwählen.**`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('automod_logchannel_select')
            .setPlaceholder('Wähle einen Kanal...')
            .addOptions(
                interaction.guild.channels.cache
                    .filter(ch => ch.isTextBased())
                    .map(ch => ({
                        label: ch.name,
                        value: ch.id,
                        description: ch.type === 0 ? 'Text-Kanal' : 'Thread'
                    }))
                    .slice(0, 25)
            );

        if (config.logChannel) {
            selectMenu.addOptions([{
                label: 'Log-Kanal deaktivieren',
                value: 'disable',
                description: 'Entfernt den aktuellen Log-Kanal',
                emoji: '<:close:1434661746643308675>'
            }]);
        }

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

        await interaction.editReply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }

    // Modal-Handler für Konfigurationen
    async function handleSpamConfigModal(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);

        const maxMessages = parseInt(interaction.fields.getTextInputValue('spam_max_messages')) || 5;
        const timeWindow = (parseInt(interaction.fields.getTextInputValue('spam_time_window')) || 10) * 1000;
        const action = interaction.fields.getTextInputValue('spam_action') || 'delete';
        const timeoutDuration = interaction.fields.getTextInputValue('spam_timeout_duration') 
            ? parseInt(interaction.fields.getTextInputValue('spam_timeout_duration')) * 1000 
            : 60000;

        config.spam.maxMessages = Math.max(2, Math.min(20, maxMessages));
        config.spam.timeWindow = Math.max(5000, Math.min(60000, timeWindow));
        config.spam.action = ['delete', 'warn', 'timeout'].includes(action) ? action : 'delete';
        config.spam.timeoutDuration = timeoutDuration;

        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    async function handleCapsConfigModal(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);

        const minLength = parseInt(interaction.fields.getTextInputValue('caps_min_length')) || 10;
        const capsPercentage = parseInt(interaction.fields.getTextInputValue('caps_percentage')) || 70;
        const action = interaction.fields.getTextInputValue('caps_action') || 'delete';
        const timeoutDuration = interaction.fields.getTextInputValue('caps_timeout_duration') 
            ? parseInt(interaction.fields.getTextInputValue('caps_timeout_duration')) * 1000 
            : 60000;

        config.caps.minLength = Math.max(5, Math.min(100, minLength));
        config.caps.capsPercentage = Math.max(50, Math.min(100, capsPercentage));
        config.caps.action = ['delete', 'warn', 'timeout'].includes(action) ? action : 'delete';
        config.caps.timeoutDuration = timeoutDuration;

        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    async function handleLinksConfigModal(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);

        const action = interaction.fields.getTextInputValue('links_action') || 'delete';
        const timeoutDuration = interaction.fields.getTextInputValue('links_timeout_duration') 
            ? parseInt(interaction.fields.getTextInputValue('links_timeout_duration')) * 1000 
            : 60000;
        const allowedDomainsStr = interaction.fields.getTextInputValue('links_allowed_domains') || '';

        config.links.action = ['delete', 'warn', 'timeout'].includes(action) ? action : 'delete';
        config.links.timeoutDuration = timeoutDuration;

        if (allowedDomainsStr.trim()) {
            config.links.allowedDomains = allowedDomainsStr
                .split(',')
                .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
                .filter(d => d.length > 0);
        }

        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    async function handleAntiRaidConfigModal(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);

        const maxJoins = parseInt(interaction.fields.getTextInputValue('antiraid_max_joins')) || 5;
        const timeWindow = (parseInt(interaction.fields.getTextInputValue('antiraid_time_window')) || 60) * 1000;
        const action = interaction.fields.getTextInputValue('antiraid_action') || 'ban';
        const timeoutDuration = interaction.fields.getTextInputValue('antiraid_timeout_duration') 
            ? parseInt(interaction.fields.getTextInputValue('antiraid_timeout_duration')) * 1000 
            : 3600000;

        config.antiRaid.maxJoins = Math.max(2, Math.min(20, maxJoins));
        config.antiRaid.timeWindow = Math.max(10000, Math.min(300000, timeWindow));
        config.antiRaid.action = ['ban', 'kick', 'timeout'].includes(action) ? action : 'ban';
        config.antiRaid.timeoutDuration = timeoutDuration;

        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    // Button-Handler für Schimpfwörter
    async function handleBadWordsAdd(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('automod_badwords_add_modal')
            .setTitle('Schimpfwort hinzufügen');

        const wordInput = new TextInputBuilder()
            .setCustomId('badword_text')
            .setLabel('Schimpfwort')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. beispiel')
            .setRequired(true)
            .setMaxLength(50);

        modal.addComponents(new ActionRowBuilder().addComponents(wordInput));
        await interaction.showModal(modal);
    }

    async function handleBadWordsRemove(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('automod_badwords_remove_modal')
            .setTitle('Schimpfwort entfernen');

        const wordInput = new TextInputBuilder()
            .setCustomId('badword_text')
            .setLabel('Schimpfwort')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. beispiel')
            .setRequired(true)
            .setMaxLength(50);

        modal.addComponents(new ActionRowBuilder().addComponents(wordInput));
        await interaction.showModal(modal);
    }

    async function handleBadWordsClear(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);
        config.badWords.words = [];
        automodConfigs.set(guildId, config);
        await saveAutomodData();

        await showBadWordsManagePanel(interaction, config);
    }

    async function handleBadWordsAddModal(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);
        const word = interaction.fields.getTextInputValue('badword_text').toLowerCase().trim();

        if (!config.badWords.words) {
            config.badWords.words = [...defaultBadWords];
        }

        if (config.badWords.words.includes(word)) {
            await interaction.followUp({
                content: '<:info:1434647594457497784> Dieses Wort ist bereits in der Liste!',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        config.badWords.words.push(word);
        automodConfigs.set(guildId, config);
        await saveAutomodData();

        await showBadWordsManagePanel(interaction, config);
    }

    async function handleBadWordsRemoveModal(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);
        const word = interaction.fields.getTextInputValue('badword_text').toLowerCase().trim();

        if (!config.badWords.words) {
            config.badWords.words = [...defaultBadWords];
        }

        const index = config.badWords.words.indexOf(word);
        if (index === -1) {
            await interaction.followUp({
                content: '<:info:1434647594457497784> Dieses Wort ist nicht in der Liste!',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        config.badWords.words.splice(index, 1);
        automodConfigs.set(guildId, config);
        await saveAutomodData();

        await showBadWordsManagePanel(interaction, config);
    }

    // Select Menu Handler für Whitelist
    async function handleWhitelistTypeSelect(interaction) {
        const value = interaction.values[0];
        const [action, type] = value.split('_');

        if (action === 'add') {
            // Für Add brauchen wir ein Modal oder eine andere Methode
            // Vereinfacht: Zeige eine Nachricht mit Anweisungen
            await interaction.reply({
                content: `<:info:1434647594457497784> Um eine ${type === 'role' ? 'Rolle' : type === 'channel' ? 'Kanal' : 'User'} zur Whitelist hinzuzufügen, erwähne sie bitte in einer Nachricht oder verwende die Discord-Auswahl.`,
                flags: MessageFlags.Ephemeral
            });
        } else {
            // Für Remove zeigen wir eine Liste zum Auswählen
            const guildId = interaction.guild.id;
            const config = getConfig(guildId);
            const listKey = type === 'role' ? 'roles' : type === 'channel' ? 'channels' : 'users';
            const list = config.whitelist?.[listKey] || [];

            if (list.length === 0) {
                await interaction.reply({
                    content: `<:info:1434647594457497784> Keine ${type === 'role' ? 'Rollen' : type === 'channel' ? 'Kanäle' : 'User'} in der Whitelist!`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Erstelle Select Menu mit den Einträgen
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`automod_whitelist_remove_${type}`)
                .setPlaceholder(`Wähle ${type === 'role' ? 'Rolle' : type === 'channel' ? 'Kanal' : 'User'} zum Entfernen...`)
                .addOptions(
                    list.slice(0, 25).map(id => {
                        const item = type === 'role' 
                            ? interaction.guild.roles.cache.get(id)
                            : type === 'channel'
                            ? interaction.guild.channels.cache.get(id)
                            : interaction.guild.members.cache.get(id)?.user;
                        
                        return {
                            label: item?.name || 'Unbekannt',
                            value: id,
                            description: `ID: ${id}`
                        };
                    })
                );

            await interaction.reply({
                content: `<:info:1434647594457497784> Wähle die ${type === 'role' ? 'Rolle' : type === 'channel' ? 'Kanal' : 'User'} aus, die entfernt werden soll:`,
                components: [new ActionRowBuilder().addComponents(selectMenu)],
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleWhitelistRemove(interaction, type) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);
        const idToRemove = interaction.values[0];
        const listKey = type === 'role' ? 'roles' : type === 'channel' ? 'channels' : 'users';
        const list = config.whitelist?.[listKey] || [];

        const index = list.indexOf(idToRemove);
        if (index !== -1) {
            list.splice(index, 1);
            config.whitelist[listKey] = list;
            automodConfigs.set(guildId, config);
            await saveAutomodData();
        }

        await showWhitelistSelectMenu(interaction, config);
    }

    // Select Menu Handler für Log-Kanal
    async function handleLogChannelSelect(interaction) {
        await interaction.deferUpdate();

        const guildId = interaction.guild.id;
        const config = getConfig(guildId);
        const channelId = interaction.values[0];

        if (channelId === 'disable') {
            config.logChannel = null;
        } else {
            config.logChannel = channelId;
        }

        automodConfigs.set(guildId, config);
        await saveAutomodData();

        const panel = buildAutomodPanel(config);
        await interaction.editReply({
            content: '',
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    }

    // Haupt-Handler-Funktion - zeigt direkt das Panel
    async function handleAutomodCommand(interaction) {
        await handleAutomodPanel(interaction);
    }

    return {
        automodConfigs,
        getConfig,
        getDefaultConfig,
        loadAutomodData,
        saveAutomodData,
        commandHandlers: {
            automod: handleAutomodCommand
        },
        buttonHandlers: {
            automod_toggle_main: handleAutomodToggleMain,
            automod_toggle_spam: (interaction) => handleAutomodToggleFilter(interaction, 'spam'),
            automod_toggle_caps: (interaction) => handleAutomodToggleFilter(interaction, 'caps'),
            automod_toggle_links: (interaction) => handleAutomodToggleFilter(interaction, 'links'),
            automod_toggle_badwords: (interaction) => handleAutomodToggleFilter(interaction, 'badwords'),
            automod_toggle_antiraid: (interaction) => handleAutomodToggleFilter(interaction, 'antiraid'),
            automod_badwords_add: handleBadWordsAdd,
            automod_badwords_remove: handleBadWordsRemove,
            automod_badwords_clear: handleBadWordsClear,
            automod_open_modal_spam: async (interaction) => {
                const config = getConfig(interaction.guild.id);
                await showSpamConfigModal(interaction, config);
            },
            automod_open_modal_caps: async (interaction) => {
                const config = getConfig(interaction.guild.id);
                await showCapsConfigModal(interaction, config);
            },
            automod_open_modal_links: async (interaction) => {
                const config = getConfig(interaction.guild.id);
                await showLinksConfigModal(interaction, config);
            },
            automod_open_modal_antiraid: async (interaction) => {
                const config = getConfig(interaction.guild.id);
                await showAntiRaidConfigModal(interaction, config);
            }
        },
        selectMenuHandlers: {
            automod_config_select: handleAutomodConfigSelect,
            automod_whitelist_type: handleWhitelistTypeSelect,
            automod_whitelist_remove_role: (interaction) => handleWhitelistRemove(interaction, 'role'),
            automod_whitelist_remove_channel: (interaction) => handleWhitelistRemove(interaction, 'channel'),
            automod_whitelist_remove_user: (interaction) => handleWhitelistRemove(interaction, 'user'),
            automod_logchannel_select: handleLogChannelSelect
        },
        modalHandlers: {
            automod_config_spam: handleSpamConfigModal,
            automod_config_caps: handleCapsConfigModal,
            automod_config_links: handleLinksConfigModal,
            automod_config_antiraid: handleAntiRaidConfigModal,
            automod_badwords_add_modal: handleBadWordsAddModal,
            automod_badwords_remove_modal: handleBadWordsRemoveModal
        }
    };
}

module.exports = {
    createAutomodFeature
};

