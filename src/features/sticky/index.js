const {
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createStickyFeature({ client, sendLog }) {
    const { map: stickyMessages, load: loadStickyMap, save: saveStickyMap } = createJsonBackedMap(
        'sticky-messages.json'
    );

    function buildStickyContainer(text) {
        return new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**${text}**`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));
    }

    async function loadStickyData() {
        try {
            await loadStickyMap();
            console.log(`✅ ${stickyMessages.size} Sticky-Messages geladen`);
        } catch (error) {
            console.error('Fehler beim Laden der Sticky-Messages:', error);
        }
    }

    async function saveStickyData() {
        await saveStickyMap();
    }

    async function refreshStickyForChannel(channel) {
        const sticky = stickyMessages.get(channel.id);
        if (!sticky || !sticky.text) return;

        try {
            if (sticky.messageId) {
                const oldMessage = await channel.messages.fetch(sticky.messageId).catch(() => null);
                if (oldMessage) {
                    await oldMessage.delete().catch(() => {});
                }
            }

            const container = buildStickyContainer(sticky.text);

            const newMessage = await channel.send({
                content: '',
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            stickyMessages.set(channel.id, {
                text: sticky.text,
                messageId: newMessage.id
            });
            await saveStickyData();
        } catch (error) {
            console.error('Fehler beim Aktualisieren der Sticky-Message:', error);
        }
    }

    async function handleStickyCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const channel = interaction.channel;

        if (subcommand === 'set') {
            const text = interaction.options.getString('text', true);

            stickyMessages.set(channel.id, {
                text,
                messageId: null
            });

            await saveStickyData();
            await refreshStickyForChannel(channel);

            await sendLog(
                'Sticky gesetzt',
                `**Kanal:** <#${channel.id}>\n**Gesetzt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Text:** ${text}`,
                '<:info:1434647594457497784>'
            ).catch(() => {});

            return interaction.reply({
                content: '<:haken:1434664861664804875> Sticky-Nachricht für diesen Kanal gesetzt!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'clear') {
            const existing = stickyMessages.get(channel.id);

            if (existing?.messageId) {
                const oldMessage = await channel.messages.fetch(existing.messageId).catch(() => null);
                if (oldMessage) {
                    await oldMessage.delete().catch(() => {});
                }
            }

            stickyMessages.delete(channel.id);
            await saveStickyData();

            await sendLog(
                'Sticky entfernt',
                `**Kanal:** <#${channel.id}>\n**Entfernt von:** <@${interaction.user.id}> (${interaction.user.tag})`,
                '<:delete:1434661904743137280>'
            ).catch(() => {});

            return interaction.reply({
                content: '<:haken:1434664861664804875> Sticky-Nachricht für diesen Kanal entfernt!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'show') {
            const sticky = stickyMessages.get(channel.id);

            if (!sticky || !sticky.text) {
                return interaction.reply({
                    content: '<:info:1434647594457497784> Für diesen Kanal ist aktuell keine Sticky-Nachricht gesetzt.',
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.reply({
                content: `<:info:1434647594457497784> **Aktuelle Sticky-Nachricht:**\n${sticky.text}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    client.on('messageCreate', async (message) => {
        if (!message.guild || message.author.bot) return;

        const sticky = stickyMessages.get(message.channel.id);
        if (!sticky || !sticky.text) return;

        // Falls die Sticky selbst eine messageCreate auslöst, nichts tun
        if (sticky.messageId && message.id === sticky.messageId) return;

        await refreshStickyForChannel(message.channel);
    });

    return {
        stickyMessages,
        loadStickyData,
        saveStickyData,
        commandHandlers: {
            sticky: handleStickyCommand
        }
    };
}

module.exports = {
    createStickyFeature
};


