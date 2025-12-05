const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');

function createCommunityFeature({ client, sendLog, env }) {
    async function handleRegelnCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const rulesChannelId = env.RULES_CHANNEL_ID;
        if (!rulesChannelId) {
            return interaction.reply({
                content: '<:close:1434661746643308675> RULES_CHANNEL_ID ist in der .env-Datei nicht gesetzt!',
                flags: MessageFlags.Ephemeral
            });
        }

        const rulesChannel = interaction.guild.channels.cache.get(rulesChannelId);
        if (!rulesChannel) {
            return interaction.reply({
                content: `<:close:1434661746643308675> Regeln-Kanal mit der ID ${rulesChannelId} nicht gefunden!`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const rulesBannerUrl = env.RULES_BANNER_IMAGE_URL || '';

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**## ${interaction.guild.name} Server Regeln**`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• <:rule:1434647656675672176> **Einhaltung von Discord Richtlinien** \n` +
                            `> Die [Nutzungsbedingungen](${env.RULES_TERMS_URL || `https://discord.com/channels/${interaction.guild.id}/${rulesChannelId}`}) und [Community-Richtlinien](${env.RULES_POLICY_URL || `https://discord.com/channels/${interaction.guild.id}/${rulesChannelId}`}) sind __jederzeit__ einzuhalten. Zusätzlich gelten die spezifischen Regeln dieses Servers.\n\n` +
                            `• <:user:1434651323579502672> **Respektvoller Umgang miteinander** \n` +
                            `> Beleidigungen, Diskriminierung oder Provokationen sind __untersagt__. Ein höflicher und respektvoller Ton ist auf dem __gesamten__ Server Pflicht.\n\n` +
                            `• <:link:1434651039369396304> **Keine Werbung oder Abwerbung** \n` +
                            `> Werbung – ob öffentlich oder privat – ist strikt __verboten__. Das gezielte Abwerben von Mitgliedern führt zum sofortigen und permanenten Bann.\n\n` +
                            `•<:announce:1434651478114435113> **Verantwortung für eigene Inhalte** \n` +
                            `> __Nutzer haften__ für ihre Beiträge. Urheberrechte müssen beachtet werden; das Verbreiten oder Weiterverkaufen fremder Inhalte ist __untersagt__.\n\n` +
                            `• <:info:1434647594457497784> **Konsequenzen bei Regelverstößen** \n` +
                            `> Verstöße gegen die Regeln sind dem Serverteam zu melden. Bei schweren Vergehen wie Spam, Copyright-Verstößen oder unerlaubtem Handel droht ein __permanenter Bann__.`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            if (rulesBannerUrl) {
                container
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems([
                            {
                                media: { url: rulesBannerUrl }
                            }
                        ])
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));
            }

            const buttons = [];

            buttons.push(
                new ButtonBuilder()
                    .setCustomId('accept_rules')
                    .setLabel('Akzeptieren')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('<:haken:1434664861664804875>')
            );

            const termsUrl = env.RULES_TERMS_URL || `https://discord.com/channels/${interaction.guild.id}/${rulesChannelId}`;
            buttons.push(
                new ButtonBuilder()
                    .setLabel('Nutzungsbedingungen')
                    .setStyle(ButtonStyle.Link)
                    .setURL(termsUrl)
                    .setEmoji('<:nutzungsbedingungen:1434657281605242971>')
            );

            const policyUrl = env.RULES_POLICY_URL || `https://discord.com/channels/${interaction.guild.id}/${rulesChannelId}`;
            buttons.push(
                new ButtonBuilder()
                    .setLabel('Richtlinien')
                    .setStyle(ButtonStyle.Link)
                    .setURL(policyUrl)
                    .setEmoji('<:richtlinien:1434657293215072306>')
            );

            const actionRows = [];
            for (let i = 0; i < buttons.length; i += 5) {
                actionRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            }
            actionRows.forEach((row) => container.addActionRowComponents(row));

            await rulesChannel.send({
                content: '',
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            sendLog(
                'Serverregeln Gesendet',
                `**Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${rulesChannelId}>`,
                '<:rule:1434647656675672176>'
            ).catch((err) => console.error('Log-Fehler:', err));

            await interaction.editReply({
                content: `<:haken:1434664861664804875> Die Serverregeln wurden erfolgreich in <#${rulesChannelId}> gesendet!`
            });
        } catch (error) {
            console.error('Fehler beim Senden der Components V2 Regeln:', error);
            try {
                await interaction.editReply({
                    content: `<:close:1434661746643308675> Fehler beim Senden der Regeln in <#${rulesChannelId}>!`
                });
            } catch (replyError) {
                console.error('Fehler beim Beantworten der Interaction:', replyError);
            }
        }
    }

    async function handleAcceptRules(interaction) {
        const member = interaction.member;
        const verifiedRoleId = env.VERIFIED_ROLE_ID;
        if (!verifiedRoleId) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Fehler: VERIFIED_ROLE_ID ist nicht in der .env-Datei konfiguriert!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
            if (!verifiedRole) {
                return interaction.reply({
                    content: `<:close:1434661746643308675> Fehler: Rolle mit ID ${verifiedRoleId} wurde nicht gefunden!`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (member.roles.cache.has(verifiedRoleId)) {
                return interaction.reply({
                    content: '<:haken:1434664861664804875> Du bist bereits verifiziert!',
                    flags: MessageFlags.Ephemeral
                });
            }

            await member.roles.add(verifiedRole);

            await sendLog(
                'Benutzer Verifiziert',
                `**Verifiziert:** <@${member.user.id}> (${member.user.tag})\n**Rolle:** ${verifiedRole.name}`,
                '<:haken:1434664861664804875>'
            );

            await interaction.reply({
                content: '<:haken:1434664861664804875> **Erfolgreich verifiziert!** Willkommen auf dem Server!',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Fehler beim Verifizieren des Benutzers:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Verifizieren! Bitte kontaktiere einen Administrator.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleRolleCommand(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = interaction.options.getUser('user');
        const rollenInput = interaction.options.getString('rollen');
        const aktion = interaction.options.getString('aktion');

        if (!targetUser) {
            return interaction.reply({
                content: '<:close:1434661746643308675> User nicht gefunden!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            const botMember = interaction.guild.members.me;

            const roleIds = rollenInput.match(/<@&(\d+)>|(\d{17,20})/g) || [];
            const roles = [];

            for (const roleInput of roleIds) {
                const roleId = roleInput.replace(/<@&|>/g, '');
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    if (botMember.roles.highest.position <= role.position && botMember.id !== interaction.guild.ownerId) {
                        continue;
                    }
                    if (interaction.member.roles.highest.position <= role.position && interaction.member.id !== interaction.guild.ownerId) {
                        continue;
                    }
                    roles.push(role);
                }
            }

            if (roles.length === 0) {
                return interaction.reply({
                    content: '<:close:1434661746643308675> Keine gültigen Rollen gefunden oder keine Berechtigung!',
                    flags: MessageFlags.Ephemeral
                });
            }

            const roleMentions = roles.map((r) => `<@&${r.id}>`).join(', ');

            if (aktion === 'add') {
                await member.roles.add(roles);
                await sendLog(
                    'Rollen Hinzugefügt',
                    `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Rollen:** ${roleMentions}\n**Hinzugefügt von:** <@${interaction.user.id}> (${interaction.user.tag})`,
                    '<:haken:1434664861664804875>'
                );
                await interaction.reply({
                    content: `<:haken:1434664861664804875> Rollen ${roleMentions} wurden <@${targetUser.id}> hinzugefügt!`,
                    flags: MessageFlags.Ephemeral
                });
            } else if (aktion === 'remove') {
                await member.roles.remove(roles);
                await sendLog(
                    'Rollen Entfernt',
                    `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Rollen:** ${roleMentions}\n**Entfernt von:** <@${interaction.user.id}> (${interaction.user.tag})`,
                    '<:delete:1434661904743137280>'
                );
                await interaction.reply({
                    content: `<:haken:1434664861664804875> Rollen ${roleMentions} wurden von <@${targetUser.id}> entfernt!`,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            console.error('Fehler beim Verwalten der Rollen:', error);
            await interaction.reply({
                content: '<:close:1434661746643308675> Fehler beim Verwalten der Rollen!',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    async function handleRoleallCommand(interaction) {
        if (
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) &&
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!')
                );

            return interaction.reply({
                content: '',
                components: [errorContainer],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            });
        }

        const role = interaction.options.getRole('role', true);
        const action = interaction.options.getString('action', true); // 'add' oder 'remove'

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Berechtigungsprüfung vor der Verarbeitung
            const botMember = interaction.guild.members.me;
            const userMember = interaction.member;
            
            // Prüfe, ob der Bot die Rolle verwalten kann
            if (botMember.roles.highest.position <= role.position && interaction.guild.ownerId !== interaction.user.id) {
                const errorContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `<:close:1434661746643308675> **Fehler: Bot-Berechtigung**\n\n` +
                            `Der Bot kann diese Rolle nicht verwalten! Die Rolle <@&${role.id}> ist höher oder gleich der höchsten Bot-Rolle.`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                return interaction.editReply({
                    content: '',
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            // Prüfe, ob der Benutzer die Rolle verwalten kann
            if (userMember.roles.highest.position <= role.position && interaction.guild.ownerId !== interaction.user.id) {
                const errorContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `<:close:1434661746643308675> **Fehler: Benutzer-Berechtigung**\n\n` +
                            `Du kannst diese Rolle nicht verwalten! Die Rolle <@&${role.id}> ist höher oder gleich deiner höchsten Rolle.`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                return interaction.editReply({
                    content: '',
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            // Prüfe, ob die Rolle verwaltbar ist
            if (role.managed) {
                const errorContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `<:close:1434661746643308675> **Fehler: Integration-Rolle**\n\n` +
                            `Die Rolle <@&${role.id}> wird von einer Integration verwaltet und kann nicht manuell zugewiesen werden!`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                return interaction.editReply({
                    content: '',
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const startContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**## <:settings:1434660812395384870> RoleAll Aktion**`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `<:info:1434647594457497784> **Aktion:** ${action === 'add' ? 'Hinzufügen' : 'Entfernen'}\n` +
                        `<:settings:1434660812395384870> **Rolle:** <@&${role.id}> (${role.name})\n\n` +
                        `<:clock:1434717138073030797> Starte Verarbeitung für alle Mitglieder...`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [startContainer],
                flags: MessageFlags.IsComponentsV2
            });

            const members = await interaction.guild.members.fetch();
            const memberArray = Array.from(members.values());
            const totalMembers = memberArray.filter(m => !m.user.bot).length;
            
            let success = 0;
            let failed = 0;
            let skipped = 0;
            let processed = 0;
            const errors = [];

            // Fortschritts-Update alle 10 Mitglieder oder bei größeren Servern alle 25
            const updateInterval = totalMembers > 100 ? 25 : 10;
            let lastUpdate = 0;

            for (const member of memberArray) {
                // Überspringe Bots
                if (member.user.bot) {
                    skipped++;
                    continue;
                }

                // Prüfe, ob Mitglied bereits die Rolle hat (bei add) oder nicht hat (bei remove)
                const hasRole = member.roles.cache.has(role.id);
                if (action === 'add' && hasRole) {
                    skipped++;
                    continue;
                }
                if (action === 'remove' && !hasRole) {
                    skipped++;
                    continue;
                }

                try {
                    if (action === 'add') {
                        await member.roles.add(role);
                    } else {
                        await member.roles.remove(role);
                    }
                    success++;
                    processed++;

                    // Rate-Limit-Schutz: Dynamische Pause basierend auf Servergröße
                    // Kleinere Server: 100ms, größere Server: 50ms (für schnellere Verarbeitung)
                    const delay = totalMembers > 200 ? 50 : 100;
                    await new Promise((r) => setTimeout(r, delay));

                    // Fortschritts-Update
                    if (processed - lastUpdate >= updateInterval) {
                        lastUpdate = processed;
                        const progress = Math.round((processed / totalMembers) * 100);
                        const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
                        
                        try {
                            const progressContainer = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(
                                        `**## <:settings:1434660812395384870> RoleAll Aktion**`
                                    )
                                )
                                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(
                                        `<:info:1434647594457497784> **Aktion:** ${action === 'add' ? 'Hinzufügen' : 'Entfernen'}\n` +
                                        `<:settings:1434660812395384870> **Rolle:** <@&${role.id}> (${role.name})\n\n` +
                                        `<:clock:1434717138073030797> **Fortschritt:** ${progress}%\n` +
                                        `\`${progressBar}\`\n\n` +
                                        `<:haken:1434664861664804875> **Erfolgreich:** ${success}\n` +
                                        `<:close:1434661746643308675> **Fehler:** ${failed}\n` +
                                        `<:info:1434647594457497784> **Übersprungen:** ${skipped}\n\n` +
                                        `**Verarbeitet:** ${processed} / ${totalMembers} Mitglieder`
                                    )
                                )
                                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

                            await interaction.editReply({
                                content: '',
                                components: [progressContainer],
                                flags: MessageFlags.IsComponentsV2
                            });
                        } catch (updateError) {
                            // Ignoriere Update-Fehler, um den Prozess nicht zu unterbrechen
                        }
                    }
                } catch (err) {
                    failed++;
                    processed++;
                    
                    // Speichere Fehlerdetails für Logging
                    if (errors.length < 5) {
                        errors.push({
                            user: member.user.tag,
                            error: err.message || 'Unbekannter Fehler'
                        });
                    }

                    // Bei Rate-Limit-Fehlern länger warten
                    if (err.code === 429 || err.status === 429) {
                        const retryAfter = err.retryAfter || 2;
                        await new Promise((r) => setTimeout(r, retryAfter * 1000));
                    }
                }
            }

            // Finale Zusammenfassung
            const summary = `**Aktion:** ${action === 'add' ? 'Hinzufügen' : 'Entfernen'}\n` +
                `**Rolle:** <@&${role.id}> (${role.name})\n` +
                `**Ausgeführt von:** <@${interaction.user.id}> (${interaction.user.tag})\n` +
                `**Erfolgreich:** ${success}\n` +
                `**Fehler:** ${failed}\n` +
                `**Übersprungen:** ${skipped} (Bots oder bereits korrekt zugewiesen)\n` +
                `**Gesamt verarbeitet:** ${processed}`;

            if (errors.length > 0) {
                const errorDetails = errors.map(e => `- ${e.user}: ${e.error}`).join('\n');
                console.error('RoleAll Fehlerdetails:', errorDetails);
            }

            await sendLog(
                'RoleAll Aktion',
                summary,
                '<:settings:1434660812395384870>'
            ).catch((err) => console.error('Log-Fehler:', err));

            const resultContent = failed > 0
                ? `**## <:haken:1434664861664804875> RoleAll Abgeschlossen**\n\n` +
                  `<:info:1434647594457497784> **Aktion:** ${action === 'add' ? 'Hinzufügen' : 'Entfernen'}\n` +
                  `<:settings:1434660812395384870> **Rolle:** <@&${role.id}> (${role.name})\n` +
                  `<:user:1434651323579502672> **Ausgeführt von:** <@${interaction.user.id}> (${interaction.user.tag})\n\n` +
                  `<:haken:1434664861664804875> **Erfolgreich:** ${success}\n` +
                  `<:close:1434661746643308675> **Fehler:** ${failed}\n` +
                  `<:info:1434647594457497784> **Übersprungen:** ${skipped}\n\n` +
                  `**Gesamt verarbeitet:** ${processed} / ${totalMembers} Mitglieder`
                : `**## <:haken:1434664861664804875> RoleAll Erfolgreich Abgeschlossen**\n\n` +
                  `<:info:1434647594457497784> **Aktion:** ${action === 'add' ? 'Hinzufügen' : 'Entfernen'}\n` +
                  `<:settings:1434660812395384870> **Rolle:** <@&${role.id}> (${role.name})\n` +
                  `<:user:1434651323579502672> **Ausgeführt von:** <@${interaction.user.id}> (${interaction.user.tag})\n\n` +
                  `<:haken:1434664861664804875> **Erfolgreich:** ${success}\n` +
                  `<:info:1434647594457497784> **Übersprungen:** ${skipped}\n\n` +
                  `**Gesamt verarbeitet:** ${processed} / ${totalMembers} Mitglieder`;

            const resultContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(resultContent)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [resultContainer],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Fehler beim Ausführen von /roleall:', error);
            
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `<:close:1434661746643308675> **Fehler beim Ausführen des Befehls**\n\n` +
                        `**Fehlermeldung:** ${error.message || 'Unbekannter Fehler'}\n\n` +
                        `Bitte versuche es erneut oder kontaktiere einen Administrator.`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await interaction.editReply({
                content: '',
                components: [errorContainer],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }

    return {
        commandHandlers: {
            regeln: handleRegelnCommand,
            rolle: handleRolleCommand,
            roleall: handleRoleallCommand
        },
        buttonHandlers: {
            accept_rules: handleAcceptRules
        }
    };
}

module.exports = {
    createCommunityFeature
};

