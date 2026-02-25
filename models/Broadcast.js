const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
    message: { type: String, required: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'paused', 'stopped', 'finished'], default: 'pending' },
    startTime: Date,
    guildId: String,
    endTime: Date,
    totalTarget: Number,
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    processedUsers: { type: [String], default: [] },
    currentBotIndex: { type: Number, default: 0 },
    logs: [{
        botId: mongoose.Schema.Types.ObjectId,
        timestamp: { type: Date, default: Date.now },
        message: String,
        isError: Boolean
    }],
    liveRecipients: { type: [mongoose.Schema.Types.Mixed], default: [] }
});

module.exports = mongoose.model('Broadcast', broadcastSchema);
