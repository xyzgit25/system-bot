const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SeparatorBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    TextDisplayBuilder
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createTicketFeature({ client, sendLog, env }) {
    const { map: activeTickets, load: loadTicketMap, save: saveTicketMap } = createJsonBackedMap('tickets.json');
    const { map: ticketActivity, load: loadActivityMap, save: saveActivityMap } = createJsonBackedMap('ticket-activity.json');
    const { map: bewerbungData, load: loadBewerbungMap, save: saveBewerbungMap } = createJsonBackedMap('bewerbung-data.json');
    const bewerbungIntroMessages = new Map(); // channelId -> messageId für "Bewerbung ausfüllen"-Embed

    function parseIdList(value) {
        if (!value) return [];
        return value
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0);
    }

    const defaultStaffRoleIds = parseIdList(env.STAFF_ROLE_IDS);

    const ticketRoleMap = {
        support: parseIdList(env.SUPPORT_TICKET_ROLE_IDS),
        kaufen: parseIdList(env.KAUF_TICKET_ROLE_IDS),
        partnerschaft: parseIdList(env.PARTNER_TICKET_ROLE_IDS),
        teambewerbung: parseIdList(env.TEAM_BEWERBUNG_TICKET_ROLE_IDS),
        mediabewerbung: parseIdList(env.MEDIA_BEWERBUNG_TICKET_ROLE_IDS)
    };

    const staffRoleIdSet = new Set(
        Object.values(ticketRoleMap).reduce((all, roleIds) => all.concat(roleIds), [...defaultStaffRoleIds])
    );

    const hasExplicitTicketRoles = Object.values(ticketRoleMap).some((roles) => roles.length > 0);

    if (defaultStaffRoleIds.length === 0 && !hasExplicitTicketRoles) {
        console.warn('⚠️ Keine STAFF_ROLE_IDS oder ticket-spezifische *_TICKET_ROLE_IDS gesetzt. Tickets werden ohne Teamrollen erstellt.');
    }

    async function loadTickets() {
        await loadTicketMap();
        await loadActivityMap();
        await loadBewerbungMap();
        await scanTicketChannels();
        console.log(`✅ ${activeTickets.size} aktive Tickets geladen`);
    }

    async function saveTickets() {
        await saveTicketMap();
    }

    function getTicketTypeFromName(name = '') {
        if (name.startsWith('support-')) return 'support';
        if (name.startsWith('kauf-')) return 'kaufen';
        if (name.startsWith('partner-')) return 'partnerschaft';
        if (name.startsWith('bewerbung-')) return 'teambewerbung';
        if (name.startsWith('media-')) return 'mediabewerbung';
        return 'support';
    }

    function getTicketOwnerFromChannel(channel) {
        try {
            for (const [id, overwrite] of channel.permissionOverwrites.cache) {
                if (id === channel.guild.id || id === client.user.id) continue;
                if (channel.guild.roles.cache.has(id)) {
                    if (staffRoleIdSet.has(id)) continue;
                    continue;
                }
                if (overwrite?.allow?.has(PermissionFlagsBits.ViewChannel)) {
                    return id;
                }
            }
        } catch (error) {
            console.error('Fehler beim Ermitteln des Ticket-Inhabers:', error);
        }
        return null;
    }

    async function resolveLastActivityTimestamp(channel) {
        try {
            const recentMessages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
            if (recentMessages && recentMessages.size > 0) {
                return recentMessages.first().createdTimestamp;
            }
        } catch (error) {
            console.error('Fehler beim Ermitteln der letzten Aktivität:', error);
        }

        return (
            channel.lastMessage?.createdTimestamp ||
            channel.lastPinTimestamp ||
            channel.createdTimestamp ||
            Date.now()
        );
    }

    async function scanTicketChannels() {
        let recoveredCount = 0;
        const seenChannelIds = new Set();

        try {
            for (const guild of client.guilds.cache.values()) {
                const channels = await guild.channels.fetch();
                for (const channel of channels.values()) {
                    if (!channel || channel.type !== ChannelType.GuildText) continue;
                    if (!isTicketChannel(channel)) continue;

                    seenChannelIds.add(channel.id);

                    const ownerId = getTicketOwnerFromChannel(channel);
                    if (!ownerId) continue;

                    const ticketType = getTicketTypeFromName(channel.name.toLowerCase());
                    const ticketKey = `${ownerId}-${ticketType}`;
                    const existingChannelId = activeTickets.get(ticketKey);

                    if (existingChannelId !== channel.id) {
                        activeTickets.set(ticketKey, channel.id);
                        recoveredCount++;
                    }

                    if (!ticketActivity.has(channel.id)) {
                        const lastActivity = await resolveLastActivityTimestamp(channel);
                        ticketActivity.set(channel.id, {
                            lastActivity,
                            lastWarning: null
                        });
                    }
                }
            }

            for (const [key, channelId] of activeTickets.entries()) {
                if (!seenChannelIds.has(channelId)) {
                    activeTickets.delete(key);
                }
            }

            await saveTicketMap();
            await saveActivityMap();
            console.log(`♻️ Ticket-Recovery abgeschlossen. Synchronisierte Tickets: ${recoveredCount}`);
        } catch (error) {
            console.error('Fehler beim Scannen der Ticket-Kanäle:', error);
        }
    }

    async function pruneTickets() {
        for (const [key, channelId] of activeTickets.entries()) {
            try {
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    activeTickets.delete(key);
                    console.log(`🗑️ Nicht existierendes Ticket entfernt: ${key}`);
                }
            } catch (error) {
                activeTickets.delete(key);
            }
        }
        await saveTickets();
    }

    async function handleSetupCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const ticketChannelId = env.TICKET_CHANNEL_ID;
        if (!ticketChannelId) {
            return interaction.reply({
                content: '<:close:1434661746643308675> TICKET_CHANNEL_ID ist in der .env-Datei nicht gesetzt!',
                flags: MessageFlags.Ephemeral
            });
        }

        const ticketChannel = interaction.guild.channels.cache.get(ticketChannelId);
        if (!ticketChannel) {
            return interaction.reply({
                content: `<:close:1434661746643308675> Ticket-Kanal mit der ID ${ticketChannelId} nicht gefunden!`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const ticketBannerUrl = env.TICKET_BANNER_IMAGE_URL || '';

            const selectMenuRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_select')
                    .setPlaceholder('Wie können wir dir helfen?')
                    .addOptions([
                        {
                            label: 'Support',
                            description: 'Unser Team kann dir helfen!',
                            value: 'support',
                            emoji: '<:support:1440357360961847389>'
                        },
                        {
                            label: 'Kaufen',
                            description: 'Du möchtest etwas bei uns kaufen?',
                            value: 'kaufen',
                            emoji: '<:kaufen:1440357492277121244>'
                        },
                        {
                            label: 'Partnerschaft',
                            description: 'Werde unser Partner!',
                            value: 'partnerschaft',
                            emoji: '<:partnerschaften:1434662993790111864>'
                        },
                        {
                            label: 'Teambewerbung',
                            description: 'Bewerbe dich für unser Team!',
                            value: 'teambewerbung',
                            emoji: '<:teambewerbung:1434895870498836561>'
                        },
                        {
                            label: 'Media Bewerbung',
                            description: 'Bewerbung als Media/Content Creator',
                            value: 'mediabewerbung',
                            emoji: '<:clock:1434717138073030797>'
                        }
                    ])
            );

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**## ${interaction.guild.name} Ticketsystem**`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• <:info:1434647594457497784> **Information**\n` +
                            `> Hier kannst du ein **Ticket** für Support oder eine **Bestellung** erstellen. Außerdem kannst du hier deinen **Gewinn** aus Giveaways abholen.\n\n` +
                            `• <:settings:1434660812395384870> **Anliegen direkt angeben**\n` +
                            `> Bitte gib dein **Anliegen direkt** in das Ticket ein, um **unnötige Wartezeiten** zu vermeiden und **noch schneller** Hilfe zu erhalten.`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            if (ticketBannerUrl) {
                container
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems([
                            {
                                media: { url: ticketBannerUrl }
                            }
                        ])
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));
            }

            container.addActionRowComponents(selectMenuRow);

            await ticketChannel.send({
                content: '',
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            await sendLog(
                'Ticketsystem Erstellt',
                `**Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${ticketChannelId}>`,
                '<:ticket:1434718078587109458>'
            );

            await interaction.reply({
                content: `<:haken:1434664861664804875> Das Ticketsystem wurde erfolgreich in <#${ticketChannelId}> gesendet!`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Senden des Components V2 Ticket-Systems:', error);
            await interaction.reply({
                content: `<:close:1434661746643308675> Fehler beim Senden des Ticketsystems in <#${ticketChannelId}>!`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleTicketSelect(interaction) {
        const selectedValue = interaction.values[0];
        const userId = interaction.user.id;

        const ticketTypes = {
            support: { name: 'Support', emoji: '⚙️', description: 'Unser Team kann dir helfen!' },
            kaufen: { name: 'Kauf', emoji: '🛒', description: 'Starte eine Bestellung oder Kaufanfrage.' },
            partnerschaft: { name: 'Partnerschaft', emoji: '🌐', description: 'Werde unser Partner!' },
            teambewerbung: {
                name: 'Teambewerbung',
                emoji: '<:teambewerbung:1434895870498836561>',
                description: 'Bewerbe dich für unser Team!'
            },
            mediabewerbung: {
                name: 'Media Bewerbung',
                emoji: '<:clock:1434717138073030797>',
                description: 'Bewerbung als Media/Content Creator.'
            }
        };

        const ticketKey = `${userId}-${selectedValue}`;
        if (activeTickets.has(ticketKey)) {
            const existingTicket = activeTickets.get(ticketKey);
            const channel = interaction.guild.channels.cache.get(existingTicket);
            if (channel) {
                return interaction.reply({
                    content: `<:close:1434661746643308675> Du hast bereits ein aktives ${
                        ticketTypes[selectedValue]?.name || 'Ticket'
                    } Ticket: <#${existingTicket}>`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        await interaction.reply({
            content: '<:settings:1434660812395384870> Ticket wird erstellt, bitte warte einen Moment...',
            flags: MessageFlags.Ephemeral
        });

        const ticketType = ticketTypes[selectedValue] || ticketTypes.support;
        const staffRoleIds =
            ticketRoleMap[selectedValue] && ticketRoleMap[selectedValue].length > 0
                ? ticketRoleMap[selectedValue]
                : defaultStaffRoleIds;
        const uniqueStaffRoleIds = [...new Set(staffRoleIds)].filter(Boolean);

        let channelPrefix = 'ticket-';
        let categoryId = null;

        if (selectedValue === 'support') {
            channelPrefix = 'support-';
            categoryId = env.SUPPORT_CATEGORY_ID || null;
        } else if (selectedValue === 'kaufen') {
            channelPrefix = 'kauf-';
            categoryId = env.KAUF_CATEGORY_ID || null;
        } else if (selectedValue === 'partnerschaft') {
            channelPrefix = 'partner-';
            categoryId = env.PARTNER_CATEGORY_ID || null;
        } else if (selectedValue === 'teambewerbung') {
            channelPrefix = 'bewerbung-';
            categoryId = env.TEAM_BEWERBUNG_CATEGORY_ID || null;
        } else if (selectedValue === 'mediabewerbung') {
            channelPrefix = 'media-';
            categoryId = env.MEDIA_BEWERBUNG_CATEGORY_ID || env.TEAM_BEWERBUNG_CATEGORY_ID || null;
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: `${channelPrefix}${interaction.user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            parent: categoryId || undefined,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                ...uniqueStaffRoleIds.map((roleId) => ({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                })),
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id: client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ]
        });

        if (categoryId) {
            try {
                const category = interaction.guild.channels.cache.get(categoryId) || (await interaction.guild.channels.fetch(categoryId).catch(() => null));
                if (category) {
                    if (ticketChannel.parentId !== category.id) {
                        await ticketChannel.setParent(category.id).catch((error) => {
                            console.error('Fehler beim Setzen der Ticket-Kategorie:', error);
                        });
                    }
                } else {
                    console.warn(`⚠️ Kategorie mit ID ${categoryId} nicht gefunden. Ticket verbleibt außerhalb einer Kategorie.`);
                }
            } catch (error) {
                console.error('Fehler beim Setzen der Ticket-Kategorie:', error);
            }
        }

        activeTickets.set(ticketKey, ticketChannel.id);
        ticketActivity.set(ticketChannel.id, {
            lastActivity: Date.now(),
            lastWarning: null
        });
        await saveTickets();
        await saveActivityMap();

        await sendLog(
            'Ticket Erstellt',
            `**Erstellt von:** <@${userId}> (${interaction.user.tag})\n**Typ:** ${ticketType.name}\n**Kanal:** <#${ticketChannel.id}>`,
            '<:ticket:1434718078587109458>'
        );

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Schließen')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:close:1434661746643308675>'),
            new ButtonBuilder()
                .setCustomId('delete_ticket')
                .setLabel('Löschen')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:delete:1434661904743137280>')
        );

        const ticketContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## **${interaction.guild.name} Ticket Geöffnet**`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<@${userId}>\n\n` +
                        `**Wichtig**\n` +
                        `> Ein Teammitglied kümmert sich bald um dein Anliegen. Teile uns bitte schon jetzt kurz mit, worum es geht, damit wir dir schneller helfen können. Danke für deine Geduld!`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addActionRowComponents(buttons);

        try {
            await ticketChannel.send({
                content: '',
                components: [ticketContainer],
                flags: MessageFlags.IsComponentsV2
            });

            // Spezielles Bewerbungs-Formular für Team-Bewerbungen
            if (selectedValue === 'teambewerbung') {
                const bewerbungContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## Teambewerbung**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            'Für deine **Teambewerbung** – klicke auf den Button, um das Formular zu öffnen.\n\n' +
                                '> Fülle alle Felder sorgfältig aus, damit wir dich besser einschätzen können.'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('open_bewerbung_modal')
                                .setLabel('Bewerbung ausfüllen')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('<:teambewerbung:1434895870498836561>')
                        )
                    );

                const introMessage = await ticketChannel.send({
                    content: '',
                    components: [bewerbungContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                // speichere Intro-Message-ID, damit sie nach dem Ausfüllen gelöscht werden kann
                bewerbungIntroMessages.set(ticketChannel.id, introMessage.id);
            }

            // Hinweis für Media-Bewerbungen
            if (selectedValue === 'mediabewerbung') {
                const mediaContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## Media Bewerbung**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '<:clock:1434717138073030797> **Media Bewerbung**\n\n' +
                                '> Sende hier deine Socials (YouTube, TikTok, Twitch, etc.), Statistiken und eine kurze Vorstellung,' +
                                ' damit wir deine Media-Bewerbung prüfen können.'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await ticketChannel.send({
                    content: '',
                    components: [mediaContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } catch (error) {
            console.error('Fehler beim Senden des Ticket-Containers:', error);
        }

        await interaction.editReply({
            content: `<:haken:1434664861664804875> Dein Ticket wurde erfolgreich erstellt: <#${ticketChannel.id}>`
        });
    }

    async function handleCloseTicket(interaction) {
        const channel = interaction.channel;

        if (
            !channel.name.startsWith('ticket-') &&
            !channel.name.startsWith('support-') &&
            !channel.name.startsWith('partner-') &&
            !channel.name.startsWith('kauf-') &&
            !channel.name.startsWith('bewerbung-') &&
            !channel.name.startsWith('media-')
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        let ticketKey = Array.from(activeTickets.entries()).find(([key, cid]) => cid === channel.id)?.[0];
        let userId = ticketKey ? ticketKey.split('-')[0] : null;

        if (!userId) {
            try {
                for (const [id, overwrite] of channel.permissionOverwrites.cache) {
                    if (id !== channel.guild.id && id !== client.user.id) {
                        if (overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
                            userId = id;
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error('Fehler beim Abrufen der PermissionOverwrites:', error);
            }
        }

        if (userId) {
            try {
                const transcriptChannelId = env.TRANSCRIPT_CHANNEL_ID;
                if (transcriptChannelId) {
                    const transcriptChannel = interaction.guild.channels.cache.get(transcriptChannelId);
                    if (transcriptChannel) {
                        const attachment = await discordTranscripts.createTranscript(channel, {
                            limit: -1,
                            returnType: 'attachment',
                            minify: false,
                            saveImages: true,
                            poweredBy: false
                        });

                        const transcriptContainer = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`**## Ticket-Transcript**`)
                            )
                            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    `• <:info:1434647594457497784> **Kanal:** ${channel.name}\n` +
                                        `• <:user:1434651323579502672> **Geschlossen von:** ${interaction.user.tag}\n` +
                                        `• <:announce:1434651478114435113> **Geschlossen am:** ${new Date().toLocaleString('de-DE')}`
                                )
                            )
                            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                        await transcriptChannel.send({
                            content: '',
                            components: [transcriptContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        await transcriptChannel.send({
                            files: [attachment]
                        });
                    }
                }
            } catch (error) {
                console.error('Fehler beim Senden des Transcripts:', error);
            }

            await channel.permissionOverwrites.edit(userId, {
                ViewChannel: false,
                SendMessages: false
            });

            const closedContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**## Ticket Geschlossen**`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `Dieses Ticket wurde von <@${interaction.user.id}> geschlossen.\n\n` +
                            `**Hinweis**\n` +
                            `> Das Ticket kann mit dem Löschen-Button gelöscht werden.`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await channel.send({
                content: '',
                components: [closedContainer],
                flags: MessageFlags.IsComponentsV2
            });

            await sendLog(
                'Ticket Geschlossen',
                `**Geschlossen von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${channel.id}>`,
                '<:close:1434661746643308675>'
            );

            await interaction.reply({
                content: '<:haken:1434664861664804875> Das Ticket wurde erfolgreich geschlossen.',
                flags: MessageFlags.Ephemeral
            });

            if (ticketKey) {
                activeTickets.delete(ticketKey);
                ticketActivity.delete(channel.id);
                bewerbungData.delete(channel.id);
                await saveTickets();
                await saveActivityMap();
                await saveBewerbungMap();
            }
        }
    }

    async function handleDeleteTicket(interaction) {
        const channel = interaction.channel;

        if (
            !channel.name.startsWith('ticket-') &&
            !channel.name.startsWith('support-') &&
            !channel.name.startsWith('partner-') &&
            !channel.name.startsWith('kauf-') &&
            !channel.name.startsWith('bewerbung-') &&
            !channel.name.startsWith('media-')
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const ticketKey = Array.from(activeTickets.entries()).find(([key, cid]) => cid === channel.id)?.[0];
        if (ticketKey) {
            activeTickets.delete(ticketKey);
            ticketActivity.delete(channel.id);
            bewerbungData.delete(channel.id);
            await saveTickets();
            await saveActivityMap();
            await saveBewerbungMap();
        }

        await sendLog(
            'Ticket Gelöscht',
            `**Gelöscht von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** ${channel.name}`,
            '<:delete:1434661904743137280>'
        );

        const replyPayload = {
            content: '<:delete:1434661904743137280> Ticket wird gelöscht...'
        };

        // Verhindere "Interaction already acknowledged" Fehler
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(replyPayload).catch(() => {});
        } else {
            await interaction.reply(replyPayload).catch(() => {});
        }

        setTimeout(async () => {
            try {
                await channel.delete();
            } catch (error) {
                console.error('Fehler beim Löschen des Kanals:', error);
            }
        }, 2000);
    }

    async function handleTranscriptTicket(interaction) {
        const channel = interaction.channel;

        if (
            !channel.name.startsWith('ticket-') &&
            !channel.name.startsWith('support-') &&
            !channel.name.startsWith('partner-') &&
            !channel.name.startsWith('kauf-') &&
            !channel.name.startsWith('bewerbung-') &&
            !channel.name.startsWith('media-')
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const attachment = await discordTranscripts.createTranscript(channel, {
                limit: -1,
                returnType: 'attachment',
                minify: false,
                saveImages: true,
                poweredBy: false
            });

            const transcriptContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**## Ticket-Transcript**`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• <:info:1434647594457497784> **Transcript für:** ${channel.name}\n` +
                            `• <:user:1434651323579502672> **Erstellt von:** ${interaction.user.tag}`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [transcriptContainer],
                flags: MessageFlags.IsComponentsV2
            });

            await interaction.followUp({
                files: [attachment],
                flags: MessageFlags.Ephemeral
            });

            await channel.send({
                content: '',
                components: [transcriptContainer],
                flags: MessageFlags.IsComponentsV2
            });

            await channel.send({
                files: [attachment]
            });
        } catch (error) {
            console.error('Fehler beim Erstellen des Transcripts:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Erstellen des Transcripts!'
            });
        }
    }

    async function handleTicketRename(interaction) {
        const channel = interaction.channel;

        if (!isTicketChannel(channel)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        const rawName = interaction.options.getString('name');

        if (!rawName || !rawName.trim()) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Bitte gib einen gültigen neuen Namen an!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Prefix (z.B. "support-", "kauf-", ...) aus dem aktuellen Kanalnamen beibehalten
        const currentName = channel.name.toLowerCase();
        const dashIndex = currentName.indexOf('-');
        const prefix = dashIndex !== -1 ? currentName.slice(0, dashIndex + 1) : '';

        let sanitized = rawName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!sanitized) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Der neue Name ist nach der Bereinigung leer. Bitte wähle einen anderen Namen!',
                flags: MessageFlags.Ephemeral
            });
        }

        let finalName = `${prefix}${sanitized}`;

        // Discord Kanalnamen-Limit (max. 100 Zeichen) respektieren
        if (finalName.length > 100) {
            finalName = finalName.slice(0, 100);
        }

        try {
            await channel.setName(finalName);

            await sendLog(
                'Ticket Umbenannt',
                `**Umbenannt von:** <@${interaction.user.id}> (${interaction.user.tag})\n` +
                    `**Kanal:** <#${channel.id}>\n` +
                    `**Neuer Name:** \`${finalName}\``,
                '<:settings:1434660812395384870>'
            );

            await interaction.reply({
                content: `<:haken:1434664861664804875> Das Ticket wurde erfolgreich in **${finalName}** umbenannt.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Umbenennen des Tickets:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Umbenennen des Tickets!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleTicketAdd(interaction) {
        const channel = interaction.channel;

        if (
            !channel.name.startsWith('ticket-') &&
            !channel.name.startsWith('support-') &&
            !channel.name.startsWith('partner-') &&
            !channel.name.startsWith('kauf-') &&
            !channel.name.startsWith('bewerbung-') &&
            !channel.name.startsWith('media-')
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = interaction.options.getUser('user');
        if (!targetUser) {
            return interaction.reply({
                content: '<:close:1434661746643308675> User nicht gefunden!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await channel.permissionOverwrites.edit(targetUser.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });

            await sendLog(
                'Ticket User Hinzugefügt',
                `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Hinzugefügt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${channel.id}>`,
                '<:haken:1434664861664804875>'
            );

            await interaction.reply({
                content: `<:haken:1434664861664804875> <@${targetUser.id}> wurde erfolgreich zum Ticket hinzugefügt!`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Hinzufügen des Users zum Ticket:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Hinzufügen des Users!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleTicketRemove(interaction) {
        const channel = interaction.channel;

        if (
            !channel.name.startsWith('ticket-') &&
            !channel.name.startsWith('support-') &&
            !channel.name.startsWith('partner-') &&
            !channel.name.startsWith('kauf-') &&
            !channel.name.startsWith('bewerbung-')
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Ticket-Kanälen verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = interaction.options.getUser('user');
        if (!targetUser) {
            return interaction.reply({
                content: '<:close:1434661746643308675> User nicht gefunden!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await channel.permissionOverwrites.edit(targetUser.id, {
                ViewChannel: false,
                SendMessages: false,
                ReadMessageHistory: false
            });

            await sendLog(
                'Ticket User Entfernt',
                `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Entfernt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${channel.id}>`,
                '<:delete:1434661904743137280>'
            );

            await interaction.reply({
                content: `<:haken:1434664861664804875> <@${targetUser.id}> wurde aus dem Ticket entfernt!`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Entfernen des Users aus dem Ticket:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Entfernen des Users!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function showBewerbungModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('bewerbung_modal')
            .setTitle('Teambewerbung');

        const nameInput = new TextInputBuilder()
            .setCustomId('bewerbung_name')
            .setLabel('Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Dein Name')
            .setRequired(true)
            .setMaxLength(100);

        const alterInput = new TextInputBuilder()
            .setCustomId('bewerbung_alter')
            .setLabel('Alter')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Dein Alter')
            .setRequired(true)
            .setMaxLength(3);

        const warumInput = new TextInputBuilder()
            .setCustomId('bewerbung_warum')
            .setLabel('Warum möchtest du beitreten?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Erkläre warum du dem Team beitreten möchtest...')
            .setRequired(true)
            .setMaxLength(1000);

        const cheatsInput = new TextInputBuilder()
            .setCustomId('bewerbung_cheats')
            .setLabel('Welche Cheats & Wo geholt?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Welche Cheats verwendest du? Wo hast du sie geholt? (Bitte beide Fragen beantworten)')
            .setRequired(true)
            .setMaxLength(1000);

        const helfenInput = new TextInputBuilder()
            .setCustomId('bewerbung_helfen')
            .setLabel('Wo möchtest du helfen?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Beschreibe in welchen Bereichen du helfen möchtest...')
            .setRequired(true)
            .setMaxLength(500);

        const firstRow = new ActionRowBuilder().addComponents(nameInput);
        const secondRow = new ActionRowBuilder().addComponents(alterInput);
        const thirdRow = new ActionRowBuilder().addComponents(warumInput);
        const fourthRow = new ActionRowBuilder().addComponents(cheatsInput);
        const fifthRow = new ActionRowBuilder().addComponents(helfenInput);

        modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);

        await interaction.showModal(modal);
    }

    async function handleBewerbungCommand(interaction) {
        const channel = interaction.channel;

        if (!channel.name.startsWith('bewerbung-')) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Bewerbungs-Tickets verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        await showBewerbungModal(interaction);
    }

    async function handleOpenBewerbungModal(interaction) {
        const channel = interaction.channel;

        if (!channel.name.startsWith('bewerbung-')) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Button kann nur in Bewerbungs-Tickets verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        await showBewerbungModal(interaction);
    }

    async function handleBewerbungModalSubmit(interaction) {
        // Lösche das ursprüngliche "Bewerbung ausfüllen"-Embed mit Button, falls vorhanden
        try {
            const introId = bewerbungIntroMessages.get(interaction.channel.id);
            if (introId) {
                const introMsg = await interaction.channel.messages.fetch(introId).catch(() => null);
                if (introMsg) {
                    await introMsg.delete().catch(() => {});
                }
                bewerbungIntroMessages.delete(interaction.channel.id);
            }
        } catch (error) {
            console.error('Fehler beim Löschen des Bewerbungs-Intros:', error);
        }

        const name = interaction.fields.getTextInputValue('bewerbung_name');
        const alter = interaction.fields.getTextInputValue('bewerbung_alter');
        const warum = interaction.fields.getTextInputValue('bewerbung_warum');
        const cheats = interaction.fields.getTextInputValue('bewerbung_cheats');
        const helfen = interaction.fields.getTextInputValue('bewerbung_helfen');

        const bewerbungContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## Teambewerbung**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:user:1434651323579502672> **Bewerber:** <@${interaction.user.id}> (${interaction.user.tag})\n` +
                    `• <:clock:1434717138073030797> **Bewerbungsdatum:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
                    `• <:info:1434647594457497784> **Status:** <:settings:1434660812395384870> Ausstehend\n\n` +
                        `**<:info:1434647594457497784> Bewerbungsdetails:**\n` +
                        `• **Name:** ${name}\n` +
                        `• **Alter:** ${alter}\n` +
                        `• **Warum:** ${warum}\n` +
                        `• **Welche Cheats & Wo geholt:** ${cheats}\n` +
                        `• **Wo helfen:** ${helfen}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('bewerbung_akzeptieren')
                .setLabel('Akzeptieren')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:haken:1434664861664804875>'),
            new ButtonBuilder()
                .setCustomId('bewerbung_ablehnen')
                .setLabel('Ablehnen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:delete:1434661904743137280>'),
            new ButtonBuilder()
                .setCustomId('bewerbung_gespraech')
                .setLabel('Gesprächstermin')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:settings:1434660812395384870>')
        );

        bewerbungContainer.addActionRowComponents(buttons);

        const replyMessage = await interaction.reply({
            content: '',
            components: [bewerbungContainer],
            flags: MessageFlags.IsComponentsV2,
            fetchReply: true
        });

        // Speichere Bewerbungsdaten für spätere Verwendung
        bewerbungData.set(interaction.channel.id, {
            name,
            alter,
            warum,
            cheats,
            helfen,
            bewerberId: interaction.user.id,
            bewerberTag: interaction.user.tag,
            bewerbungsdatum: Math.floor(Date.now() / 1000),
            messageId: replyMessage.id
        });
        await saveBewerbungMap();

        await sendLog(
            'Bewerbung Eingereicht',
            `**Bewerber:** <@${interaction.user.id}> (${interaction.user.tag})\n**Name:** ${name}\n**Alter:** ${alter}\n**Kanal:** <#${interaction.channel.id}>`,
            '<:ticket:1434718078587109458>'
        );
    }

    async function handleBewerbungAccept(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const guild = interaction.guild;
        const roles = guild.roles.cache
            .filter((role) => role.id !== guild.id && !role.managed && role.editable)
            .sort((a, b) => b.position - a.position)
            .first(25);

        if (roles.size === 0) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Keine verfügbaren Rollen gefunden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const roleOptions = roles.map((role) => ({
            label: role.name.length > 100 ? role.name.substring(0, 97) + '...' : role.name,
            value: role.id,
            description: `Rolle: ${role.name}`
        }));

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('bewerbung_rolle_auswahl')
                .setPlaceholder('Wähle die Rollen für den Bewerber aus...')
                .setMinValues(1)
                .setMaxValues(Math.min(roleOptions.length, 5))
                .addOptions(roleOptions)
        );

        await interaction.reply({
            content: '<:info:1434647594457497784> **Rollenauswahl**\n> Wähle die Rollen aus, die der Bewerber erhalten soll:',
            components: [selectMenu],
            flags: MessageFlags.Ephemeral
        });
    }

    async function handleBewerbungRoleSelect(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const selectedRoleIds = interaction.values;
        const roles = selectedRoleIds.map((id) => interaction.guild.roles.cache.get(id)).filter((r) => r);

        if (roles.length === 0) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Keine gültigen Rollen gefunden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const channelName = interaction.channel.name;
        if (!channelName.startsWith('bewerbung-')) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieser Befehl kann nur in Bewerbungs-Tickets verwendet werden!',
                flags: MessageFlags.Ephemeral
            });
        }

        let member = null;

        // Methode 1: Versuche User-ID aus activeTickets zu bekommen (am zuverlässigsten)
        const ticketKey = Array.from(activeTickets.entries()).find(([key, cid]) => cid === interaction.channel.id)?.[0];
        if (ticketKey) {
            // Ticket-Key Format: "userId-teambewerbung"
            const parts = ticketKey.split('-');
            if (parts.length >= 1) {
                const applicantUserId = parts[0];
                try {
                    member = await interaction.guild.members.fetch(applicantUserId);
                } catch (error) {
                    console.error('Fehler beim Abrufen des Mitglieds über Ticket-Key:', error);
                }
            }
        }

        // Methode 2: Suche nach der ursprünglichen Bewerbungsnachricht und extrahiere User-ID
        let bewerbungMessage = null;
        if (!member) {
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                // Suche nach Nachricht mit Bewerbungs-Buttons
                bewerbungMessage = messages.find((msg) => {
                    if (msg.components && msg.components.length > 0) {
                        return msg.components.some((row) =>
                            row.components.some((comp) => comp.customId === 'bewerbung_akzeptieren')
                        );
                    }
                    return false;
                });

                if (bewerbungMessage && bewerbungMessage.interaction && bewerbungMessage.interaction.user) {
                    // Die ursprüngliche Interaction enthält den User, der die Bewerbung eingereicht hat
                    const applicantUserId = bewerbungMessage.interaction.user.id;
                    try {
                        member = await interaction.guild.members.fetch(applicantUserId);
                    } catch (error) {
                        console.error('Fehler beim Abrufen des Mitglieds über Interaction:', error);
                    }
                }

                // Alternative: Versuche User-ID aus Message-Embeds oder Content zu extrahieren
                if (!member && bewerbungMessage) {
                    // Prüfe Message-Content (falls vorhanden)
                    if (bewerbungMessage.content) {
                        const userIdMatch = bewerbungMessage.content.match(/<@(\d+)>/);
                        if (userIdMatch) {
                            try {
                                member = await interaction.guild.members.fetch(userIdMatch[1]);
                            } catch (error) {
                                console.error('Fehler beim Abrufen des Mitglieds:', error);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Fehler beim Durchsuchen der Nachrichten:', error);
            }
        } else {
            // Wenn member bereits gefunden wurde, suche trotzdem nach der Bewerbungsnachricht
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                bewerbungMessage = messages.find((msg) => {
                    if (msg.components && msg.components.length > 0) {
                        return msg.components.some((row) =>
                            row.components.some((comp) => comp.customId === 'bewerbung_akzeptieren')
                        );
                    }
                    return false;
                });
            } catch (error) {
                console.error('Fehler beim Durchsuchen der Nachrichten:', error);
            }
        }

        // Methode 3: Versuche User-ID aus Kanal-Permissions zu extrahieren
        if (!member) {
            try {
                for (const [id, overwrite] of interaction.channel.permissionOverwrites.cache) {
                    if (id !== interaction.guild.id && id !== client.user.id) {
                        if (overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
                            try {
                                member = await interaction.guild.members.fetch(id);
                                if (member) break;
                            } catch (error) {
                                // Ignoriere Fehler und versuche nächste Permission
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Fehler beim Abrufen der PermissionOverwrites:', error);
            }
        }

        // Methode 4: Fallback auf Username-Matching (wie vorher)
        if (!member) {
            const username = channelName.replace('bewerbung-', '');
            member = interaction.guild.members.cache.find((m) => m.user.username.toLowerCase() === username.toLowerCase());

            if (!member) {
                const fetchedMembers = await interaction.guild.members.fetch().catch(() => null);
                if (fetchedMembers) {
                    member = fetchedMembers.find((m) => m.user.username.toLowerCase() === username.toLowerCase());
                }
            }
        }

        if (!member) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Bewerber nicht gefunden!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await member.roles.add(roles);
            const roleMentions = roles.map((r) => `<@&${r.id}>`).join(', ');

            await sendLog(
                'Bewerbung Akzeptiert',
                `**Bewerber:** <@${member.user.id}> (${member.user.tag})\n**Rollen:** ${roleMentions}\n**Akzeptiert von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${interaction.channel.id}>`,
                '<:haken:1434664861664804875>'
            );

            await interaction.reply({
                content: `<:haken:1434664861664804875> Bewerbung akzeptiert! <@${member.user.id}> hat die Rollen ${roleMentions} erhalten.`,
                flags: MessageFlags.Ephemeral
            });

            // Hole gespeicherte Bewerbungsdaten
            const savedData = bewerbungData.get(interaction.channel.id);
            let originalContent = '';

            if (savedData) {
                originalContent = `• <:user:1434651323579502672> **Bewerber:** <@${savedData.bewerberId}> (${savedData.bewerberTag})\n` +
                    `• <:clock:1434717138073030797> **Bewerbungsdatum:** <t:${savedData.bewerbungsdatum}:F>\n` +
                    `• <:info:1434647594457497784> **Status:** <:haken:1434664861664804875> Akzeptiert\n\n` +
                    `**<:info:1434647594457497784> Bewerbungsdetails:**\n` +
                    `• **Name:** ${savedData.name}\n` +
                    `• **Alter:** ${savedData.alter}\n` +
                    `• **Warum:** ${savedData.warum}\n` +
                    `• **Welche Cheats & Wo geholt:** ${savedData.cheats}\n` +
                    `• **Wo helfen:** ${savedData.helfen}`;
            } else {
                // Fallback falls keine Daten gespeichert wurden
                originalContent = `• <:user:1434651323579502672> **Bewerber:** <@${member.user.id}> (${member.user.tag})\n` +
                    `• <:clock:1434717138073030797> **Bewerbungsdatum:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
                    `• <:info:1434647594457497784> **Status:** <:haken:1434664861664804875> Akzeptiert\n\n` +
                    `**<:info:1434647594457497784> Bewerbungsdetails:**\n` +
                    `• **Bewerbung wurde akzeptiert**`;
            }

            const updatedContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## Teambewerbung - Akzeptiert**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        originalContent + `\n\n` +
                            `<:haken:1434664861664804875> **Rollen vergeben:** ${roleMentions}\n` +
                            `• **Akzeptiert von:** <@${interaction.user.id}>`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            // Versuche zuerst die gespeicherte Message-ID zu verwenden, sonst suche nach der Nachricht
            let messageToUpdate = null;
            if (savedData && savedData.messageId) {
                try {
                    messageToUpdate = await interaction.channel.messages.fetch(savedData.messageId).catch(() => null);
                } catch (error) {
                    console.error('Fehler beim Abrufen der gespeicherten Nachricht:', error);
                }
            }

            // Falls gespeicherte Message nicht gefunden wurde, suche nach der Nachricht mit Buttons
            if (!messageToUpdate && bewerbungMessage) {
                messageToUpdate = bewerbungMessage;
            }

            // Aktualisiere die ursprüngliche Nachricht, falls gefunden
            if (messageToUpdate) {
                try {
                    await messageToUpdate.edit({
                        content: '',
                        components: [updatedContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                } catch (error) {
                    console.error('Fehler beim Aktualisieren der Bewerbungsnachricht:', error);
                    // Fallback: Sende neue Nachricht
                    await interaction.channel.send({
                        content: '',
                        components: [updatedContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                }
            } else {
                // Falls keine ursprüngliche Nachricht gefunden wurde, sende neue
                await interaction.channel.send({
                    content: '',
                    components: [updatedContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } catch (error) {
            console.error('Fehler beim Hinzufügen der Rollen:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Hinzufügen der Rollen!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleBewerbungReject(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const userId = interaction.channel.name.replace('bewerbung-', '');
        const member = await interaction.guild.members.fetch(userId).catch(() => null);

        await sendLog(
            'Bewerbung Abgelehnt',
            `**Bewerber:** <@${member?.user.id || userId}> (${member?.user.tag || 'Unbekannt'})\n**Abgelehnt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${interaction.channel.id}>`,
            '<:delete:1434661904743137280>'
        );

        await interaction.reply({
            content: '<:delete:1434661904743137280> Bewerbung wurde abgelehnt.',
            flags: MessageFlags.Ephemeral
        });

        // Hole gespeicherte Bewerbungsdaten
        const savedData = bewerbungData.get(interaction.channel.id);
        let originalContent = '';

        if (savedData) {
            originalContent = `• <:user:1434651323579502672> **Bewerber:** <@${savedData.bewerberId}> (${savedData.bewerberTag})\n` +
                `• <:clock:1434717138073030797> **Bewerbungsdatum:** <t:${savedData.bewerbungsdatum}:F>\n` +
                `• <:info:1434647594457497784> **Status:** <:delete:1434661904743137280> Abgelehnt\n\n` +
                `**<:info:1434647594457497784> Bewerbungsdetails:**\n` +
                `• **Name:** ${savedData.name}\n` +
                `• **Alter:** ${savedData.alter}\n` +
                `• **Warum:** ${savedData.warum}\n` +
                `• **Welche Cheats & Wo geholt:** ${savedData.cheats}\n` +
                `• **Wo helfen:** ${savedData.helfen}`;
        } else {
            // Fallback falls keine Daten gespeichert wurden
            originalContent = `• <:user:1434651323579502672> **Bewerber:** <@${member?.user.id || userId}> (${member?.user.tag || 'Unbekannt'})\n` +
                `• <:clock:1434717138073030797> **Bewerbungsdatum:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
                `• <:info:1434647594457497784> **Status:** <:delete:1434661904743137280> Abgelehnt\n\n` +
                `**<:info:1434647594457497784> Bewerbungsdetails:**\n` +
                `• **Bewerbung wurde abgelehnt**`;
        }

        const rejectedContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## Teambewerbung - Abgelehnt**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    originalContent + `\n\n` +
                        `• **Abgelehnt von:** <@${interaction.user.id}>`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        // Versuche die gespeicherte Message-ID zu verwenden
        let messageToUpdate = null;
        if (savedData && savedData.messageId) {
            try {
                messageToUpdate = await interaction.channel.messages.fetch(savedData.messageId).catch(() => null);
            } catch (error) {
                console.error('Fehler beim Abrufen der gespeicherten Nachricht:', error);
            }
        }

        // Falls gespeicherte Message nicht gefunden wurde, suche nach der Nachricht mit Buttons
        if (!messageToUpdate) {
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                messageToUpdate = messages.find((msg) => {
                    if (msg.components && msg.components.length > 0) {
                        return msg.components.some((row) =>
                            row.components.some((comp) => comp.customId === 'bewerbung_akzeptieren')
                        );
                    }
                    return false;
                });
            } catch (error) {
                console.error('Fehler beim Durchsuchen der Nachrichten:', error);
            }
        }

        // Aktualisiere die ursprüngliche Nachricht, falls gefunden
        if (messageToUpdate) {
            try {
                await messageToUpdate.edit({
                    content: '',
                    components: [rejectedContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (error) {
                console.error('Fehler beim Aktualisieren der Bewerbungsnachricht:', error);
                // Fallback: Sende neue Nachricht
                await interaction.channel.send({
                    content: '',
                    components: [rejectedContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } else {
            // Falls keine ursprüngliche Nachricht gefunden wurde, sende neue
            await interaction.channel.send({
                content: '',
                components: [rejectedContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }

    async function handleBewerbungInterview(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const interviewModal = new ModalBuilder()
            .setCustomId('bewerbung_interview_modal')
            .setTitle('Gesprächstermin vereinbaren');

        const terminInput = new TextInputBuilder()
            .setCustomId('bewerbung_termin')
            .setLabel('Termin (Datum & Uhrzeit)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 15.11.2025 um 18:00 Uhr')
            .setRequired(true)
            .setMaxLength(100);

        const notizenInput = new TextInputBuilder()
            .setCustomId('bewerbung_notizen')
            .setLabel('Notizen (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Zusätzliche Informationen zum Gespräch...')
            .setRequired(false)
            .setMaxLength(500);

        const firstRow = new ActionRowBuilder().addComponents(terminInput);
        const secondRow = new ActionRowBuilder().addComponents(notizenInput);

        interviewModal.addComponents(firstRow, secondRow);

        await interaction.showModal(interviewModal);
    }

    async function handleBewerbungInterviewModal(interaction) {
        const termin = interaction.fields.getTextInputValue('bewerbung_termin');
        const notizen = interaction.fields.getTextInputValue('bewerbung_notizen') || 'Keine Notizen';

        const userId = interaction.channel.name.replace('bewerbung-', '');
        const member = await interaction.guild.members.fetch(userId).catch(() => null);

        await sendLog(
            'Gesprächstermin Vereinbart',
            `**Bewerber:** <@${member?.user.id || userId}> (${member?.user.tag || 'Unbekannt'})\n**Termin:** ${termin}\n**Notizen:** ${notizen}\n**Vereinbart von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${interaction.channel.id}>`,
            '<:settings:1434660812395384870>'
        );

        const interviewContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## Gesprächstermin Vereinbart**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:clock:1434717138073030797> **Termin:** ${termin}\n` +
                        `• <:info:1434647594457497784> **Notizen:** ${notizen}\n` +
                        `• **Vereinbart von:** <@${interaction.user.id}>`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [interviewContainer],
            flags: MessageFlags.IsComponentsV2
        });

        if (member) {
            await member
                .send(
                    `<:clock:1434717138073030797> **Gesprächstermin vereinbart!**\n\n**Termin:** ${termin}\n**Notizen:** ${notizen}\n\nBitte sei pünktlich zum vereinbarten Termin!`
                )
                .catch(() => {});
        }

        // Aktualisiere den Status in der ursprünglichen Bewerbungs-Nachricht
        try {
            const savedData = bewerbungData.get(interaction.channel.id);
            if (savedData) {
                const originalContent =
                    `• <:user:1434651323579502672> **Bewerber:** <@${savedData.bewerberId}> (${savedData.bewerberTag})\n` +
                    `• <:clock:1434717138073030797> **Bewerbungsdatum:** <t:${savedData.bewerbungsdatum}:F>\n` +
                    `• <:info:1434647594457497784> **Status:** <:clock:1434717138073030797> Gesprächstermin vereinbart\n\n` +
                    `**<:info:1434647594457497784> Bewerbungsdetails:**\n` +
                    `• **Name:** ${savedData.name}\n` +
                    `• **Alter:** ${savedData.alter}\n` +
                    `• **Warum:** ${savedData.warum}\n` +
                    `• **Welche Cheats & Wo geholt:** ${savedData.cheats}\n` +
                    `• **Wo helfen:** ${savedData.helfen}`;

                const updatedContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## Teambewerbung - Gesprächstermin**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(originalContent))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    // Buttons beibehalten, damit nach Gesprächstermin weiterhin akzeptiert/abgelehnt werden kann
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('bewerbung_akzeptieren')
                                .setLabel('Akzeptieren')
                                .setStyle(ButtonStyle.Success)
                                .setEmoji('<:haken:1434664861664804875>'),
                            new ButtonBuilder()
                                .setCustomId('bewerbung_ablehnen')
                                .setLabel('Ablehnen')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji('<:delete:1434661904743137280>'),
                            new ButtonBuilder()
                                .setCustomId('bewerbung_gespraech')
                                .setLabel('Gesprächstermin')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('<:settings:1434660812395384870>')
                        )
                    );

                let messageToUpdate = null;
                if (savedData.messageId) {
                    messageToUpdate = await interaction.channel.messages
                        .fetch(savedData.messageId)
                        .catch(() => null);
                }

                if (!messageToUpdate) {
                    const messages = await interaction.channel.messages.fetch({ limit: 50 });
                    messageToUpdate = messages.find((msg) => {
                        if (!msg.components || msg.components.length === 0) return false;
                        return msg.components.some((row) =>
                            row.components.some(
                                (comp) =>
                                    comp.customId === 'bewerbung_akzeptieren' ||
                                    comp.customId === 'bewerbung_ablehnen'
                            )
                        );
                    });
                }

                if (messageToUpdate) {
                    await messageToUpdate
                        .edit({
                            content: '',
                            components: [updatedContainer],
                            flags: MessageFlags.IsComponentsV2
                        })
                        .catch(() => {});
                } else {
                    await interaction.channel
                        .send({
                            content: '',
                            components: [updatedContainer],
                            flags: MessageFlags.IsComponentsV2
                        })
                        .catch(() => {});
                }
            }
        } catch (error) {
            console.error('Fehler beim Aktualisieren des Bewerbungsstatus (Gesprächstermin):', error);
        }
    }

    function isTicketChannel(channel) {
        if (!channel || channel.type !== ChannelType.GuildText) return false;
        const channelName = channel.name.toLowerCase();
        return (
            channelName.startsWith('ticket-') ||
            channelName.startsWith('support-') ||
            channelName.startsWith('partner-') ||
            channelName.startsWith('kauf-') ||
            channelName.startsWith('bewerbung-') ||
            channelName.startsWith('media-')
        );
    }

    async function updateTicketActivity(channelId) {
        if (ticketActivity.has(channelId)) {
            const activity = ticketActivity.get(channelId);
            activity.lastActivity = Date.now();
            ticketActivity.set(channelId, activity);
            await saveActivityMap();
        }
    }

    async function checkInactiveTickets() {
        const INACTIVITY_THRESHOLD = 24 * 60 * 60 * 1000; // 24 Stunden in Millisekunden
        const now = Date.now();

        for (const [channelId, activity] of ticketActivity.entries()) {
            try {
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel || !isTicketChannel(channel)) {
                    ticketActivity.delete(channelId);
                    await saveActivityMap();
                    continue;
                }

                const timeSinceLastActivity = now - activity.lastActivity;
                const timeSinceLastWarning = activity.lastWarning ? now - activity.lastWarning : Infinity;

                // Wenn Ticket 24h inaktiv ist und noch keine Warnung gesendet wurde (oder letzte Warnung > 24h her)
                if (timeSinceLastActivity >= INACTIVITY_THRESHOLD && timeSinceLastWarning >= INACTIVITY_THRESHOLD) {
                    const warningContainer = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('**## <:warn:1440730288140456156> Ticket Inaktivitäts-Warnung**')
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `<:info:1434647594457497784> **Warnung**\n` +
                                    `> Dieses Ticket ist seit **24 Stunden** inaktiv. Bitte melde dich, wenn du noch Hilfe benötigst, ansonsten wird das Ticket möglicherweise geschlossen.\n\n` +
                                    `**Letzte Aktivität:** <t:${Math.floor(activity.lastActivity / 1000)}:R>`
                            )
                        )
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                    await channel.send({
                        content: '',
                        components: [warningContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    activity.lastWarning = now;
                    ticketActivity.set(channelId, activity);
                    await saveActivityMap();

                    await sendLog(
                        'Ticket Inaktivitäts-Warnung',
                        `**Kanal:** <#${channelId}>\n**Letzte Aktivität:** <t:${Math.floor(activity.lastActivity / 1000)}:F>`,
                        '<:info:1434647594457497784>'
                    );
                }
            } catch (error) {
                console.error(`Fehler beim Prüfen der Inaktivität für Ticket ${channelId}:`, error);
            }
        }
    }

    function setupInactivityChecker() {
        // Prüfe alle 6 Stunden auf inaktive Tickets
        setInterval(() => {
            checkInactiveTickets().catch((error) => {
                console.error('Fehler beim Prüfen inaktiver Tickets:', error);
            });
        }, 6 * 60 * 60 * 1000); // 6 Stunden

        // Erste Prüfung nach 1 Minute (damit der Bot Zeit hat, vollständig zu starten)
        setTimeout(() => {
            checkInactiveTickets().catch((error) => {
                console.error('Fehler bei der ersten Prüfung inaktiver Tickets:', error);
            });
        }, 60000);
    }

    // Event-Listener für Nachrichten in Ticket-Kanälen
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!isTicketChannel(message.channel)) return;

        await updateTicketActivity(message.channel.id);
    });

    return {
        activeTickets,
        loadTickets,
        saveTickets,
        scanTicketChannels,
        setupInactivityChecker,
        checkInactiveTickets,
        commandHandlers: {
            setup: handleSetupCommand,
            'ticket-rename': handleTicketRename,
            'ticket-add': handleTicketAdd,
            'ticket-remove': handleTicketRemove,
            bewerbung: handleBewerbungCommand
        },
        selectMenuHandlers: {
            ticket_select: handleTicketSelect,
            bewerbung_rolle_auswahl: handleBewerbungRoleSelect
        },
        buttonHandlers: {
            close_ticket: handleCloseTicket,
            delete_ticket: handleDeleteTicket,
            transcript_ticket: handleTranscriptTicket,
            bewerbung_akzeptieren: handleBewerbungAccept,
            bewerbung_ablehnen: handleBewerbungReject,
            bewerbung_gespraech: handleBewerbungInterview,
            open_bewerbung_modal: handleOpenBewerbungModal
        },
        modalHandlers: {
            bewerbung_modal: handleBewerbungModalSubmit,
            bewerbung_interview_modal: handleBewerbungInterviewModal
        },
        pruneTickets
    };
}

module.exports = {
    createTicketFeature
};