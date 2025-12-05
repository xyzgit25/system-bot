const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextInputBuilder,
    TextInputStyle,
    TextDisplayBuilder
} = require('discord.js');

function createPaypalFeature({ client, sendLog, env }) {
    async function handlePaypalCommand(interaction) {
        // Nur Admins dürfen den Command nutzen
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung, diesen Befehl zu verwenden!',
                flags: MessageFlags.Ephemeral
            });
        }

        const paypalEmail = env.PAYPAL_EMAIL;
        if (!paypalEmail) {
            return interaction.reply({
                content: '<:close:1434661746643308675> PAYPAL_EMAIL ist in der .env-Datei nicht gesetzt!',
                flags: MessageFlags.Ephemeral
            });
        }

        const modal = new ModalBuilder().setCustomId('paypal_modal').setTitle('PayPal Zahlung');

        const betragInput = new TextInputBuilder()
            .setCustomId('paypal_betrag')
            .setLabel('Betrag')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('z.B. 50.00 EUR')
            .setRequired(true)
            .setMaxLength(50);

        const firstRow = new ActionRowBuilder().addComponents(betragInput);

        modal.addComponents(firstRow);

        await interaction.showModal(modal);
    }

    async function handlePaypalModalSubmit(interaction) {
        const paypalEmail = env.PAYPAL_EMAIL;
        const betrag = interaction.fields.getTextInputValue('paypal_betrag');

        if (!paypalEmail) {
            return interaction.reply({
                content: '<:close:1434661746643308675> PAYPAL_EMAIL ist in der .env-Datei nicht gesetzt!',
                flags: MessageFlags.Ephemeral
            });
        }

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('paypal_akzeptieren')
                .setLabel('Akzeptieren')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:haken:1434664861664804875>'),
            new ButtonBuilder()
                .setCustomId('paypal_ablehnen')
                .setLabel('Ablehnen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:delete:1434661904743137280>'),
            new ButtonBuilder()
                .setCustomId('paypal_abbrechen')
                .setLabel('Abbrechen')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:close:1434661746643308675>')
        );

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## <:settings:1434660812395384870> PayPal Zahlung**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<:info:1434647594457497784> **Email:** ${paypalEmail}\n` +
                        `<:settings:1434660812395384870> **Betrag:** ${betrag}\n` +
                        `<:user:1434651323579502672> **Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addActionRowComponents(buttons);

        await interaction.reply({
            content: '',
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        await sendLog(
            'PayPal Zahlung Erstellt',
            `**Erstellt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Email:** ${paypalEmail}\n**Betrag:** ${betrag}\n**Kanal:** <#${interaction.channel.id}>`,
            '<:settings:1434660812395384870>'
        );
    }

    async function handlePaypalAkzeptieren(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const updatedContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## PayPal Zahlung - Akzeptiert**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<:haken:1434664861664804875> **Status:** Akzeptiert\n` + `• **Akzeptiert von:** <@${interaction.user.id}>`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.update({
            content: '',
            components: [updatedContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await sendLog(
            'PayPal Zahlung Akzeptiert',
            `**Akzeptiert von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Kanal:** <#${interaction.channel.id}>`,
            '<:haken:1434664861664804875>'
        );
    }

    async function handlePaypalAblehnen(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const updatedContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## PayPal Zahlung - Abgelehnt**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<:delete:1434661904743137280> **Status:** Abgelehnt\n` +
                        `• **Abgelehnt von:** <@${interaction.user.id}>\n` +
                        `• **Grund:** Nix angekommen`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.update({
            content: '',
            components: [updatedContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await sendLog(
            'PayPal Zahlung Abgelehnt',
            `**Abgelehnt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Grund:** Nix angekommen\n**Kanal:** <#${interaction.channel.id}>`,
            '<:delete:1434661904743137280>'
        );
    }

    async function handlePaypalAbbrechen(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diese Aktion!',
                flags: MessageFlags.Ephemeral
            });
        }

        const updatedContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## PayPal Zahlung - Abgebrochen**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<:close:1434661746643308675> **Status:** Abgebrochen\n` +
                        `• **Abgebrochen von:** <@${interaction.user.id}>\n` +
                        `• **Grund:** Abgebrochen wegen andere zahlungs art oder doch nicht kaufen`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.update({
            content: '',
            components: [updatedContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await sendLog(
            'PayPal Zahlung Abgebrochen',
            `**Abgebrochen von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Grund:** Abgebrochen wegen andere zahlungs art oder doch nicht kaufen\n**Kanal:** <#${interaction.channel.id}>`,
            '<:close:1434661746643308675>'
        );
    }

    return {
        commandHandlers: {
            paypal: handlePaypalCommand
        },
        buttonHandlers: {
            paypal_akzeptieren: handlePaypalAkzeptieren,
            paypal_ablehnen: handlePaypalAblehnen,
            paypal_abbrechen: handlePaypalAbbrechen
        },
        modalHandlers: {
            paypal_modal: handlePaypalModalSubmit
        }
    };
}

module.exports = {
    createPaypalFeature
};

