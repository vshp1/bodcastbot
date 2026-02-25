const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const DefaultBot = require('./models/Bot');
const DefaultBroadcast = require('./models/Broadcast');
const DefaultRecipient = require('./models/Recipient');
const config = require('./config');

const MESSAGE_QUOTA_PER_BOT = parseInt(process.env.MESSAGE_QUOTA_PER_BOT || '300', 10);
const LIVE_RECIPIENTS_LIMIT = 12;

class BotManager {
  constructor() {
    this.clients = new Map();
    this.status = 'idle';
    this.currentBroadcast = null;
    this.recipientCache = new Set();
    this.recipientCacheLoaded = false;
    this.io = null;
    this.Bot = DefaultBot;
    this.Broadcast = DefaultBroadcast;
    this.Recipient = DefaultRecipient;
  }

  setModels(models = {}) {
    if (models.Bot) this.Bot = models.Bot;
    if (models.Broadcast) this.Broadcast = models.Broadcast;
    if (models.Recipient) this.Recipient = models.Recipient;
  }

  async getLatestBroadcast() {
    if (typeof this.Broadcast.findLatestByStartTime === 'function') {
      return this.Broadcast.findLatestByStartTime();
    }

    const latest = await this.Broadcast.findOne().sort({ startTime: -1 });
    return latest;
  }

  async ensureRecipientCache() {
    if (this.recipientCacheLoaded) return;
    const recipients = await this.Recipient.find({}, 'userId');
    recipients.forEach(r => this.recipientCache.add(r.userId));
    this.recipientCacheLoaded = true;
  }

  async recordRecipient(member) {
    this.recipientCache.add(member.id);
    await this.Recipient.findOneAndUpdate(
      { userId: member.id },
      { $set: { lastSentAt: new Date() }, $inc: { sentCount: 1 } },
      { upsert: true }
    );
  }

  emitProgressUpdate() {
    if (!this.io || !this.currentBroadcast) return;
    this.io.emit('broadcastProgress', {
      successCount: this.currentBroadcast.successCount,
      failCount: this.currentBroadcast.failCount,
      totalTarget: this.currentBroadcast.totalTarget,
      status: this.currentBroadcast.status,
      liveRecipients: this.currentBroadcast.liveRecipients || [],
      guildId: this.currentBroadcast.guildId
    });
  }

  async addBot(token) {
    if (this.clients.has(token)) return;

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    try {
      await client.login(token);

      client.user.setActivity(config.BOT_STATUS_TEXT, {
        type: ActivityType.Streaming,
        url: config.STREAMING_URL
      });

      this.clients.set(token, client);
      const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

      await this.Bot.findOneAndUpdate(
        { token },
        {
          status: 'active',
          username: client.user.username,
          clientId: client.user.id,
          inviteLink
        },
        { upsert: true }
      );
      console.log(`Bot logged in: ${client.user.username}`);
    } catch (error) {
      console.error(`Failed to login bot with token: ${token.substring(0, 10)}...`);
      await this.Bot.findOneAndUpdate({ token }, { status: 'offline' }, { upsert: true });
    }
  }

  async removeBotClient(token) {
    const client = this.clients.get(token);
    if (client) {
      client.destroy();
      this.clients.delete(token);
    }
  }

  async startBroadcast(message, totalTarget, guildId) {
    if (this.status === 'running') throw new Error('Broadcast already running');

    const bots = await this.Bot.find({ status: 'active' });
    if (bots.length === 0) throw new Error('No active bots available');

    await this.ensureRecipientCache();

    this.status = 'running';
    this.currentBroadcast = await this.Broadcast.create({
      message,
      totalTarget,
      guildId,
      startTime: new Date(),
      status: 'running',
      successCount: 0,
      failCount: 0,
      processedUsers: [],
      liveRecipients: [],
      logs: [],
      currentBotIndex: 0
    });
    this.emitProgressUpdate();

    this.broadcastLoop(guildId);
  }

  async broadcastLoop(guildId) {
    const botsData = [...(await this.Bot.find({ status: 'active' }))].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aDate - bDate;
    });

    let processedMembers = new Set(this.currentBroadcast.processedUsers || []);
    let sentCount = this.currentBroadcast.successCount || 0;
    let currentBotIndex = 0;

    while (this.status === 'running' && sentCount < this.currentBroadcast.totalTarget && currentBotIndex < botsData.length) {
      const currentBotData = botsData[currentBotIndex];
      const client = this.clients.get(currentBotData.token);

      if (!client) {
        currentBotIndex++;
        continue;
      }

      this.logToDashboard(`Starting with Bot #${currentBotIndex + 1} (${client.user.username})`, currentBotData._id);

      let membersToMessage = [];
      let fetchSuccess = false;

      while (!fetchSuccess && this.status === 'running') {
        try {
          if (guildId) {
            const guild = await client.guilds.fetch(guildId);
            const fetchedMembers = await guild.members.fetch();
            membersToMessage = Array.from(fetchedMembers.values()).filter(
              m => !m.user.bot && !processedMembers.has(m.id) && !this.recipientCache.has(m.id)
            );
          } else {
            const guilds = client.guilds.cache;
            for (const [, guild] of guilds) {
              const fetchedMembers = await guild.members.fetch();
              fetchedMembers.forEach(m => {
                if (!m.user.bot && !processedMembers.has(m.id) && !this.recipientCache.has(m.id)) {
                  membersToMessage.push(m);
                }
              });
            }
          }
          fetchSuccess = true;
        } catch (err) {
          if (err.message.includes('rate limited')) {
            const retryAfter = err.message.match(/(\d+\.?\d*)/) ? parseFloat(err.message.match(/(\d+\.?\d*)/)[0]) : 30;
            this.logToDashboard(`Rate limited while fetching members. Waiting ${retryAfter}s...`, currentBotData._id, true);
            await new Promise(resolve => setTimeout(resolve, (retryAfter * 1000) + 2000));
          } else {
            this.logToDashboard(`Error fetching members: ${err.message}`, currentBotData._id, true);
            fetchSuccess = true;
          }
        }
      }

      let botSentThisRound = 0;
      let burstCounter = 0;
      let botBanned = false;

      for (const member of membersToMessage) {
        if (
          this.status !== 'running' ||
          sentCount >= this.currentBroadcast.totalTarget ||
          botSentThisRound >= MESSAGE_QUOTA_PER_BOT
        ) {
          break;
        }

        if (processedMembers.has(member.id)) continue;

        try {
          await member.send(this.currentBroadcast.message);
          const logMsg = `Sent to ${member.user.tag}`;
          this.logToDashboard(`Bot #${currentBotIndex + 1}: ${logMsg}`, currentBotData._id);

          sentCount++;
          botSentThisRound++;
          burstCounter++;

          processedMembers.add(member.id);
          this.currentBroadcast.successCount = sentCount;
          this.currentBroadcast.processedUsers.push(member.id);
          this.currentBroadcast.logs.push({ botId: currentBotData._id, message: logMsg, isError: false });

          await this.recordRecipient(member);

          const liveEntry = {
            id: member.id,
            tag: member.user.tag,
            botUsername: client.user.username
          };
          this.currentBroadcast.liveRecipients = this.currentBroadcast.liveRecipients || [];
          this.currentBroadcast.liveRecipients.unshift(liveEntry);
          if (this.currentBroadcast.liveRecipients.length > LIVE_RECIPIENTS_LIMIT) {
            this.currentBroadcast.liveRecipients.pop();
          }

          await this.Bot.findByIdAndUpdate(currentBotData._id, { $inc: { successCount: 1 }, lastUsed: new Date() });
          await this.currentBroadcast.save();

          this.emitProgressUpdate();

          if (burstCounter >= (config.MESSAGES_PER_BURST || 10)) {
            await new Promise(resolve => setTimeout(resolve, config.BURST_INTERVAL || 3000));
            burstCounter = 0;
          } else {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (error) {
          const errMsg = `Error sending to ${member.user.tag}: ${error.message}`;
          this.logToDashboard(`Bot #${currentBotIndex + 1}: ${errMsg}`, currentBotData._id, true);

          processedMembers.add(member.id);
          this.currentBroadcast.processedUsers.push(member.id);
          this.currentBroadcast.failCount++;
          this.currentBroadcast.logs.push({
            botId: currentBotData._id,
            message: `Failed: ${member.user.tag} (${error.message})`,
            isError: true
          });
          await this.currentBroadcast.save();

          this.emitProgressUpdate();

          if (error.status === 401 || error.message.includes('flagged') || error.message.includes('anti-spam')) {
            await this.Bot.findByIdAndUpdate(currentBotData._id, { status: 'banned' });
            const banReason = error.message.includes('flagged') ? 'Flagged by Anti-Spam' : 'Invalid Token (401)';
            this.logToDashboard(`Bot #${currentBotIndex + 1}: ${banReason}. Marked as banned.`, currentBotData._id, true);
            this.clients.delete(currentBotData.token);
            botBanned = true;
            break;
          }
        }
      }

      if (botBanned || botSentThisRound >= MESSAGE_QUOTA_PER_BOT) {
        currentBotIndex++;
        continue;
      }

      if (sentCount >= this.currentBroadcast.totalTarget) {
        break;
      }

      this.logToDashboard(`Bot #${currentBotIndex + 1} finished all available members in the guild.`);
      break;
    }

    let completionMsg = '';
    if (sentCount >= this.currentBroadcast.totalTarget) {
      completionMsg = `Success: Target reached (${sentCount})`;
      this.status = 'completed';
    } else if (this.status === 'stopped') {
      completionMsg = `Stopped: Broadcast was manually stopped. Total: ${sentCount}`;
      this.status = 'stopped';
    } else {
      completionMsg = `Finished: All available members have been messaged. Total: ${sentCount}`;
      this.status = 'finished';
    }

    this.currentBroadcast.status = this.status;
    this.currentBroadcast.endTime = new Date();
    await this.currentBroadcast.save();
    this.emitProgressUpdate();
    this.logToDashboard(completionMsg);
  }

  async checkGuildPresence(guildId) {
    const results = [];
    const botsData = await this.Bot.find({ status: 'active' });

    for (const botData of botsData) {
      const client = this.clients.get(botData.token);
      let inGuild = false;
      if (client) {
        try {
          await client.guilds.fetch(guildId);
          inGuild = true;
        } catch (e) {
          inGuild = false;
        }
      }
      results.push({
        botId: botData._id,
        inGuild
      });
    }
    return results;
  }

  setIo(io) {
    this.io = io;
  }

  stopBroadcast() {
    if (this.status === 'running') {
      this.status = 'stopped';
      this.logToDashboard('Broadcast manually stopped by user.', null, true);
    }
  }

  async resetStats() {
    try {
      await this.Bot.updateMany({}, { successCount: 0 });
      await this.Broadcast.deleteMany({});
      await this.Recipient.deleteMany({});
      this.recipientCache.clear();
      this.recipientCacheLoaded = false;
      this.currentBroadcast = null;
      this.logToDashboard('Statistics and logs have been reset.');
      return true;
    } catch (error) {
      console.error('Failed to reset stats:', error);
      throw error;
    }
  }

  logToDashboard(message, botId = null, isError = false) {
    console.log(message);
    if (this.io) {
      this.io.emit('liveLog', {
        message,
        botId,
        isError,
        timestamp: new Date()
      });
    }
  }
}

module.exports = new BotManager();
