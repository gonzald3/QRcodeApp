// models/Ad.js
const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
    adId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    }
});

module.exports = mongoose.model('Ad', adSchema);
