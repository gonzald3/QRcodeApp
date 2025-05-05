const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
  code: String,
  adId: String,
  locationId: String,
  locationName: String,
  userSessionId: String,
  ipAddress: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now }
});

const Scan = mongoose.model('Scan', scanSchema);

module.exports = Scan;
