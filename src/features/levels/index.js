const {
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createLevelFeature({ client, sendLog, env }) {
    const { map: userLevels, load: loadLevelMap, save: saveLevelMap } = createJsonBackedMap('levels.json');
    const xpCooldownUser = new Map(); // per-user global cooldown
    const xpCooldownChannel = new Map(); // per-user-per-channel cooldown
    const lastMessageFingerprint = new Map(); // key: userId-guildId-channelId -> { fp, ts }

    function calculateLevel(xp) {
        return Math.floor(Math.sqrt(xp / 100));
    }

    function getXPForLevel(level) {
        return level * level * 100;
    }

    function fingerprintMessage(content) {
        const norm = String(content || '')
            .toLowerCase()
            .replace(/[`*_~>|#:\\]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        let hash = 0;
        for (let i = 0; i < norm.length; i++) {
            hash = (hash * 31 + norm.charCodeAt(i)) >>> 0;
        }
        return hash.toString(16);
    }

    function computeXPAmount(messageContent) {
        const len = Math.max(0, Math.min(500, (messageContent || '').length));
        // Base: 5 XP for short, up to 25 XP for ~200+ chars
        const base = Math.min(25, 5 + Math.floor(len / 10));
        // Penalize very short messages
        const penalty = len < 20 ? -5 : len < 40 ? -2 : 0;
        return Math.max(1, base + penalty);
    }

    async function addXP(userId, guildId, amount = 15) {
        const now = Date.now();
        const cooldownUserKey = `${userId}-${guildId}`;
        if (xpCooldownUser.has(cooldownUserKey)) {
            const lastXP = xpCooldownUser.get(cooldownUserKey);
            if (now - lastXP < 45000) {
                return false;
            }
        }
        xpCooldownUser.set(cooldownUserKey, now);

        const currentData = userLevels.get(userId) || { xp: 0, level: 0 };
        const oldLevel = currentData.level;
        currentData.xp += amount;
        currentData.level = calculateLevel(currentData.xp);

        userLevels.set(userId, currentData);
        await saveLevels();

        if (currentData.level > oldLevel && currentData.level >= 5) {
            const modderRoleId = env.MODDER_ROLE_ID;
            if (modderRoleId) {
                try {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        const modderRole = guild.roles.cache.get(modderRoleId);
                        if (member && modderRole && !member.roles.cache.has(modderRoleId)) {
                            await member.roles.add(modderRole);
                            await sendLog(
                                'Level-Up Rolle',
                                `**User:** <@${userId}> (${member.user.tag})\n**Level:** ${currentData.level}\n**Rolle:** ${modderRole.name}`,
                                '<:haken:1434664861664804875>'
                            );
                        }
                    }
                } catch (error) {
                    console.error('Fehler beim Hinzufügen der Modder-Rolle:', error);
                }
            }
        }

        return currentData.level > oldLevel;
    }

    async function loadLevels() {
        try {
            await loadLevelMap();
            console.log(`✅ ${userLevels.size} User-Level geladen`);
        } catch (error) {
            console.error('Fehler beim Laden der Levels:', error);
        }
    }

    async function saveLevels() {
        await saveLevelMap();
    }

    async function handleLevelCommand(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userData = userLevels.get(targetUser.id) || { xp: 0, level: 0 };

        const currentLevel = userData.level;
        const currentXP = userData.xp;
        const xpForNextLevel = getXPForLevel(currentLevel + 1);
        const previousLevelXP = getXPForLevel(currentLevel);
        const xpNeeded = xpForNextLevel - currentXP;
        const progress = currentLevel > 0
            ? ((currentXP - previousLevelXP) / (xpForNextLevel - previousLevelXP)) * 100
            : (currentXP / xpForNextLevel) * 100;

        const levelContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('**## Level-Information**'))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:user:1434651323579502672> **User:** <@${targetUser.id}>\n` +
                        `• <:settings:1434660812395384870> **Level:** ${currentLevel}\n` +
                        `• <:info:1434647594457497784> **XP:** ${currentXP} / ${xpForNextLevel}\n` +
                        `<:haken:1434664861664804875> **XP bis Level ${currentLevel + 1}:** ${xpNeeded}\n` +
                        `• **Fortschritt:** ${Math.round(progress)}%`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [levelContainer],
            flags: MessageFlags.IsComponentsV2
        });
    }

    function buildSortedUsersOnServer(guild) {
        const allUsers = Array.from(userLevels.entries())
            .map(([userId, data]) => ({ userId, xp: data.xp || 0, level: data.level || 0 }));
        const usersOnServer = [];
        return Promise.all(
            allUsers.map(async (user) => {
                const member = await guild.members.fetch(user.userId).catch(() => null);
                if (member) usersOnServer.push(user);
            })
        ).then(() => usersOnServer.sort((a, b) => (b.level !== a.level ? b.level - a.level : b.xp - a.xp)));
    }

    function renderLeaderboardPage(users, page, pageSize) {
        const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
        const clamped = Math.min(Math.max(1, page), totalPages);
        const start = (clamped - 1) * pageSize;
        const pageUsers = users.slice(start, start + pageSize);

        let content = `**## <:settings:1434660812395384870> Level Leaderboard**\n` +
            `Seite ${clamped}/${totalPages}\n\n`;
        for (let i = 0; i < pageUsers.length; i++) {
            const user = pageUsers[i];
            const rank = start + i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            content += `${medal} <@${user.userId}>\n   └ Level ${user.level} | ${user.xp.toLocaleString('de-DE')} XP\n\n`;
        }

        const prevBtn = new ButtonBuilder()
            .setCustomId('level_lb_prev')
            .setLabel('Vorherige')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(clamped <= 1);
        const nextBtn = new ButtonBuilder()
            .setCustomId('level_lb_next')
            .setLabel('Nächste')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(clamped >= totalPages);

        const buttonRow = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addActionRowComponents(buttonRow);

        return { container, totalPages, clamped };
    }

    async function handleLevelLeaderboardCommand(interaction) {
        await interaction.deferReply();

        try {
            const usersOnServer = await buildSortedUsersOnServer(interaction.guild);

            if (usersOnServer.length === 0) {
                const emptyContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Level Leaderboard**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '<:info:1434647594457497784> **Keine Daten verfügbar**\n> Noch hat niemand XP gesammelt.'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                return interaction.editReply({ content: '', components: [emptyContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const pageSize = 10;
            const { container } = renderLeaderboardPage(usersOnServer, 1, pageSize);
            await interaction.editReply({ content: '', components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Fehler beim Abrufen des Leaderboards:', error);
            await interaction.editReply({ content: '<:close:1434661746643308675> Fehler beim Abrufen des Leaderboards!' });
        }
    }

    async function handleLeaderboardNav(interaction, direction) {
        try {
            const usersOnServer = await buildSortedUsersOnServer(interaction.guild);
            const pageSize = 10;
            // Extract current page from message content if present
            const content = interaction.message.components?.[0]?.textDisplays?.[0]?.content || '';
            const match = content.match(/Seite\s(\d+)\/(\d+)/);
            let current = 1;
            let total = Math.max(1, Math.ceil(usersOnServer.length / pageSize));
            if (match) {
                current = parseInt(match[1], 10);
                total = parseInt(match[2], 10);
            }
            const nextPage = direction === 'prev' ? Math.max(1, current - 1) : Math.min(total, current + 1);
            const { container } = renderLeaderboardPage(usersOnServer, nextPage, pageSize);
            await interaction.update({ content: '', components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await interaction.deferUpdate().catch(() => {});
        }
    }

    const buttonHandlers = {
        level_lb_prev: (interaction) => handleLeaderboardNav(interaction, 'prev'),
        level_lb_next: (interaction) => handleLeaderboardNav(interaction, 'next')
    };

    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;
        if (message.content.startsWith('/')) return;

        try {
            const fpKey = `${message.author.id}-${message.guild.id}-${message.channel.id}`;
            const fp = fingerprintMessage(message.content);
            const last = lastMessageFingerprint.get(fpKey);
            const now = Date.now();

            // Per-channel cooldown: 45s
            const chCooldownKey = `${message.author.id}-${message.guild.id}-${message.channel.id}`;
            const lastCh = xpCooldownChannel.get(chCooldownKey);
            if (lastCh && (now - lastCh) < 45000) {
                return;
            }
            xpCooldownChannel.set(chCooldownKey, now);

            // Uniqueness heuristic: skip if same fingerprint within 10 minutes
            if (last && last.fp === fp && (now - last.ts) < 10 * 60 * 1000) {
                return;
            }
            lastMessageFingerprint.set(fpKey, { fp, ts: now });

            const amount = computeXPAmount(message.content);
            await addXP(message.author.id, message.guild.id, amount);
        } catch (error) {
            console.error('Fehler beim Hinzufügen von XP:', error);
        }
    });

    async function handleLevelResetCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = interaction.options.getUser('user');
        const userData = userLevels.get(targetUser.id);

        if (!userData || (userData.xp === 0 && userData.level === 0)) {
            return interaction.reply({
                content: `<:info:1434647594457497784> <@${targetUser.id}> hat noch kein Level oder XP.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const oldLevel = userData.level;
        const oldXP = userData.xp;

        userLevels.set(targetUser.id, { xp: 0, level: 0 });
        await saveLevels();

        const resetContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> Level Zurückgesetzt**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:user:1434651323579502672> **User:** <@${targetUser.id}> (${targetUser.tag})\n` +
                        `• <:settings:1434660812395384870> **Vorher:** Level ${oldLevel} | ${oldXP.toLocaleString('de-DE')} XP\n` +
                        `• <:haken:1434664861664804875> **Jetzt:** Level 0 | 0 XP\n` +
                        `• **Zurückgesetzt von:** <@${interaction.user.id}> (${interaction.user.tag})`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [resetContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await sendLog(
            'Level Zurückgesetzt',
            `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Vorher:** Level ${oldLevel} | ${oldXP.toLocaleString('de-DE')} XP\n**Zurückgesetzt von:** <@${interaction.user.id}> (${interaction.user.tag})`,
            '<:settings:1434660812395384870>'
        );
    }

    return {
        userLevels,
        loadLevels,
        saveLevels,
        addXP,
        calculateLevel,
        getXPForLevel,
        commandHandlers: {
            level: handleLevelCommand,
            'level-leaderboard': handleLevelLeaderboardCommand,
            'level-reset': handleLevelResetCommand
        },
        buttonHandlers
    };
}

module.exports = {
    createLevelFeature
};

