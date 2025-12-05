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

function createEmbedFeature({ client, sendLog }) {
    // Embed-Vorlagen
    const embedTemplates = {
        ham: {
            title: '## HamMafia Lua Executor',
            content:
                `- **Best Executor**\n` +
                `- **Premium Menus**\n` +
                `- **Safe Triggers**\n` +
                `- **Undetected**\n` +
                `- **Official Reseller**\n\n` +
                `__Prices:__\n\n` +
                `> <:Ham:1444118311464997038> Week = 9,99€\n` +
                `> <:Ham:1444118311464997038> Month = 19,99€\n` +
                `> <:Ham:1444118311464997038> Lifetime = 39,99€\n\n` +
                `Klicke auf den Button oder öffne ein Ticket, um zu kaufen!`,
            button: {
                label: 'Website HamMafia',
                url: 'https://modzilla.shop/product/ham-lua-executor'
            }
        },
        vanity: {
            title: '## Vanity Menu',
            content:
                `- **Best Lua Menu**\n` +
                `- **Add Money**\n` +
                `- **Full WaveShield And Other AC Bypass**\n` +
                `- **Sounds Spamer**\n` +
                `- **Silent Kill All**\n` +
                `- **Fuck Server / Lag Server**\n` +
                `- **Give Job and more**\n` +
                `- **Player Crasher**\n` +
                `- **Ham Mafia needed**\n` +
                `- **Official Reseller**\n\n` +
                `__Prices:__\n\n` +
                `> <:vanity:1445053213127606323> Week = 9,99€\n` +
                `> <:vanity:1445053213127606323> Month = 19,99€\n` +
                `> <:vanity:1445053213127606323> Lifetime = 29,99€\n\n` +
                `Klicke auf den Button oder öffne ein Ticket, um zu kaufen!`,
            button: {
                label: 'Website Vanity',
                url: 'https://modzilla.shop/product/vanity-menu'
            }
        },
        hamwoofer: {
            title: '## Ham Woofer',
            content:
                `- **Best Spoofer**\n` +
                `- **Unban all Anticheats**\n` +
                `- **Unban Global bans**\n` +
                `- **Unban Tx admin**\n` +
                `- **Unban Easy admin**\n` +
                `- **Undetected**\n\n` +
                `__Prices:__\n\n` +
                `> <:Ham:1444118311464997038> Week = 6,99€\n` +
                `> <:Ham:1444118311464997038> Month = 13,99€\n` +
                `> <:Ham:1444118311464997038> Lifetime = 37,99€\n\n` +
                `Klicke auf den Button oder öffne ein Ticket, um zu kaufen!`,
            button: {
                label: 'Website Ham Woofer',
                url: 'https://modzilla.shop/product/ham-spoofer'
            }
        },
        hamvanity: {
            title: '## Ham Mafia + Vanity Bundle',
            content:
                `- **Best Executor**\n` +
                `- **Premium Menus**\n` +
                `- **Undetected**\n` +
                `- **Official Reseller**\n\n` +
                `__Prices:__\n\n` +
                `> <:vanity:1445053213127606323> <:Ham:1444118311464997038> Week = 19,99€\n` +
                `> <:vanity:1445053213127606323> <:Ham:1444118311464997038> Month = 34,99€\n` +
                `> <:vanity:1445053213127606323> <:Ham:1444118311464997038> Lifetime = 59,99€\n\n` +
                `Klicke auf den Button oder öffne ein Ticket, um zu kaufen!`,
            button: {
                label: 'Website Bundle',
                url: 'https://modzilla.shop/product/ham-vanity-bundle'
            }
        },
        accounts: {
            title: '## Accounts',
            content:
                `- **Best Quality**\n` +
                `- **Cheap**\n` +
                `- **Detailed Account Informations**\n\n` +
                `__Prices:__\n\n` +
                `> <:discord:1445425100659888222> Discord = 0,40€\n` +
                `> <:steam:1445425125016076323> Steam = 0,10€\n` +
                `> <:fivem:1445425147065401517> Fivem = 0,40€\n\n` +
                `Klicke auf den Button oder öffne ein Ticket, um zu kaufen!`, 
            button: {
                label: 'Website',
                url: 'https://modzilla.shop/'
            }
        },
        payments: {
            title: '## Zahlungsmethoden',
            content:
                `- **German PaysafeCard**\n` +
                `- **Bank transfer (Instant)**\n` +
                `- **PayPal F&F**\n` +
                `- **Crypto: Litecoin, Bitcoin**\n` +
                `- **Apple Pay**`
        }
    };

    async function handleEmbedCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const templateName = interaction.options.getString('vorlage');
        const targetChannel = interaction.options.getChannel('kanal') || interaction.channel;

        if (!templateName) {
            const availableTemplates = Object.keys(embedTemplates).join(', ');
            return interaction.reply({
                content: `<:close:1434661746643308675> Bitte gib eine gültige Vorlage an!\n\n**Verfügbare Vorlagen:** ${availableTemplates}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const template = embedTemplates[templateName.toLowerCase()];

        if (!template) {
            const availableTemplates = Object.keys(embedTemplates).join(', ');
            return interaction.reply({
                content: `<:close:1434661746643308675> Vorlage "${templateName}" nicht gefunden!\n\n**Verfügbare Vorlagen:** ${availableTemplates}`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const embedContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${template.title}**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(template.content))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            // Optionaler Shop-/Produktlink-Button
            if (template.button?.url) {
                embedContainer.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel(template.button.label || 'Zum Produkt')
                            .setStyle(ButtonStyle.Link)
                            .setURL(template.button.url)
                    )
                );
            }

            await targetChannel.send({
                content: '',
                components: [embedContainer],
                flags: MessageFlags.IsComponentsV2
            });

            await sendLog(
                'Embed Gesendet',
                `**Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Vorlage:** ${templateName}\n**Kanal:** <#${targetChannel.id}>`,
                '<:info:1434647594457497784>'
            ).catch((err) => console.error('Log-Fehler:', err));

            await interaction.editReply({
                content: `<:haken:1434664861664804875> Embed erfolgreich in <#${targetChannel.id}> gesendet!`
            });
        } catch (error) {
            console.error('Fehler beim Senden des Embeds:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Senden des Embeds!'
            });
        }
    }

    return {
        commandHandlers: {
            embed: handleEmbedCommand
        }
    };
}

module.exports = {
    createEmbedFeature
};

