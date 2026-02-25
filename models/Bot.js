const mongoose = require('mongoose');

const botSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    username: String,
    clientId: String,
    inviteLink: String,
    status: { type: String, enum: ['active', 'banned', 'offline'], default: 'offline' },
    messagesSent: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    lastUsed: Date
});

module.exports = mongoose.model('Bot', botSchema);
