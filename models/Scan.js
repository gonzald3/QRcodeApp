const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
    },
    adId: String,
    locationId: String,
    locationName: String,
    userSessionId: String,
    ipAddress: String,
    userAgent: String,
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Create indexes for better query performance
scanSchema.index({ adId: 1 });
scanSchema.index({ locationId: 1 });
scanSchema.index({ userSessionId: 1 });
// ✅ Compound unique index to prevent duplicate scans per user per code
scanSchema.index({ code: 1, userSessionId: 1 }, { unique: true });
scanSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30 days


module.exports = mongoose.model('Scan', scanSchema);
