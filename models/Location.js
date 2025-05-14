// models/Location.js
const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
    locationId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    }
});

module.exports = mongoose.model('Location', locationSchema);
