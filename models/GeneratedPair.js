const mongoose = require('mongoose');

const generatedPairSchema = new mongoose.Schema({
    adId: { type: String, required: true },
    locationId: { type: String, required: true },
}, { timestamps: true });

generatedPairSchema.index({ adId: 1, locationId: 1 }, { unique: true });

module.exports = mongoose.model('GeneratedPair', generatedPairSchema);
