const {
    ActionRowBuilder,
    AuditLogEvent,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');

function registerLogging(client, env) {
    const logChannelId = env.LOG_CHANNEL_ID;
    const pendingRemovals = new Map();
    const recentBans = new Set();

    async function sendLog(title, description, emoji = '<:info:1434647594457497784>') {
        if (!logChannelId) return;
        try {
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return;

            const logContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**## ${emoji} ${title}**`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setDivider(true).setSpacing('Small')
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(description)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setDivider(true).setSpacing('Small')
                );

            await logChannel.send({
                content: '',
                components: [logContainer],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Senden des Logs:', error);
        }
    }

    client.on('messageDelete', async (message) => {
        if (!message.author || message.author.bot) return;

        let content = `**Nachricht von:** <@${message.author.id}> (${message.author.tag})\n`;
        content += `**Kanal:** <#${message.channel.id}>\n`;
        content += `**Nachricht:** ${message.content || '*Kein Text*'}\n`;
        if (message.attachments && message.attachments.size > 0) {
            content += `**Anhänge:** ${message.attachments.map((a) => a.name).join(', ')}\n`;
        }

        try {
            const now = Date.now();
            const logs = await message.guild
                ?.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MessageDelete })
                .catch(() => null);
            const entry = logs?.entries.find(
                (e) =>
                    e.target?.id === message.author.id &&
                    e.extra?.channel?.id === message.channel.id &&
                    e.createdTimestamp > now - 30000 &&
                    e.executor?.id !== message.author.id
            );
            if (entry?.executor) {
                content += `**Gelöscht von:** <@${entry.executor.id}> (${entry.executor.tag})\n`;
            } else {
                content += `**Gelöscht von:** Autor selbst\n`;
            }
        } catch (error) {
            console.error('Fehler beim Abrufen der Delete-Audit-Logs:', error);
            content += `**Gelöscht von:** Autor selbst\n`;
        }

        content += `**Zeit:** <t:${Math.floor(Date.now() / 1000)}:F>`;

        await sendLog('Nachricht Gelöscht', content, '<:delete:1434661904743137280>');
    });

    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (newMessage.author?.bot || !oldMessage.content || oldMessage.content === newMessage.content) return;

        let content = `**Bearbeitet von:** <@${newMessage.author.id}> (${newMessage.author.tag})\n`;
        content += `**Kanal:** <#${newMessage.channel.id}>\n`;
        content += `**Vorher:** ${oldMessage.content.substring(0, 500)}${
            oldMessage.content.length > 500 ? '...' : ''
        }\n`;
        content += `**Nachher:** ${newMessage.content.substring(0, 500)}${
            newMessage.content.length > 500 ? '...' : ''
        }\n`;
        content += `**Zeit:** <t:${Math.floor(Date.now() / 1000)}:F>`;

        await sendLog('Nachricht Bearbeitet', content, '<:settings:1434660812395384870>');
    });

    client.on('guildMemberAdd', async (member) => {
        const memberRoleId = env.MEMBER_ROLE_ID || '1431044987201785891';
        try {
            const memberRole = member.guild.roles.cache.get(memberRoleId);
            if (memberRole) {
                await member.roles.add(memberRole);
            } else {
                console.log(`⚠️ Member-Rolle mit ID ${memberRoleId} nicht gefunden!`);
            }
        } catch (error) {
            console.error('Fehler beim Hinzufügen der Member-Rolle:', error);
        }

        let content = `**Mitglied:** <@${member.id}> (${member.user.tag})\n`;
        content += `**Account erstellt:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n`;
        content += `**Mitglieder gesamt:** ${member.guild.memberCount}`;

        await sendLog('Mitglied Beigetreten', content, '<:user:1434651323579502672>');

        const welcomeChannelId = env.WELCOME_CHANNEL_ID;
        if (!welcomeChannelId) {
            console.log('⚠️ WELCOME_CHANNEL_ID nicht in .env gesetzt!');
            return;
        }

        const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
        if (!welcomeChannel) {
            console.log('⚠️ Willkommens-Kanal mit ID nicht gefunden!');
            return;
        }

        try {
            const welcomeImageUrl = env.WELCOME_IMAGE_URL || '';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**## Willkommen auf ${member.guild.name}! #**`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• <:wilkommen:1434647529257177229> **Willkommen**\n` +
                            `> <@${member.id}>,  bei **NorealTrolling**. Wir hoffen **du findest** das was **du brauchst!**\n\n` +
                            `• <:info:1434647594457497784> **Die Nächsten Schritte**\n` +
                            `> Bitte lies unsere **Regeln** und **Verifiziere dich** anschließend auf unserem Server für deinen perfekten Start!`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            if (welcomeImageUrl) {
                container
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems([
                            {
                                media: { url: welcomeImageUrl }
                            }
                        ])
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));
            }

            const buttons = [];
            const rulesChannelId = env.RULES_CHANNEL_ID || '1434643841025183856';
            const rulesUrl = `https://discord.com/channels/${member.guild.id}/${rulesChannelId}`;

            buttons.push(
                new ButtonBuilder()
                    .setLabel('Regeln')
                    .setStyle(ButtonStyle.Link)
                    .setURL(rulesUrl)
                    .setEmoji('<:rule:1434647656675672176>')
            );

            if (env.TICKET_URL) {
                buttons.push(
                    new ButtonBuilder()
                        .setLabel('Ticket')
                        .setStyle(ButtonStyle.Link)
                        .setURL(env.TICKET_URL)
                        .setEmoji('<:ticket:1434718078587109458>')
                );
            }

            if (buttons.length > 0) {
                container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
            }

            await welcomeChannel.send({
                content: '',
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Senden der Components V2 Nachricht:', error);

            const welcomeContent = `**Welcome to the Server!**\nWelcome <@${member.id}> to **${member.guild.name}**!\n\n> We're glad to have you here!`;

            const rulesChannelId = env.RULES_CHANNEL_ID || '1434643841025183856';
            const rulesUrl = `https://discord.com/channels/${member.guild.id}/${rulesChannelId}`;

            const rulesButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Regeln')
                    .setStyle(ButtonStyle.Link)
                    .setURL(rulesUrl)
                    .setEmoji('<:rule:1434647656675672176>')
            );

            await welcomeChannel.send({
                content: welcomeContent,
                components: [rulesButton]
            });
        }
    });

    client.on('guildMemberRemove', async (member) => {
        if (recentBans.has(member.id)) return;
        if (pendingRemovals.has(member.id)) return;

        const findKickLog = async () => {
            const now = Date.now();
            const me = member.guild.members.me;
            if (!me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
            const logs = await member.guild
                .fetchAuditLogs({ limit: 25, type: AuditLogEvent.MemberKick })
                .catch(() => null);
            if (!logs) return null;
            return logs.entries.find((e) => e.target?.id === member.id && e.createdTimestamp > now - 60000) || null;
        };

        const timeoutId = setTimeout(async () => {
            pendingRemovals.delete(member.id);
            let kickLog = await findKickLog();
            if (!kickLog) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                kickLog = await findKickLog();
            }
            if (!kickLog) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                kickLog = await findKickLog();
            }

            try {
                if (kickLog) {
                    let content = `**Mitglied:** ${member.user.tag} (${member.id})\n`;
                    content += `**Gekickt von:** <@${kickLog.executor.id}> (${kickLog.executor.tag})\n`;
                    if (kickLog.reason) content += `**Grund:** ${kickLog.reason}\n`;
                    content += `**Mitglieder gesamt:** ${member.guild.memberCount}`;
                    await sendLog('Mitglied Gekickt', content, '<:delete:1434661904743137280>');
                } else {
                    let content = `**Mitglied:** ${member.user.tag} (${member.id})\n`;
                    content += `**Mitglieder gesamt:** ${member.guild.memberCount}`;
                    await sendLog('Mitglied Verlassen', content, '<:close:1434661746643308675>');
                }
            } catch (error) {
                console.error('Fehler beim Abrufen/Senden der Kick-Logs:', error);
            }
        }, 6000);

        pendingRemovals.set(member.id, timeoutId);
    });

    client.on('guildBanAdd', async (ban) => {
        const pending = pendingRemovals.get(ban.user.id);
        if (pending) {
            clearTimeout(pending);
            pendingRemovals.delete(ban.user.id);
        }

        recentBans.add(ban.user.id);
        setTimeout(() => recentBans.delete(ban.user.id), 30000);

        const findBanLog = async () => {
            const now = Date.now();
            const me = ban.guild.members.me;
            if (!me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
            const logs = await ban.guild
                .fetchAuditLogs({ limit: 25, type: AuditLogEvent.MemberBanAdd })
                .catch(() => null);
            if (!logs) return null;
            return logs.entries.find((e) => e.target?.id === ban.user.id && e.createdTimestamp > now - 60000) || null;
        };

        await new Promise((resolve) => setTimeout(resolve, 2500));
        let banLog = await findBanLog();
        if (!banLog) {
            await new Promise((resolve) => setTimeout(resolve, 4000));
            banLog = await findBanLog();
        }
        if (!banLog) {
            await new Promise((resolve) => setTimeout(resolve, 4000));
            banLog = await findBanLog();
        }

        try {
            let content = `**Mitglied:** ${ban.user.tag} (${ban.user.id})\n`;
            if (banLog) {
                content += `**Gebannt von:** <@${banLog.executor.id}> (${banLog.executor.tag})\n`;
                if (!ban.reason && banLog.reason) content += `**Grund:** ${banLog.reason}`;
            }
            if (ban.reason) content += `**Grund:** ${ban.reason}`;
            await sendLog('Mitglied Gebannt', content, '<:delete:1434661904743137280>');
        } catch (error) {
            console.error('Fehler beim Abrufen/Senden der Ban-Logs:', error);
        }
    });

    client.on('guildBanRemove', async (ban) => {
        const me = ban.guild.members.me;
        const auditLogs = me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)
            ? await ban.guild.fetchAuditLogs({ limit: 25, type: AuditLogEvent.MemberBanRemove }).catch(() => null)
            : null;
        const now = Date.now();
        const unbanLog = auditLogs?.entries.find(
            (e) => e.target?.id === ban.user.id && e.createdTimestamp > now - 60000
        );

        let content = `**Mitglied:** <@${ban.user.id}> (${ban.user.tag})`;
        if (unbanLog) {
            content += `\n**Entbannt von:** <@${unbanLog.executor.id}> (${unbanLog.executor.tag})`;
        }

        await sendLog('Mitglied Entbannt', content, '<:haken:1434664861664804875>');
    });

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
            const auditLogs = await newMember.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberUpdate })
                .catch(() => null);
            const timeoutLog = auditLogs?.entries.first();

            let content = `**Mitglied:** <@${newMember.user.id}> (${newMember.user.tag})\n`;

            if (newMember.communicationDisabledUntil > Date.now()) {
                if (
                    timeoutLog &&
                    timeoutLog.target.id === newMember.user.id &&
                    timeoutLog.createdTimestamp > Date.now() - 5000
                ) {
                    content += `**Timeout von:** <@${timeoutLog.executor.id}> (${timeoutLog.executor.tag})\n`;
                }
                content += `**Timeout bis:** <t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`;
                await sendLog('Timeout Hinzugefügt', content, '<:settings:1434660812395384870>');
            } else if (oldMember.communicationDisabledUntil && !newMember.communicationDisabledUntil) {
                if (
                    timeoutLog &&
                    timeoutLog.target.id === newMember.user.id &&
                    timeoutLog.createdTimestamp > Date.now() - 5000
                ) {
                    content += `\n**Entfernt von:** <@${timeoutLog.executor.id}> (${timeoutLog.executor.tag})`;
                }
                await sendLog('Timeout Entfernt', content, '<:haken:1434664861664804875>');
            }
            return;
        }

        const oldRoles = new Set(oldMember.roles.cache.keys());
        const newRoles = new Set(newMember.roles.cache.keys());
        const addedRoles = [...newRoles].filter((id) => !oldRoles.has(id));
        const removedRoles = [...oldRoles].filter((id) => !newRoles.has(id));

        if (addedRoles.length === 0 && removedRoles.length === 0) return;

        const me = newMember.guild.members.me;
        let executorTag = null;
        if (me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) {
            const now = Date.now();
            const logs = await newMember.guild
                .fetchAuditLogs({ limit: 10, type: AuditLogEvent.MemberRoleUpdate })
                .catch(() => null);
            const entry = logs?.entries.find(
                (e) => e.target?.id === newMember.user.id && e.createdTimestamp > now - 60000
            );
            if (entry?.executor) executorTag = `<@${entry.executor.id}> (${entry.executor.tag})`;
        }

        let content = `**Mitglied:** <@${newMember.user.id}> (${newMember.user.tag})\n`;
        if (addedRoles.length > 0) {
            content += `**Hinzugefügt:** ${addedRoles.map((id) => `<@&${id}>`).join(', ')}\n`;
        }
        if (removedRoles.length > 0) {
            content += `**Entfernt:** ${removedRoles.map((id) => `<@&${id}>`).join(', ')}\n`;
        }
        if (executorTag) content += `**Geändert von:** ${executorTag}`;

        await sendLog('Rollen Geändert', content.trim(), '<:settings:1434660812395384870>');
    });

    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (newState.member?.user.bot || (!oldState.channel && !newState.channel)) return;

        if (!oldState.channel && newState.channel) {
            let content = `**Mitglied:** <@${newState.member.user.id}> (${newState.member.user.tag})\n`;
            content += `**Voice Channel:** ${newState.channel.name}`;

            await sendLog('Voice Channel Beigetreten', content, '<:haken:1434664861664804875>');
        } else if (oldState.channel && !newState.channel) {
            let content = `**Mitglied:** <@${newState.member.user.id}> (${newState.member.user.tag})\n`;
            content += `**Voice Channel:** ${oldState.channel.name}`;

            await sendLog('Voice Channel Verlassen', content, '<:close:1434661746643308675>');
        } else if (oldState.channel?.id !== newState.channel?.id && newState.channel) {
            let content = `**Mitglied:** <@${newState.member.user.id}> (${newState.member.user.tag})\n`;
            content += `**Von:** ${oldState.channel.name}\n`;
            content += `**Zu:** ${newState.channel.name}`;

            await sendLog('Voice Channel Gewechselt', content, '<:settings:1434660812395384870>');
        } else if (oldState.mute !== newState.mute || oldState.deaf !== newState.deaf) {
            let content = `**Mitglied:** <@${newState.member.user.id}> (${newState.member.user.tag})\n`;
            if (oldState.mute !== newState.mute) {
                content += `**Stumm:** ${newState.mute ? 'Ja' : 'Nein'}`;
            }
            if (oldState.deaf !== newState.deaf) {
                content += `${oldState.mute !== newState.mute ? '\n' : ''}**Taub:** ${newState.deaf ? 'Ja' : 'Nein'}`;
            }

            await sendLog('Voice Status Geändert', content, '<:settings:1434660812395384870>');
        }
    });

    client.on('channelCreate', async (channel) => {
        if (channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM) return;

        let content = `**Kanal:** <#${channel.id}>\n`;
        content += `**Typ:** ${
            channel.type === ChannelType.GuildText
                ? 'Text'
                : channel.type === ChannelType.GuildVoice
                ? 'Voice'
                : channel.type === ChannelType.GuildCategory
                ? 'Kategorie'
                : 'Andere'
        }\n`;
        if (channel.parent) content += `**Kategorie:** ${channel.parent.name}\n`;
        content += `**Server:** ${channel.guild.name}`;

        try {
            const logs = await channel.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate })
                .catch(() => null);
            const entry = logs?.entries.first();
            if (entry && entry.executor) content += `\n**Erstellt von:** <@${entry.executor.id}> (${entry.executor.tag})`;
        } catch (error) {
            console.error('Fehler beim Abrufen der ChannelCreate-Logs:', error);
        }

        await sendLog('Kanal Erstellt', content, '<:haken:1434664861664804875>');
    });

    client.on('channelDelete', async (channel) => {
        if (channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM) return;

        let content = `**Kanal:** ${channel.name}\n`;
        content += `**Typ:** ${
            channel.type === ChannelType.GuildText
                ? 'Text'
                : channel.type === ChannelType.GuildVoice
                ? 'Voice'
                : channel.type === ChannelType.GuildCategory
                ? 'Kategorie'
                : 'Andere'
        }\n`;
        if (channel.parent) content += `**Kategorie:** ${channel.parent.name}\n`;
        content += `**Server:** ${channel.guild.name}`;

        try {
            const logs = await channel.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete })
                .catch(() => null);
            const entry = logs?.entries.first();
            if (entry && entry.executor) content += `\n**Gelöscht von:** <@${entry.executor.id}> (${entry.executor.tag})`;
        } catch (error) {
            console.error('Fehler beim Abrufen der ChannelDelete-Logs:', error);
        }

        await sendLog('Kanal Gelöscht', content, '<:delete:1434661904743137280>');
    });

    client.on('channelUpdate', async (oldChannel, newChannel) => {
        if (newChannel.type === ChannelType.DM || newChannel.type === ChannelType.GroupDM) return;

        const changes = [];
        if (oldChannel.name !== newChannel.name) {
            changes.push(`**Name:** ${oldChannel.name} → ${newChannel.name}`);
        }
        if (oldChannel.topic !== newChannel.topic) {
            changes.push(`**Beschreibung:** Geändert`);
        }
        if (oldChannel.parent?.id !== newChannel.parent?.id) {
            changes.push(
                `**Kategorie:** ${oldChannel.parent?.name || 'Keine'} → ${newChannel.parent?.name || 'Keine'}`
            );
        }

        if (changes.length === 0) return;

        let content = `**Kanal:** <#${newChannel.id}>\n`;
        content += changes.join('\n');

        try {
            const logs = await newChannel.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelUpdate })
                .catch(() => null);
            const entry = logs?.entries.first();
            if (entry && entry.executor) content += `\n**Geändert von:** <@${entry.executor.id}> (${entry.executor.tag})`;
        } catch (error) {
            console.error('Fehler beim Abrufen der ChannelUpdate-Logs:', error);
        }

        await sendLog('Kanal Aktualisiert', content, '<:settings:1434660812395384870>');
    });

    client.on('roleCreate', async (role) => {
        let content = `**Rolle:** <@&${role.id}>\n`;
        content += `**Farbe:** ${role.hexColor}\n`;
        content += `**Server:** ${role.guild.name}`;

        try {
            const logs = await role.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate })
                .catch(() => null);
            const entry = logs?.entries.first();
            if (entry && entry.executor) content += `\n**Erstellt von:** <@${entry.executor.id}> (${entry.executor.tag})`;
        } catch (error) {
            console.error('Fehler beim Abrufen der RoleCreate-Logs:', error);
        }

        await sendLog('Rolle Erstellt', content, '<:haken:1434664861664804875>');
    });

    client.on('roleDelete', async (role) => {
        let content = `**Rolle:** ${role.name}\n`;
        content += `**Server:** ${role.guild.name}`;

        try {
            const logs = await role.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete })
                .catch(() => null);
            const entry = logs?.entries.first();
            if (entry && entry.executor) content += `\n**Gelöscht von:** <@${entry.executor.id}> (${entry.executor.tag})`;
        } catch (error) {
            console.error('Fehler beim Abrufen der RoleDelete-Logs:', error);
        }

        await sendLog('Rolle Gelöscht', content, '<:delete:1434661904743137280>');
    });

    client.on('roleUpdate', async (oldRole, newRole) => {
        const changes = [];
        if (oldRole.name !== newRole.name) {
            changes.push(`**Name:** ${oldRole.name} → ${newRole.name}`);
        }
        if (oldRole.color !== newRole.color) {
            changes.push(`**Farbe:** ${oldRole.hexColor} → ${newRole.hexColor}`);
        }
        if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
            changes.push(`**Berechtigungen:** Geändert`);
        }

        if (changes.length === 0) return;

        let content = `**Rolle:** <@&${newRole.id}>\n`;
        content += changes.join('\n');

        try {
            const logs = await newRole.guild
                .fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate })
                .catch(() => null);
            const entry = logs?.entries.first();
            if (entry && entry.executor) content += `\n**Geändert von:** <@${entry.executor.id}> (${entry.executor.tag})`;
        } catch (error) {
            console.error('Fehler beim Abrufen der RoleUpdate-Logs:', error);
        }

        await sendLog('Rolle Aktualisiert', content, '<:settings:1434660812395384870>');
    });

    return {
        sendLog,
        commandHandlers: {
        }
    };
}

module.exports = {
    registerLogging
};