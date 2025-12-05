#!/usr/bin/env node
/**
 * Simple slash command deploy script.
 * Usage: node scripts/deploy-commands.js [--guild <guildId>] [--clear]
 */
const { REST, Routes } = require('discord.js');
const path = require('path');
// Always load .env from workspace root (one level above this script),
// regardless of current working directory.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const {
  TOKEN,
  APPLICATION_ID,
  USE_GUILD_COMMANDS,
  COMMAND_GUILD_IDS,
  GUILD_ID,
  COMMAND_CLEAR_BEFORE_DEPLOY,
} = process.env;

if (!TOKEN || !APPLICATION_ID) {
  console.error('Missing TOKEN or APPLICATION_ID in .env');
  process.exit(1);
}

const argv = process.argv.slice(2);
function getArg(name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}
const guildArg = getArg('--guild');
const clearArg = argv.includes('--clear');

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function putWithRetry(route, body, { retries = 6, baseDelayMs = 1000 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout per request
      const res = await rest.put(route, { body, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (e) {
      attempt += 1;
      const headers = e?.response?.headers || {};
      const retryAfter = Number(headers['retry-after'] || headers['x-ratelimit-reset-after'] || 0);
      const isAbort = e.name === 'AbortError';
      const status = e.status ?? e.code;
      const isRateLimit = status === 429 || /rate limit/i.test(e.message || '') || e?.rawError?.code === 20028;
      const isTransientServer = typeof status === 'number' && status >= 500 && status < 600;
      const isTransient = isAbort || isRateLimit || isTransientServer;
      if (!isTransient || attempt > retries) {
        throw e;
      }
      let delay = retryAfter > 0 ? Math.ceil(retryAfter * 1000) : Math.min(30000, baseDelayMs * Math.pow(2, attempt - 1));
      // Add jitter to avoid thundering herd
      delay += Math.floor(Math.random() * 500);
      console.warn(`⚠️ PUT retry ${attempt}/${retries} after ${delay}ms (${isAbort ? 'timeout' : isRateLimit ? '429' : 'transient'})`);
      if (retryAfter || headers['x-ratelimit-limit']) {
        console.warn('[deploy] RateLimit headers:', {
          'x-ratelimit-limit': headers['x-ratelimit-limit'],
          'x-ratelimit-remaining': headers['x-ratelimit-remaining'],
          'x-ratelimit-reset': headers['x-ratelimit-reset'],
          'x-ratelimit-reset-after': headers['x-ratelimit-reset-after'],
          'retry-after': headers['retry-after'],
        });
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Load command payload from app code
const { getCommandDefinitions } = require('../src/commands/definitions');
const payload = getCommandDefinitions();

async function deployGlobal() {
  if (COMMAND_CLEAR_BEFORE_DEPLOY === 'true' || clearArg) {
    try {
      console.log('→ Clearing global commands …');
      await putWithRetry(Routes.applicationCommands(APPLICATION_ID), []);
      console.log('🧹 Cleared global commands');
    } catch (e) {
      console.warn('⚠️ Failed clearing global commands:', e.message);
    }
  }
  console.log(`[deploy] Sending ${payload.length} commands globally …`);
  const res = await putWithRetry(Routes.applicationCommands(APPLICATION_ID), payload);
  console.log(`✅ Global commands deployed (${Array.isArray(res) ? res.length : payload.length})`);
}

async function deployGuilds(guildIds) {
  for (const guildId of guildIds) {
    try {
      if (COMMAND_CLEAR_BEFORE_DEPLOY === 'true' || clearArg) {
        try {
          console.log(`→ Clearing commands for guild ${guildId} …`);
          await putWithRetry(Routes.applicationGuildCommands(APPLICATION_ID, guildId), []);
          console.log(`🧹 Cleared commands for guild ${guildId}`);
        } catch (e) {
          if (e.code === 50001 || e.status === 404) {
            console.warn(`⚠️ No access to guild ${guildId}; skipping`);
            continue;
          }
          throw e;
        }
      }
      console.log(`[deploy] Sending ${payload.length} commands to guild ${guildId} …`);
      const res = await putWithRetry(Routes.applicationGuildCommands(APPLICATION_ID, guildId), payload);
      console.log(`✅ Guild ${guildId} commands deployed (${Array.isArray(res) ? res.length : payload.length})`);
    } catch (e) {
      if (e.code === 50001 || e.status === 404 || e.message?.includes('Unknown Guild')) {
        console.warn(`⚠️ Guild ${guildId} not found or no access; skipping`);
        continue;
      }
      console.error(`❌ Error deploying for guild ${guildId}:`, e.message);
    }
  }
}

(async () => {
  try {
    const useGuild = (USE_GUILD_COMMANDS === 'true') || !!guildArg;
    if (!useGuild) {
      await deployGlobal();
    } else {
      const ids = (guildArg ? guildArg : (COMMAND_GUILD_IDS || GUILD_ID || '') )
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        console.warn('⚠️ No guild IDs provided; deploying globally instead');
        await deployGlobal();
      } else {
        await deployGuilds(ids);
      }
    }
  } catch (error) {
    console.error('❌ Deploy script failed:', error);
    process.exit(1);
  }
})();
