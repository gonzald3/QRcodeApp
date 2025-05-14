// seed.js
const mongoose = require('mongoose');
const Ad = require('./models/Ad');
const Location = require('./models/Location');
// Load environment variables
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, { dbName: 'qrtrack' })
    .then(async () => {
        // Insert initial ads
        await Ad.insertMany([
            { adId: 'fight-back', name: 'Fight Back' },
            { adId: 'pro-working', name: 'Pro Working' },
            { adId: 'tax-cut', name: 'Tax Cut' }
        ]);

        // Insert initial locations
        await Location.insertMany([
            { locationId: 'Dewey Sq. South Station', name: 'Electrical poles South Station' },
            { locationId: 'UMass Boston', name: 'Wheatley, McCormack, UHall, Campus Center' },
            { locationId: 'Hardvard Sq', name: 'Harvard Sq' },
            { locationId: 'Boston Wharfs', name: 'Boston Wharfs' },
            { locationId: 'GI Joe', name: 'GI Joe' },

        ]);

        console.log('Data seeded');
        process.exit();
    })
    .catch(err => {
        console.error('Error seeding data:', err);
        process.exit(1);
    });
