function createIdGenerator(prefix) {
  let counter = 1;
  return () => `${prefix}_${counter++}`;
}

function matchesFilter(doc, filter = {}) {
  const entries = Object.entries(filter || {});
  return entries.every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$nin)) {
      return !value.$nin.includes(doc[key]);
    }
    return doc[key] === value;
  });
}

function applyUpdate(doc, update = {}) {
  if (update.$set && typeof update.$set === 'object') {
    Object.assign(doc, update.$set);
  }

  if (update.$inc && typeof update.$inc === 'object') {
    for (const [key, incValue] of Object.entries(update.$inc)) {
      const current = Number(doc[key] || 0);
      doc[key] = current + Number(incValue || 0);
    }
  }

  const directUpdates = { ...update };
  delete directUpdates.$set;
  delete directUpdates.$inc;
  Object.assign(doc, directUpdates);
}

function createBotModel() {
  const bots = [];
  const nextId = createIdGenerator('bot');

  return {
    async countDocuments(filter = {}) {
      return bots.filter(b => matchesFilter(b, filter)).length;
    },

    async find(filter = {}) {
      return bots.filter(b => matchesFilter(b, filter));
    },

    async updateMany(filter = {}, update = {}) {
      for (const bot of bots) {
        if (matchesFilter(bot, filter)) {
          applyUpdate(bot, update);
        }
      }
    },

    async findOneAndUpdate(filter = {}, update = {}, options = {}) {
      let doc = bots.find(b => matchesFilter(b, filter));

      if (!doc && options.upsert) {
        doc = {
          _id: nextId(),
          token: filter.token,
          status: 'offline',
          username: '',
          clientId: '',
          inviteLink: '',
          messagesSent: 0,
          successCount: 0,
          failCount: 0,
          lastUsed: null,
          createdAt: new Date()
        };
        bots.push(doc);
      }

      if (doc) {
        applyUpdate(doc, update);
      }

      return doc || null;
    },

    async findById(id) {
      return bots.find(b => b._id === id) || null;
    },

    async findByIdAndDelete(id) {
      const index = bots.findIndex(b => b._id === id);
      if (index === -1) return null;
      const [deleted] = bots.splice(index, 1);
      return deleted;
    },

    async findByIdAndUpdate(id, update = {}) {
      const doc = bots.find(b => b._id === id);
      if (!doc) return null;
      applyUpdate(doc, update);
      return doc;
    }
  };
}

function createBroadcastModel() {
  const broadcasts = [];
  const nextId = createIdGenerator('broadcast');

  function decorateBroadcast(doc) {
    doc.save = async () => doc;
    return doc;
  }

  return {
    async create(payload = {}) {
      const doc = decorateBroadcast({
        _id: nextId(),
        message: payload.message || '',
        status: payload.status || 'pending',
        startTime: payload.startTime || null,
        guildId: payload.guildId || '',
        endTime: payload.endTime || null,
        totalTarget: Number(payload.totalTarget || 0),
        successCount: Number(payload.successCount || 0),
        failCount: Number(payload.failCount || 0),
        processedUsers: Array.isArray(payload.processedUsers) ? payload.processedUsers : [],
        currentBotIndex: Number(payload.currentBotIndex || 0),
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        liveRecipients: Array.isArray(payload.liveRecipients) ? payload.liveRecipients : []
      });

      broadcasts.push(doc);
      return doc;
    },

    async findOne() {
      if (broadcasts.length === 0) return null;
      return decorateBroadcast(broadcasts[broadcasts.length - 1]);
    },

    async findLatestByStartTime() {
      if (broadcasts.length === 0) return null;
      const sorted = [...broadcasts].sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
        return bTime - aTime;
      });
      return decorateBroadcast(sorted[0]);
    },

    async deleteMany() {
      broadcasts.splice(0, broadcasts.length);
    }
  };
}

function createRecipientModel() {
  const recipients = [];

  return {
    async find() {
      return recipients;
    },

    async findOneAndUpdate(filter = {}, update = {}, options = {}) {
      let doc = recipients.find(r => matchesFilter(r, filter));

      if (!doc && options.upsert) {
        doc = {
          userId: filter.userId,
          lastSentAt: new Date(),
          sentCount: 0
        };
        recipients.push(doc);
      }

      if (doc) {
        applyUpdate(doc, update);
      }

      return doc || null;
    },

    async deleteMany() {
      recipients.splice(0, recipients.length);
    }
  };
}

function createMemoryModels() {
  return {
    Bot: createBotModel(),
    Broadcast: createBroadcastModel(),
    Recipient: createRecipientModel()
  };
}

module.exports = { createMemoryModels };
