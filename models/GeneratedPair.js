// models/GeneratedPair.js
const mongoose = require('mongoose');

const generatedPairSchema = new mongoose.Schema({
    adId: { 
        type: String, 
        required: true 
    },
    locationId: { 
        type: String, 
        required: true 
    },
    customUrl: {
        type: String,
        default: null,
        validate: {
            validator: function(v) {
                // Only validate if a URL is provided
                if (!v) return true;
                try {
                    new URL(v);
                    return true;
                } catch (err) {
                    return false;
                }
            },
            message: props => `${props.value} is not a valid URL!`
        }
    },
    defaultRedirect: {
        type: String,
        default: 'https://acp.us'
    }
}, { 
    timestamps: true 
});

generatedPairSchema.index({ adId: 1, locationId: 1 }, { unique: true });

module.exports = mongoose.model('GeneratedPair', generatedPairSchema);