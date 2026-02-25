const mongoose = require('mongoose');

const recipientSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    lastSentAt: { type: Date, default: Date.now },
    sentCount: { type: Number, default: 0 }
});

module.exports = mongoose.model('Recipient', recipientSchema);
