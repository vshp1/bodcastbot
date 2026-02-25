require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./config');
const botManager = require('./botManager');
const MongoBot = require('./models/Bot');
const MongoBroadcast = require('./models/Broadcast');
const MongoRecipient = require('./models/Recipient');
const { createMemoryModels } = require('./storage/memoryModels');
const { startWebServer } = require('./web/server');

const MONGO_URI = config.MONGO_URI || 'mongodb://localhost:27017/discord-broadcast';
const SHOULD_USE_MONGO = String(process.env.USE_MONGO || '').toLowerCase() === 'true';

function sanitizeConfigTokens(tokens = []) {
  const placeholders = new Set([
    'TOKEN_1_HERE',
    'TOKEN_2_HERE',
    'PUT_TOKEN_1_HERE',
    'PUT_TOKEN_2_HERE'
  ]);
  return tokens.filter(token => token && !placeholders.has(token));
}

async function initModels() {
  if (!SHOULD_USE_MONGO) {
    console.log('MongoDB disabled (USE_MONGO is not true). Running with in-memory storage.');
    return createMemoryModels();
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  return { Bot: MongoBot, Broadcast: MongoBroadcast, Recipient: MongoRecipient };
}

async function main() {
  try {
    const models = await initModels();
    botManager.setModels(models);

    if (config.BOT_TOKENS && Array.isArray(config.BOT_TOKENS)) {
      console.log('Syncing bots with config...');
      const configTokens = sanitizeConfigTokens(config.BOT_TOKENS);

      await models.Bot.updateMany({ token: { $nin: configTokens } }, { status: 'offline' });

      for (const token of configTokens) {
        await botManager.addBot(token);
      }
    }

    await startWebServer({
      config,
      botManager,
      Bot: models.Bot,
      Broadcast: models.Broadcast
    });
  } catch (err) {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  }
}

main();
