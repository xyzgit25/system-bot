const {
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { createJsonBackedMap } = require('../../services/jsonStore');

function createModerationFeature({ client, sendLog }) {
    const { map: warnings, load: loadWarnings, save: saveWarnings } = createJsonBackedMap('warnings.json');

    async function loadModerationData() {
        await loadWarnings();
        console.log(`✅ ${warnings.size} Warnungen geladen`);
    }

    function getUserWarnings(userId, guildId) {
        const key = `${guildId}-${userId}`;
        return warnings.get(key) || { count: 0, warnings: [] };
    }

    function addWarning(userId, guildId, moderatorId, reason) {
        const key = `${guildId}-${userId}`;
        const userWarnings = getUserWarnings(userId, guildId);
        
        userWarnings.count = (userWarnings.count || 0) + 1;
        userWarnings.warnings = userWarnings.warnings || [];
        userWarnings.warnings.push({
            moderatorId,
            reason: reason || 'Kein Grund angegeben',
            timestamp: Date.now()
        });

        warnings.set(key, userWarnings);
        return userWarnings;
    }

    async function handleWarnCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du hast keine Berechtigung für diesen Befehl!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';

        if (targetUser.id === interaction.user.id) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du kannst dich nicht selbst verwarnen!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (targetUser.id === client.user.id) {
            return interaction.reply({
                content: '<:close:1434661746643308675> Du kannst den Bot nicht verwarnen!',
                flags: MessageFlags.Ephemeral
            });
        }

        const userWarnings = addWarning(targetUser.id, interaction.guild.id, interaction.user.id, reason);
        await saveWarnings();

        const warnContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**## <:info:1434647594457497784> Verwarnung**')
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `• <:user:1434651323579502672> **User:** <@${targetUser.id}> (${targetUser.tag})\n` +
                        `• <:settings:1434660812395384870> **Verwarnt von:** <@${interaction.user.id}> (${interaction.user.tag})\n` +
                        `• <:info:1434647594457497784> **Grund:** ${reason}\n` +
                        `• <:haken:1434664861664804875> **Anzahl Verwarnungen:** ${userWarnings.count}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

        await interaction.reply({
            content: '',
            components: [warnContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await sendLog(
            'User Verwarnung',
            `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Verwarnt von:** <@${interaction.user.id}> (${interaction.user.tag})\n**Grund:** ${reason}\n**Anzahl Verwarnungen:** ${userWarnings.count}`,
            '<:info:1434647594457497784>'
        );

        try {
            await targetUser.send(
                `<:info:1434647594457497784> **Du wurdest auf ${interaction.guild.name} verwarnt**\n\n` +
                    `**Grund:** ${reason}\n` +
                    `**Anzahl Verwarnungen:** ${userWarnings.count}\n` +
                    `**Verwarnt von:** ${interaction.user.tag}`
            ).catch(() => {});
        } catch (error) {
            // DM konnte nicht gesendet werden, ignorieren
        }
    }

    return {
        warnings,
        loadModerationData,
        getUserWarnings,
        commandHandlers: {
            warn: handleWarnCommand
        }
    };
}

module.exports = {
    createModerationFeature
};

