const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true, // Ensures no duplicate scans for the same QR code per session
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

module.exports = mongoose.model('Scan', scanSchema);
