const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const setupCommand = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Richtet das Ticket-System ein')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false);

const regelnCommand = new SlashCommandBuilder()
    .setName('regeln')
    .setDescription('Sendet die Serverregeln in den Regeln-Kanal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false);

const giveawayCommand = new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Erstellt ein neues Giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) =>
        option.setName('dauer').setDescription('Dauer des Giveaways (z.B. 1h, 30m, 2d)').setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName('gewinner')
            .setDescription('Anzahl der Gewinner')
            .setRequired(true)
            .setMinValue(1)
    )
    .addStringOption((option) =>
        option.setName('preis').setDescription('Der zu gewinnende Preis').setRequired(true)
    )
    .addChannelOption((option) =>
        option.setName('kanal').setDescription('Kanal wo das Giveaway gesendet werden soll').setRequired(false)
    );

const giveawayRerollCommand = new SlashCommandBuilder()
    .setName('giveaway-reroll')
    .setDescription('Ziehe neue Gewinner für ein beendetes Giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) =>
        option
            .setName('nachricht_id')
            .setDescription('Nachrichten-ID oder -Link des Giveaway-Posts')
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option.setName('anzahl').setDescription('Wie viele neue Gewinner ziehen (Standard: 1)').setMinValue(1)
    );

const ticketRenameCommand = new SlashCommandBuilder()
    .setName('ticket-rename')
    .setDescription('Benennt das aktuelle Ticket um')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption((option) =>
        option
            .setName('name')
            .setDescription('Neuer Name für das Ticket (ohne Prefix, z.B. dein Anliegen)')
            .setRequired(true)
    );

const ticketAddCommand = new SlashCommandBuilder()
    .setName('ticket-add')
    .setDescription('Fügt einen User zu einem Ticket hinzu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('Der User der hinzugefügt werden soll').setRequired(true));

const ticketRemoveCommand = new SlashCommandBuilder()
    .setName('ticket-remove')
    .setDescription('Entfernt einen User aus einem Ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('Der User der entfernt werden soll').setRequired(true));

const rolleCommand = new SlashCommandBuilder()
    .setName('rolle')
    .setDescription('Gibt einem User eine oder mehrere Rollen oder entfernt sie')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('Der User dem die Rolle gegeben/entfernt werden soll').setRequired(true))
    .addStringOption((option) => option.setName('rollen').setDescription('Die Rollen (mit @ erwähnen oder ID)').setRequired(true))
    .addStringOption((option) =>
        option
            .setName('aktion')
            .setDescription('Rolle hinzufügen oder entfernen')
            .setRequired(true)
            .addChoices(
                { name: 'Hinzufügen', value: 'add' },
                { name: 'Entfernen', value: 'remove' }
            )
    );

const levelCommand = new SlashCommandBuilder()
    .setName('level')
    .setDescription('Zeigt dein Level und XP an')
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('User dessen Level angezeigt werden soll (optional)'));

const bewerbungCommand = new SlashCommandBuilder()
    .setName('bewerbung')
    .setDescription('Startet das Bewerbungsformular für Teambewerbungen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false);

const paypalCommand = new SlashCommandBuilder()
    .setName('paypal')
    .setDescription('Erstellt eine PayPal-Zahlungsanfrage')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false);

const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Zeigt Bot-Statistiken an (Tickets, Giveaways, aktive User)')
    .setDMPermission(false);

const altBypassCommand = new SlashCommandBuilder()
    .setName('alt-bypass')
    .setDescription('Setzt oder entfernt einen Alt-Detection-Bypass für einen User')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) =>
        option
            .setName('user')
            .setDescription('User, der von der Alt-Detection ausgenommen/entfernt werden soll')
            .setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName('action')
            .setDescription('Aktion: add = hinzufügen, remove = entfernen, toggle = umschalten')
            .setRequired(false)
            .addChoices(
                { name: 'Hinzufügen', value: 'add' },
                { name: 'Entfernen', value: 'remove' },
                { name: 'Toggle', value: 'toggle' }
            )
    );
const staffCommand = new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Zeigt die aktuelle Staff-Liste anhand der konfigurierten Rollen')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false);

const giveawayListCommand = new SlashCommandBuilder()
    .setName('giveaway-list')
    .setDescription('Zeigt alle aktiven Giveaways an')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false);

const levelLeaderboardCommand = new SlashCommandBuilder()
    .setName('level-leaderboard')
    .setDescription('Zeigt die Top 10 User nach Level an')
    .setDMPermission(false);

const warnCommand = new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnt einen User')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('Der zu verwarnende User').setRequired(true))
    .addStringOption((option) => option.setName('grund').setDescription('Grund für die Verwarnung').setRequired(false));

const serverinfoCommand = new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Zeigt Server-Statistiken an')
    .setDMPermission(false);

const userinfoCommand = new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Zeigt Informationen über einen User an')
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('User dessen Informationen angezeigt werden sollen (optional)').setRequired(false));

const giveawayEditCommand = new SlashCommandBuilder()
    .setName('giveaway-edit')
    .setDescription('Bearbeitet ein aktives Giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) =>
        option.setName('nachricht_id').setDescription('Nachrichten-ID oder -Link des Giveaway-Posts').setRequired(true)
    )
    .addStringOption((option) => option.setName('preis').setDescription('Neuer Preis (optional)').setRequired(false))
    .addIntegerOption((option) => option.setName('gewinner').setDescription('Neue Anzahl der Gewinner (optional)').setMinValue(1).setRequired(false));

const giveawayDeleteCommand = new SlashCommandBuilder()
    .setName('giveaway-delete')
    .setDescription('Löscht ein Giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) =>
        option.setName('nachricht_id').setDescription('Nachrichten-ID oder -Link des Giveaway-Posts').setRequired(true)
    );

const levelResetCommand = new SlashCommandBuilder()
    .setName('level-reset')
    .setDescription('Setzt das Level eines Users zurück')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('User dessen Level zurückgesetzt werden soll').setRequired(true));

const botStatusCommand = new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Zeigt den Bot-Status und Health-Check an')
    .setDMPermission(false);

const roleAllCommand = new SlashCommandBuilder()
    .setName('roleall')
    .setDescription('Fügt allen Mitgliedern eine Rolle hinzu oder entfernt sie')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addRoleOption((option) =>
        option.setName('role').setDescription('Rolle die hinzugefügt/entfernt werden soll').setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName('action')
            .setDescription('Aktion: add = hinzufügen, remove = entfernen')
            .setRequired(true)
            .addChoices(
                { name: 'Hinzufügen', value: 'add' },
                { name: 'Entfernen', value: 'remove' }
            )
    );

const stickyCommand = new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Verwaltet Sticky-Nachrichten in Kanälen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
        subcommand
            .setName('set')
            .setDescription('Setzt oder aktualisiert eine Sticky-Nachricht im aktuellen Kanal')
            .addStringOption((option) =>
                option
                    .setName('text')
                    .setDescription('Text der Sticky-Nachricht')
                    .setRequired(true)
            )
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('clear')
            .setDescription('Entfernt die Sticky-Nachricht im aktuellen Kanal')
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('show')
            .setDescription('Zeigt die aktuell gesetzte Sticky-Nachricht für diesen Kanal an')
    );

const pollCommand = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Erstellt eine Umfrage')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((option) =>
        option
            .setName('frage')
            .setDescription('Frage der Umfrage')
            .setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName('optionen')
            .setDescription('Antwortoptionen, getrennt mit , ; oder | (mind. 2, max. 5)')
            .setRequired(true)
    )
    .addChannelOption((option) =>
        option
            .setName('kanal')
            .setDescription('Kanal, in dem die Umfrage gesendet werden soll (Standard: aktueller Kanal)')
            .setRequired(false)
    );

const backupCommand = new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Verwaltet Backups der Bot-Daten')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
        subcommand
            .setName('create')
            .setDescription('Erstellt ein manuelles Backup aller Daten')
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('list')
            .setDescription('Zeigt alle verfügbaren Backups an')
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('restore')
            .setDescription('Stellt ein Backup wieder her')
            .addStringOption((option) =>
                option
                    .setName('backup_name')
                    .setDescription('Name des Backups (z.B. 2024-01-15_14-30-00)')
                    .setRequired(true)
            )
    );

const embedCommand = new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Sendet ein vordefiniertes Embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((option) =>
        option
            .setName('vorlage')
            .setDescription('Die Embed-Vorlage die gesendet werden soll')
            .setRequired(true)
            .addChoices(
                { name: 'Ham', value: 'ham' },
                { name: 'Vanity', value: 'vanity' },
                { name: 'Ham Woofer', value: 'hamwoofer' },
                { name: 'Ham + Vanity Bundle', value: 'hamvanity' },
                { name: 'Accounts', value: 'accounts' },
                { name: 'Zahlungsmethoden', value: 'payments' }
            )
    )
    .addChannelOption((option) =>
        option
            .setName('kanal')
            .setDescription('Kanal wo das Embed gesendet werden soll (optional, Standard: aktueller Kanal)')
            .setRequired(false)
    );

const automodCommand = new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Zeigt das interaktive Automoderation-Panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false);

const commandDefinitions = [
    setupCommand,
    regelnCommand,
    giveawayCommand,
    giveawayRerollCommand,
    ticketRenameCommand,
    ticketAddCommand,
    ticketRemoveCommand,
    rolleCommand,
    levelCommand,
    bewerbungCommand,
    paypalCommand,
    statsCommand,
    altBypassCommand,
    staffCommand,
    giveawayListCommand,
    levelLeaderboardCommand,
    warnCommand,
    serverinfoCommand,
    userinfoCommand,
    giveawayEditCommand,
    giveawayDeleteCommand,
    levelResetCommand,
    botStatusCommand,
    roleAllCommand,
    automodCommand,
    embedCommand,
    stickyCommand,
    pollCommand,
    backupCommand
];

function getCommandDefinitions() {
    return commandDefinitions.map((command) => command.toJSON());
}

module.exports = {
    commandDefinitions,
    getCommandDefinitions
};

