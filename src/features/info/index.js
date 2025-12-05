const {
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');

function parseIdList(value) {
    if (!value) return [];
    return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

function createInfoFeature({ client, moderation, levels, env }) {
    // Merkt sich pro Gilde die "offizielle" Staff-Nachricht, damit sie live aktualisiert werden kann
    const staffMessages = new Map(); // guildId -> { channelId, messageId }

    async function createStaffContainer(guild) {
        const titleContent = '**## Our Staff**';
        let bodyContent = '';
        let dateContent = '';

        const envKeys = [
            'STAFF_OWNER_ROLE_IDS',
            'STAFF_STV_INHABER_ROLE_IDS',
            'STAFF_MANAGEMENT_ROLE_IDS',
            'STAFF_SUPPORTER_ROLE_IDS',
            'STAFF_MEDIA_LEITUNG_ROLE_IDS'
        ];

        const handledRoleIds = new Set();

        for (const envKey of envKeys) {
            const roleIds = parseIdList(env[envKey]);
            if (roleIds.length === 0) continue;

            for (const roleId of roleIds) {
                if (handledRoleIds.has(roleId)) continue;
                handledRoleIds.add(roleId);

                const role = guild.roles.cache.get(roleId);
                if (!role) continue;

                const members = Array.from(role.members.values());
                if (members.length === 0) continue;

                // Überschrift = Rollen-Mention (@Rolle), aber ohne Ping dank allowedMentions
                bodyContent += `<@&${role.id}>\n`;

                for (const member of members) {
                    // Safety: nur gültige Member mit User-Objekt anzeigen (verhindert "Unknown User")
                    if (!member || !member.user) continue;
                    bodyContent += `• ${member.toString()}\n`;
                }

                bodyContent += '\n';
            }
        }

        if (!bodyContent.trim()) {
            bodyContent = 'Keine Staff-Rollen konfiguriert oder keine Mitglieder gefunden.';
        } else {
            const now = Math.floor(Date.now() / 1000);
            dateContent = `<t:${now}:F>`;
        }

        const staffContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleContent))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyContent))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        if (dateContent) {
            staffContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dateContent));
        }

        return staffContainer;
    }

    async function refreshStaffMessage(guild) {
        const info = staffMessages.get(guild.id);
        if (!info) return;

        try {
            const channel =
                guild.channels.cache.get(info.channelId) ||
                (await guild.channels.fetch(info.channelId).catch(() => null));
            if (!channel || !channel.isTextBased()) return;

            const message = await channel.messages.fetch(info.messageId).catch(() => null);
            if (!message) return;

            const staffContainer = await createStaffContainer(guild);

            await message.edit({
                content: '',
                components: [staffContainer],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [], roles: [] }
            });
        } catch (error) {
            console.error('Fehler beim Aktualisieren der Staff-Nachricht:', error);
        }
    }

    // Live-Updates: Alle 10 Sekunden alle gemerkten Staff-Nachrichten aktualisieren
    setInterval(async () => {
        try {
            for (const guildId of staffMessages.keys()) {
                const guild =
                    client.guilds.cache.get(guildId) ||
                    (await client.guilds.fetch(guildId).catch(() => null));
                if (!guild) continue;

                await refreshStaffMessage(guild);
            }
        } catch (error) {
            console.error('Fehler beim periodischen Aktualisieren der Staff-Nachrichten:', error);
        }
    }, 10_000);
    async function handleServerinfoCommand(interaction) {
        await interaction.deferReply();

        try {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();
            const members = guild.members.cache;
            const channels = guild.channels.cache;
            const roles = guild.roles.cache;

            const totalMembers = guild.memberCount;
            // Zähle alle Mitglieder, die nicht offline sind (online, idle, dnd)
            const onlineMembers = members.filter((m) => {
                const status = m.presence?.status;
                return status && status !== 'offline';
            }).size;
            const bots = members.filter((m) => m.user.bot).size;
            const humans = totalMembers - bots;

            const textChannels = channels.filter((c) => c.type === 0).size;
            const voiceChannels = channels.filter((c) => c.type === 2).size;
            const categories = channels.filter((c) => c.type === 4).size;

            const createdDate = new Date(guild.createdTimestamp);
            const createdDateStr = createdDate.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            const serverInfoContent =
                `**## <:info:1434647594457497784> Server-Informationen**\n\n` +
                `**<:user:1434651323579502672> Mitglieder**\n` +
                `• Gesamt: **${totalMembers.toLocaleString('de-DE')}**\n` +
                `• Online: **${onlineMembers.toLocaleString('de-DE')}**\n` +
                `• Menschen: **${humans.toLocaleString('de-DE')}**\n` +
                `• Bots: **${bots.toLocaleString('de-DE')}**\n\n` +
                `**<:settings:1434660812395384870> Kanäle**\n` +
                `• Text: **${textChannels}**\n` +
                `• Voice: **${voiceChannels}**\n` +
                `• Kategorien: **${categories}**\n` +
                `• Gesamt: **${channels.size}**\n\n` +
                `**<:info:1434647594457497784> Weitere Informationen**\n` +
                `• Owner: <@${owner.id}>\n` +
                `• Rollen: **${roles.size}**\n` +
                `• Server-ID: \`${guild.id}\`\n` +
                `• Erstellt: **${createdDateStr}**\n` +
                `• Boost-Level: **${guild.premiumTier}**\n` +
                `• Boosts: **${guild.premiumSubscriptionCount || 0}**`;

            const serverInfoContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(serverInfoContent))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [serverInfoContainer],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Abrufen der Server-Informationen:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Abrufen der Server-Informationen!'
            });
        }
    }

    async function handleUserinfoCommand(interaction) {
        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            if (!member) {
                return interaction.editReply({
                    content: '<:close:1434661746643308675> User nicht auf dem Server gefunden!'
                });
            }

            const joinDate = new Date(member.joinedTimestamp);
            const joinDateStr = joinDate.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const createdDate = new Date(targetUser.createdTimestamp);
            const createdDateStr = createdDate.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            const roles = member.roles.cache
                .filter((role) => role.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .map((role) => `<@&${role.id}>`)
                .slice(0, 10)
                .join(', ');

            const userLevelData = levels?.userLevels?.get(targetUser.id) || { xp: 0, level: 0 };
            const userWarnings = moderation?.getUserWarnings(targetUser.id, interaction.guild.id) || { count: 0 };

            const userInfoContent =
                `**## <:user:1434651323579502672> User-Informationen**\n\n` +
                `**<:info:1434647594457497784> Grundinformationen**\n` +
                `• User: <@${targetUser.id}>\n` +
                `• Tag: **${targetUser.tag}**\n` +
                `• Bot: **${targetUser.bot ? 'Ja' : 'Nein'}**\n` +
                `• User-ID: \`${targetUser.id}\`\n\n` +
                `**<:clock:1434717138073030797> Daten**\n` +
                `• Account erstellt: **${createdDateStr}**\n` +
                `• Server beigetreten: **${joinDateStr}**\n\n` +
                `**<:settings:1434660812395384870> Level-System**\n` +
                `• Level: **${userLevelData.level}**\n` +
                `• XP: **${userLevelData.xp.toLocaleString('de-DE')}**\n\n` +
                `**<:info:1434647594457497784> Verwarnungen**\n` +
                `• Anzahl: **${userWarnings.count}**\n\n` +
                `**<:haken:1434664861664804875> Rollen (${member.roles.cache.size - 1})**\n` +
                `${roles || 'Keine Rollen'}`;

            const userInfoContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(userInfoContent))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [userInfoContainer],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Abrufen der User-Informationen:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Abrufen der User-Informationen!'
            });
        }
    }

    async function handleStaffCommand(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const guild = interaction.guild;
            const channel = interaction.channel;

            const staffContainer = await createStaffContainer(guild);

            const message = await channel.send({
                content: '',
                components: [staffContainer],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [], roles: [] }
            });

            // Diese Nachricht als "offizielle" Staff-Nachricht für die Gilde merken
            if (message && message.id) {
                staffMessages.set(guild.id, {
                    channelId: message.channelId,
                    messageId: message.id
                });
            }

            await interaction.editReply({
                content: '<:haken:1434664861664804875> Die Staff-Liste wurde aktualisiert.'
            });
        } catch (error) {
            console.error('Fehler beim Erstellen der Staff-Liste:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Erstellen der Staff-Liste!'
            });
        }
    }

    return {
        commandHandlers: {
            serverinfo: handleServerinfoCommand,
            userinfo: handleUserinfoCommand,
            staff: handleStaffCommand
        }
    };
}

module.exports = {
    createInfoFeature
};

