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

    // Configurable escalation settings
    const WARNING_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const ESCALATION_THRESHOLD = 3; // warnings within window
    const ESCALATION_PUNISHMENT = {
        type: 'timeout', // discord "timed out" (mute)
        durationMs: 24 * 60 * 60 * 1000 // 24h
    };

    async function loadModerationData() {
        await loadWarnings();
        console.log(`✅ ${warnings.size} Warnungen geladen`);
    }

    function getUserWarnings(userId, guildId) {
        const key = `${guildId}-${userId}`;
        return warnings.get(key) || { count: 0, warnings: [] };
    }

    function pruneExpiredWarnings(userWarnings) {
        const now = Date.now();
        const valid = (userWarnings.warnings || []).filter(w => (now - (w.timestamp || now)) <= WARNING_EXPIRY_MS);
        const pruned = { count: valid.length, warnings: valid };
        return pruned;
    }

    function addWarning(userId, guildId, moderatorId, reason) {
        const key = `${guildId}-${userId}`;
        let userWarnings = getUserWarnings(userId, guildId);
        // prune first to ensure accurate count
        userWarnings = pruneExpiredWarnings(userWarnings);
        
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

    function shouldEscalate(userWarnings) {
        // Count warnings within expiry window
        const now = Date.now();
        const recent = (userWarnings.warnings || []).filter(w => (now - (w.timestamp || now)) <= WARNING_EXPIRY_MS);
        return recent.length >= ESCALATION_THRESHOLD;
    }

    async function applyEscalation(interaction, targetUser, correlationId) {
        if (!interaction.guild) return false;
        try {
            if (ESCALATION_PUNISHMENT.type === 'timeout') {
                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                if (!member) return false;
                const until = Date.now() + ESCALATION_PUNISHMENT.durationMs;
                await member.timeout(ESCALATION_PUNISHMENT.durationMs, `Auto-escalation due to warnings (${correlationId})`).catch(() => {});
                await sendLog(
                    'Auto Eskalation (Timeout)',
                    `**User:** <@${targetUser.id}> (${targetUser.tag})\n**Dauer:** ${(ESCALATION_PUNISHMENT.durationMs/3600000)}h\n**Grund:** Erreichte Warnschwelle innerhalb 30 Tagen`,
                    '<:info:1434647594457497784>'
                );
                return true;
            }
        } catch (error) {
            // ignore escalation failures
        }
        return false;
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
            const dmContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('**## <:info:1434647594457497784> Verwarnung**')
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `• <:user:1434651323579502672> **Server:** ${interaction.guild.name}\n` +
                        `• <:info:1434647594457497784> **Grund:** ${reason}\n` +
                        `• <:haken:1434664861664804875> **Anzahl Verwarnungen:** ${userWarnings.count}\n` +
                        `• <:settings:1434660812395384870> **Verwarnt von:** <@${interaction.user.id}>`
                    )
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing('Small'));

            await targetUser.send({
                content: '',
                components: [dmContainer],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        } catch (error) {
            // DM konnte nicht gesendet werden, ignorieren
        }
        // Auto escalation if threshold reached
        if (shouldEscalate(userWarnings)) {
            await applyEscalation(interaction, targetUser);
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

