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

function createPollFeature({ client, sendLog }) {
    const { map: polls, load: loadPollMap, save: savePollMap } = createJsonBackedMap('polls.json');

    async function loadPollData() {
        try {
            await loadPollMap();
            console.log(`✅ ${polls.size} Umfragen geladen`);
        } catch (error) {
            console.error('Fehler beim Laden der Umfragen:', error);
        }
    }

    async function savePollData() {
        await savePollMap();
    }

    function generatePollId() {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }

    function buildPollContainer(poll) {
        const { question, options } = poll;

        let content = `**## <:gewinner:1434717035698585650> Umfrage**\n`;
        content += `<:support:1440357360961847389> **Frage:** ${question}\n\n`;
        content += `<:info:1434647594457497784> **Optionen:**\n`;

        options.forEach((opt, index) => {
            const count = opt.votes || 0;
            content += `• \`${index + 1}\` ${opt.label} — **${count}** Stimme${count === 1 ? '' : 'n'}\n`;
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        const buttons = options.map((opt, index) =>
            new ButtonBuilder()
                .setCustomId(`poll|${poll.id}|${index}`)
                .setLabel(opt.label.slice(0, 80))
                .setStyle(ButtonStyle.Secondary)
        );

        // Max. 5 Buttons pro Row → unsere Obergrenze für Optionen ist 5
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));

        return container;
    }

    async function handlePollCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const question = interaction.options.getString('frage', true);
        const rawOptions = interaction.options.getString('optionen', true);
        const targetChannel = interaction.options.getChannel('kanal') || interaction.channel;

        const parts = rawOptions
            .split(/[,;|]/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);

        if (parts.length < 2) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du musst mindestens **2 Optionen** angeben (getrennt mit , ; oder |).',
                flags: MessageFlags.Ephemeral
            });
        }

        if (parts.length > 5) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Maximal **5 Optionen** sind erlaubt!',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const pollId = generatePollId();
            const poll = {
                id: pollId,
                guildId: interaction.guild.id,
                channelId: targetChannel.id,
                messageId: null,
                question,
                options: parts.map((label) => ({ label, votes: 0 })),
                votes: {} // userId -> optionIndex
            };

            const container = buildPollContainer(poll);

            const message = await targetChannel.send({
                content: '',
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            poll.messageId = message.id;
            polls.set(pollId, poll);
            await savePollData();

            await sendLog(
                'Umfrage erstellt',
                `**Frage:** ${question}\n**Optionen:** ${parts.join(', ')}\n**Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${targetChannel.id}>`,
                '<:info:1434647594457497784>'
            ).catch(() => {});

            await interaction.editReply({
                content: `<:haken:1434664861664804875> Umfrage wurde in <#${targetChannel.id}> erstellt!`
            });
        } catch (error) {
            console.error('Fehler beim Erstellen der Umfrage:', error);
            await interaction.editReply({
                content: '<:close:1434661746643308675> Fehler beim Erstellen der Umfrage!'
            });
        }
    }

    async function handlePollVote(interaction) {
        const parts = interaction.customId.split('|');
        if (parts.length !== 3 || parts[0] !== 'poll') return;

        const pollId = parts[1];
        const optionIndex = parseInt(parts[2], 10);
        const poll = polls.get(pollId);

        if (!poll) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Diese Umfrage existiert nicht mehr.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!poll.options[optionIndex]) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Diese Option ist ungültig.',
                flags: MessageFlags.Ephemeral
            });
        }

        const userId = interaction.user.id;
        const previousIndex = poll.votes[userId];

        if (previousIndex === optionIndex) {
            // Stimme zurückziehen
            delete poll.votes[userId];
            poll.options[optionIndex].votes = Math.max(0, (poll.options[optionIndex].votes || 0) - 1);
        } else {
            // Alte Stimme entfernen, falls vorhanden
            if (typeof previousIndex === 'number' && poll.options[previousIndex]) {
                poll.options[previousIndex].votes = Math.max(
                    0,
                    (poll.options[previousIndex].votes || 0) - 1
                );
            }

            poll.votes[userId] = optionIndex;
            poll.options[optionIndex].votes = (poll.options[optionIndex].votes || 0) + 1;
        }

        polls.set(pollId, poll);
        await savePollData();

        try {
            const channel = await client.channels.fetch(poll.channelId).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
                if (msg) {
                    const container = buildPollContainer(poll);
                    await msg.edit({
                        content: '',
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });
                }
            }
        } catch (error) {
            console.error('Fehler beim Aktualisieren der Umfrage:', error);
        }

        return interaction.reply({
            content:
                previousIndex === optionIndex
                    ? '<:info:1434647594457497784> Deine Stimme wurde entfernt.'
                    : `<:haken:1434664861664804875> Deine Stimme wurde gezählt für: **${poll.options[optionIndex].label}**`,
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        polls,
        loadPollData,
        savePollData,
        commandHandlers: {
            poll: handlePollCommand
        },
        handlePollVote
    };
}

module.exports = {
    createPollFeature
};


