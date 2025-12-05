const { Client, GatewayIntentBits } = require('discord.js');

function createClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildPresences
        ]
    });
}

module.exports = {
    createClient
};

