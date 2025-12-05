const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createGiveawayFeature({ client, sendLog }) {
    const { map: activeGiveaways, load: loadGiveawayMap, save: saveGiveawayMap } = createJsonBackedMap('giveaways.json');
    const giveawayTimers = new Map();

    function parseDuration(durationStr) {
        const match = durationStr.match(/^(\d+)([smhd])$/i);
        if (!match) return null;

        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        const multipliers = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000
        };

        return value * multipliers[unit];
    }

    function scheduleGiveawayEnd(messageId, giveaway) {
        const timeLeft = giveaway.endTime - Date.now();

        if (timeLeft <= 0) {
            endGiveaway(messageId);
            return;
        }

        const timer = setTimeout(async () => {
            await endGiveaway(messageId);
        }, timeLeft);

        giveawayTimers.set(messageId, timer);
    }

    async function loadGiveaways() {
        try {
            await loadGiveawayMap();
            for (const [messageId, giveaway] of activeGiveaways.entries()) {
                if (!giveaway.ended && giveaway.endTime > Date.now()) {
                    scheduleGiveawayEnd(messageId, giveaway);
                } else if (!giveaway.ended && giveaway.endTime <= Date.now()) {
                    await endGiveaway(messageId);
                }
            }
            console.log(`✅ ${activeGiveaways.size} Giveaways geladen`);
        } catch (error) {
            console.error('Fehler beim Laden der Giveaways:', error);
        }
    }

    async function saveGiveaways() {
        await saveGiveawayMap();
    }

    async function endGiveaway(messageId) {
        const giveaway = activeGiveaways.get(messageId);
        if (!giveaway || giveaway.ended) return;

        giveaway.ended = true;

        try {
            const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
            if (!channel) {
                activeGiveaways.delete(messageId);
                await saveGiveaways();
                return;
            }

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                activeGiveaways.delete(messageId);
                await saveGiveaways();
                return;
            }

            const participants = giveaway.participants.filter((id) => {
                try {
                    return channel.guild.members.cache.has(id);
                } catch (error) {
                    return false;
                }
            });

            if (participants.length === 0) {
                const endedContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**## NorealTrolling Giveaway Beendet**'))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `**Preis:** ${giveaway.prize}\n\n` +
                                `**Niemand hat teilgenommen!**\n` +
                                `> Das Giveaway wurde beendet, aber es gab keine Teilnehmer.\n` +
                                `<:haken:1434664861664804875> **Teilnehmer:** ${giveaway.participants.length}`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                giveaway.winners = [];
                await message.edit({
                    content: '',
                    components: [endedContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                const winners = [];
                const winnerCount = Math.min(giveaway.winnerCount, participants.length);

                const pool = [...participants];
                for (let i = 0; i < winnerCount; i += 1) {
                    const randomIndex = Math.floor(Math.random() * pool.length);
                    winners.push(pool.splice(randomIndex, 1)[0]);
                }

                const winnersMention = winners.map((id) => `<@${id}>`).join(', ');
                giveaway.winners = winners;

                const endedContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**## NorealTrolling Giveaway beendet**'))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `<:preis:1434717917269852181> **Preis:** ${giveaway.prize}\n\n` +
                                `<:gewinner:1434717035698585650>**Gewinner:** ${winnersMention}\n` +
                                `<:haken:1434664861664804875> **Teilnehmer:** ${giveaway.participants.length}\n` +
                                `> Herzlichen Glückwunsch! Kontaktiere einen Administrator, um deinen Gewinn zu erhalten.`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await message.edit({
                    content: '',
                    components: [endedContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                for (const winnerId of winners) {
                    try {
                        const member = await channel.guild.members.fetch(winnerId).catch(() => null);
                        if (member) {
                            await member
                                .send(
                                    `<:gewinner:1434717035698585650> **Glückwunsch!** Du hast das Giveaway für **${giveaway.prize}** gewonnen! Kontaktiere einen Administrator auf ${channel.guild.name}, um deinen Gewinn zu erhalten.`
                                )
                                .catch(() => {});
                        }
                    } catch (error) {
                        console.error(`Fehler beim Benachrichtigen des Gewinners ${winnerId}:`, error);
                    }
                }

                await sendLog(
                    'Giveaway Beendet',
                    `**Preis:** ${giveaway.prize}\n**Gewinner:** ${winnersMention}\n**Teilnehmer:** ${giveaway.participants.length}\n**Kanal:** <#${channel.id}>`,
                    '<:gewinner:1434717035698585650>'
                );
            }

            const timer = giveawayTimers.get(messageId);
            if (timer) {
                clearTimeout(timer);
                giveawayTimers.delete(messageId);
            }

            await saveGiveaways();
        } catch (error) {
            console.error('Fehler beim Beenden des Giveaways:', error);
        }
    }

    async function handleGiveawayCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const durationStr = interaction.options.get('dauer').value;
        const winnerCount = interaction.options.get('gewinner').value;
        const prize = interaction.options.get('preis').value;
        const targetChannel = interaction.options.get('kanal')?.channel || interaction.channel;

        const duration = parseDuration(durationStr);
        if (!duration || duration < 10000) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Ungültige Dauer! Verwende z.B. 10s, 5m, 1h, 2d',
                flags: MessageFlags.Ephemeral
            });
        }

        const endTime = Date.now() + duration;
        const endDate = new Date(endTime);

        const giveawayContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('**## NorealTrolling Giveaway**'))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:preis:1434717917269852181> **Preis:** ${prize}\n` +
                        `• <:gewinner:1434717035698585650> **Gewinner:** ${winnerCount}\n` +
                        `• <:clock:1434717138073030797> **Endet:** <t:${Math.floor(endDate.getTime() / 1000)}:R>\n\n` +
                        `**Teilnahme**\n` +
                        `> Klicke auf den Button unten, um am Giveaway teilzunehmen!`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('join_giveaway')
                        .setLabel('Teilnehmen')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('<:haken:1434664861664804875>')
                )
            );

        try {
            const message = await targetChannel.send({
                content: '',
                components: [giveawayContainer],
                flags: MessageFlags.IsComponentsV2
            });

            const giveaway = {
                messageId: message.id,
                channelId: targetChannel.id,
                endTime,
                winnerCount,
                prize,
                participants: [],
                ended: false
            };

            activeGiveaways.set(message.id, giveaway);
            await saveGiveaways();

            await sendLog(
                'Giveaway Erstellt',
                `**Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Preis:** ${prize}\n**Gewinner:** ${winnerCount}\n**Kanal:** <#${targetChannel.id}>`,
                '<:preis:1434717917269852181>'
            );

            scheduleGiveawayEnd(message.id, giveaway);

            await interaction.reply({
                content: `<:haken:1434664861664804875> Giveaway erfolgreich in <#${targetChannel.id}> erstellt!`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Erstellen des Giveaways:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Erstellen des Giveaways!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleGiveawayJoin(interaction) {
        const giveaway = activeGiveaways.get(interaction.message.id);

        if (!giveaway) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieses Giveaway existiert nicht mehr!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (giveaway.ended) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieses Giveaway ist bereits beendet!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (giveaway.endTime <= Date.now()) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Dieses Giveaway ist bereits abgelaufen!',
                flags: MessageFlags.Ephemeral
            });
        }

        const userId = interaction.user.id;

        if (giveaway.participants.includes(userId)) {
            giveaway.participants = giveaway.participants.filter((id) => id !== userId);
            await saveGiveaways();

            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast deine Teilnahme entfernt!',
                flags: MessageFlags.Ephemeral
            });
        }

        giveaway.participants.push(userId);
        await saveGiveaways();

        const endDate = new Date(giveaway.endTime);
        const participantCount = giveaway.participants.length;

        const giveawayContainer = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('**## NorealTrolling Giveaway**'))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:preis:1434717917269852181> **Preis:** ${giveaway.prize}\n` +
                        `• <:gewinner:1434717035698585650> **Gewinner:** ${giveaway.winnerCount}\n` +
                        `• <:clock:1434717138073030797> **Endet:** <t:${Math.floor(endDate.getTime() / 1000)}:R>\n\n` +
                        `<:haken:1434664861664804875> **Teilnehmer:** ${participantCount}\n\n` +
                        `**Teilnahme**\n` +
                        `> Klicke auf den Button unten, um am Giveaway teilzunehmen!`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('join_giveaway')
                        .setLabel('Teilnehmen')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('<:haken:1434664861664804875>')
                )
            );

        try {
            await interaction.message.edit({
                content: '',
                components: [giveawayContainer],
                flags: MessageFlags.IsComponentsV2
            });

            await interaction.reply({
                content: '<:haken:1434664861664804875> Du nimmst jetzt am Giveaway teil!',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Aktualisieren des Giveaways:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Aktualisieren der Teilnahme!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleGiveawayReroll(interaction) {
        try {
            if (
                !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
                !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
            ) {
                return interaction.reply({
                    content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const rawId = interaction.options.getString('nachricht_id', true);
            const countOpt = interaction.options.getInteger('anzahl');
            const rerollCount = Math.max(1, countOpt || 1);

            const idMatches = rawId.match(/\d{16,20}/g);
            const messageId = idMatches ? idMatches[idMatches.length - 1] : rawId;

            const giveaway = activeGiveaways.get(messageId);
            if (!giveaway) {
                return interaction.reply({
                    content: '<:close:1434661746643308675> Giveaway nicht gefunden. Prüfe die Nachrichten‑ID oder den Link.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!giveaway.ended) {
                return interaction.reply({
                    content: '<:close:1434661746643308675> Dieses Giveaway ist noch nicht beendet.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
            if (!channel) {
                return interaction.reply({
                    content: '<:close:1434661746643308675> Ziel‑Kanal nicht mehr vorhanden. Reroll nicht möglich.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const existingWinners = Array.isArray(giveaway.winners) ? giveaway.winners : [];
            const eligible = giveaway.participants.filter(
                (id) => channel.guild.members.cache.has(id) && !existingWinners.includes(id)
            );
            if (eligible.length === 0) {
                return interaction.reply({
                    content: '<:close:1434661746643308675> Keine berechtigten Teilnehmer für einen Reroll gefunden.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const toDraw = Math.min(rerollCount, eligible.length);
            const newWinners = [];
            const pool = [...eligible];
            for (let i = 0; i < toDraw; i += 1) {
                const idx = Math.floor(Math.random() * pool.length);
                newWinners.push(pool.splice(idx, 1)[0]);
            }

            giveaway.winners = newWinners;
            await saveGiveaways();

            const winnersMention = newWinners.map((id) => `<@${id}>`).join(', ');
            const message = await channel.messages.fetch(messageId).catch(() => null);

            if (message) {
                const endedContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## NorealTrolling Giveaway beendet — Reroll**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `<:preis:1434717917269852181> **Preis:** ${giveaway.prize}\n\n` +
                                `<:gewinner:1434717035698585650>**Neue Gewinner:** ${winnersMention}\n` +
                                `<:haken:1434664861664804875> **Teilnehmer:** ${giveaway.participants.length}\n` +
                                `> Reroll durchgeführt. Bitte bei der Serverleitung melden.`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                await message.edit({
                    content: '',
                    components: [endedContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            for (const winnerId of newWinners) {
                const member = await channel.guild.members.fetch(winnerId).catch(() => null);
                if (member) {
                    await member
                        .send(
                            `<:gewinner:1434717035698585650> **Glückwunsch!** Du wurdest beim Reroll für **${giveaway.prize}** gezogen! Kontaktiere einen Administrator auf ${channel.guild.name}.`
                        )
                        .catch(() => {});
                }
            }

            await sendLog(
                'Giveaway Reroll',
                `**Preis:** ${giveaway.prize}\n**Neue Gewinner:** ${winnersMention}\n**Teilnehmer gesamt:** ${giveaway.participants.length}\n**Kanal:** <#${channel.id}>`,
                '<:settings:1434660812395384870>'
            );

            return interaction.reply({
                content: `<:haken:1434664861664804875> Reroll durchgeführt. Neue Gewinner: ${winnersMention}`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Reroll:', error);
            return interaction.reply({
                content: '<:close:1434661746643308675> Unerwarteter Fehler beim Reroll.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleGiveawayListCommand(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const activeGiveawaysList = Array.from(activeGiveaways.values()).filter(
                (g) => !g.ended && g.endTime > Date.now()
            );

            if (activeGiveawaysList.length === 0) {
                const emptyContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('**## Aktive Giveaways**')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            '<:info:1434647594457497784> **Keine aktiven Giveaways**\n> Derzeit laufen keine Giveaways.'
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                return interaction.editReply({
                    content: '',
                    components: [emptyContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            let content = `**## Aktive Giveaways (${activeGiveawaysList.length})**\n\n`;

            for (const giveaway of activeGiveawaysList) {
                try {
                    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                    const endDate = new Date(giveaway.endTime);
                    const timeLeft = giveaway.endTime - Date.now();
                    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
                    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

                    content +=
                        `• <:preis:1434717917269852181> **${giveaway.prize}**\n` +
                        `  └ <:gewinner:1434717035698585650> ${giveaway.winnerCount} Gewinner | ` +
                        `<:haken:1434664861664804875> ${giveaway.participants.length} Teilnehmer\n` +
                        `  └ <:clock:1434717138073030797> Endet: <t:${Math.floor(endDate.getTime() / 1000)}:R> ` +
                        `(${hoursLeft}h ${minutesLeft}m)\n` +
                        `  └ <:info:1434647594457497784> Kanal: ${channel ? `<#${channel.id}>` : 'Unbekannt'}\n\n`;
                } catch (error) {
                    console.error('Fehler beim Abrufen der Giveaway-Daten:', error);
                }
            }

            const listContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [listContainer],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Abrufen der Giveaway-Liste:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Abrufen der Giveaway-Liste!'
            });
        }
    }

    async function handleGiveawayEditCommand(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const rawId = interaction.options.getString('nachricht_id', true);
            const newPrize = interaction.options.getString('preis');
            const newWinnerCount = interaction.options.getInteger('gewinner');

            const idMatches = rawId.match(/\d{16,20}/g);
            const messageId = idMatches ? idMatches[idMatches.length - 1] : rawId;

            const giveaway = activeGiveaways.get(messageId);
            if (!giveaway) {
                return interaction.editReply({
                    content: '<:close:1434661746643308675> Giveaway nicht gefunden. Prüfe die Nachrichten-ID oder den Link.'
                });
            }

            if (giveaway.ended) {
                return interaction.editReply({
                    content: '<:close:1434661746643308675> Beendete Giveaways können nicht bearbeitet werden.'
                });
            }

            const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
            if (!channel) {
                return interaction.editReply({
                    content: '<:close:1434661746643308675> Ziel-Kanal nicht mehr vorhanden.'
                });
            }

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                return interaction.editReply({
                    content: '<:close:1434661746643308675> Giveaway-Nachricht nicht gefunden.'
                });
            }

            let updated = false;
            if (newPrize) {
                giveaway.prize = newPrize;
                updated = true;
            }
            if (newWinnerCount !== null) {
                giveaway.winnerCount = newWinnerCount;
                updated = true;
            }

            if (!updated) {
                return interaction.editReply({
                    content: '<:info:1434647594457497784> Keine Änderungen vorgenommen. Bitte gib mindestens einen neuen Wert an.'
                });
            }

            await saveGiveaways();

            const endDate = new Date(giveaway.endTime);
            const participantCount = giveaway.participants.length;

            const giveawayContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('**## NorealTrolling Giveaway**'))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• <:preis:1434717917269852181> **Preis:** ${giveaway.prize}\n` +
                            `• <:gewinner:1434717035698585650> **Gewinner:** ${giveaway.winnerCount}\n` +
                            `• <:clock:1434717138073030797> **Endet:** <t:${Math.floor(endDate.getTime() / 1000)}:R>\n\n` +
                            `<:haken:1434664861664804875> **Teilnehmer:** ${participantCount}\n\n` +
                            `**Teilnahme**\n` +
                            `> Klicke auf den Button unten, um am Giveaway teilzunehmen!`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('join_giveaway')
                            .setLabel('Teilnehmen')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('<:haken:1434664861664804875>')
                    )
                );

            await message.edit({
                content: '',
                components: [giveawayContainer],
                flags: MessageFlags.IsComponentsV2
            });

            await sendLog(
                'Giveaway Bearbeitet',
                `**Bearbeitet von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Preis:** ${giveaway.prize}\n**Gewinner:** ${giveaway.winnerCount}\n**Kanal:** <#${channel.id}>`,
                '<:settings:1434660812395384870>'
            );

            await interaction.editReply({
                content: `<:haken:1434664861664804875> Giveaway erfolgreich bearbeitet!`
            });
        } catch (error) {
            console.error('Fehler beim Bearbeiten des Giveaways:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Bearbeiten des Giveaways!'
            });
        }
    }

    async function handleGiveawayDeleteCommand(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const rawId = interaction.options.getString('nachricht_id', true);
            const idMatches = rawId.match(/\d{16,20}/g);
            const messageId = idMatches ? idMatches[idMatches.length - 1] : rawId;

            const giveaway = activeGiveaways.get(messageId);
            if (!giveaway) {
                return interaction.editReply({
                    content: '<:close:1434661746643308675> Giveaway nicht gefunden. Prüfe die Nachrichten-ID oder den Link.'
                });
            }

            const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
            if (!channel) {
                // Kanal existiert nicht mehr, aber Giveaway aus Datenbank entfernen
                activeGiveaways.delete(messageId);
                await saveGiveaways();

                const timer = giveawayTimers.get(messageId);
                if (timer) {
                    clearTimeout(timer);
                    giveawayTimers.delete(messageId);
                }

                return interaction.editReply({
                    content: '<:haken:1434664861664804875> Giveaway aus der Datenbank entfernt (Kanal existiert nicht mehr).'
                });
            }

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) {
                try {
                    await message.delete();
                } catch (error) {
                    console.error('Fehler beim Löschen der Giveaway-Nachricht:', error);
                }
            }

            // Timer löschen falls vorhanden
            const timer = giveawayTimers.get(messageId);
            if (timer) {
                clearTimeout(timer);
                giveawayTimers.delete(messageId);
            }

            // Giveaway aus Datenbank entfernen
            activeGiveaways.delete(messageId);
            await saveGiveaways();

            await sendLog(
                'Giveaway Gelöscht',
                `**Gelöscht von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Preis:** ${giveaway.prize}\n**Teilnehmer:** ${giveaway.participants.length}\n**Kanal:** <#${channel.id}>`,
                '<:delete:1434661904743137280>'
            );

            await interaction.editReply({
                content: `<:haken:1434664861664804875> Giveaway erfolgreich gelöscht!`
            });
        } catch (error) {
            console.error('Fehler beim Löschen des Giveaways:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Löschen des Giveaways!'
            });
        }
    }

    return {
        activeGiveaways,
        loadGiveaways,
        saveGiveaways,
        scheduleGiveawayEnd,
        endGiveaway,
        commandHandlers: {
            giveaway: handleGiveawayCommand,
            'giveaway-reroll': handleGiveawayReroll,
            'giveaway-list': handleGiveawayListCommand,
            'giveaway-edit': handleGiveawayEditCommand,
            'giveaway-delete': handleGiveawayDeleteCommand
        },
        buttonHandlers: {
            join_giveaway: handleGiveawayJoin
        }
    };
}

module.exports = {
    createGiveawayFeature
};

