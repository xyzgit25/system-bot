const {
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createLevelFeature({ client, sendLog, env }) {
    const { map: userLevels, load: loadLevelMap, save: saveLevelMap } = createJsonBackedMap('levels.json');
    const xpCooldown = new Map();

    function calculateLevel(xp) {
        return Math.floor(Math.sqrt(xp / 100));
    }

    function getXPForLevel(level) {
        return level * level * 100;
    }

    async function addXP(userId, guildId, amount = 15) {
        const now = Date.now();
        const cooldownKey = `${userId}-${guildId}`;

        if (xpCooldown.has(cooldownKey)) {
            const lastXP = xpCooldown.get(cooldownKey);
            if (now - lastXP < 60000) {
                return false;
            }
        }

        xpCooldown.set(cooldownKey, now);

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

    async function handleLevelLeaderboardCommand(interaction) {
        await interaction.deferReply();

        try {
            const allUsers = Array.from(userLevels.entries())
                .map(([userId, data]) => ({
                    userId,
                    xp: data.xp || 0,
                    level: data.level || 0
                }));

            const usersOnServer = [];
            for (const user of allUsers) {
                try {
                    const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
                    if (member) {
                        usersOnServer.push(user);
                    }
                } catch (error) {
                    // User nicht auf Server, überspringen
                }
            }

            const sortedUsers = usersOnServer
                .sort((a, b) => {
                    if (b.level !== a.level) {
                        return b.level - a.level;
                    }
                    return b.xp - a.xp;
                })
                .slice(0, 10);

            if (sortedUsers.length === 0) {
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

                return interaction.editReply({
                    content: '',
                    components: [emptyContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            let leaderboardContent = '**## <:settings:1434660812395384870> Level Leaderboard (Top 10)**\n\n';

            for (let i = 0; i < sortedUsers.length; i++) {
                const user = sortedUsers[i];
                const rank = i + 1;
                const medal =
                    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

                try {
                    const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
                    if (member) {
                        leaderboardContent +=
                            `${medal} <@${user.userId}>\n` +
                            `   └ Level ${user.level} | ${user.xp.toLocaleString('de-DE')} XP\n\n`;
                    }
                } catch (error) {
                    // User nicht mehr auf Server, überspringen
                }
            }

            const leaderboardContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(leaderboardContent))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [leaderboardContainer],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Abrufen des Leaderboards:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Abrufen des Leaderboards!'
            });
        }
    }

    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;
        if (message.content.startsWith('/')) return;

        try {
            await addXP(message.author.id, message.guild.id, 15);
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
        }
    };
}

module.exports = {
    createLevelFeature
};

