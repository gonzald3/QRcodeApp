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
        // Insert initial locations with shortened IDs
        await Location.insertMany([
            { locationId: 'Dewey-South-Poles', name: 'Electrical poles outside South Station' },
            { locationId: 'UMass-Boston-Campus', name: 'Wheatley, McCormack, UHall, Campus Center, UMass Boston' },
            { locationId: 'Harvard-Sq', name: 'Harvard Sq.' },
            { locationId: 'Boston-Wharfs', name: 'Boston Wharfs' },
            { locationId: 'Fish-Pier-Small-Trucks', name: 'Fish Pier: Commercial Seafood, Small Trucks' },
            { locationId: 'Long-Wharf-Hangout', name: 'Long Wharf / Columbus Park: General Hangout' },
            { locationId: 'Battery-Wharf-Strike', name: 'Battery Wharf: Hotel with workers on strike, Local 26' },
            { locationId: 'Red-Line-Stops', name: 'Red Line Stops (Alewife, Harvard, Andrew, JFK, Fields Corner, Quincy Center, Ashmont)' },
            { locationId: 'Blue-Line-Stops', name: 'Blue Line Stops (Maverick, Airport, Revere Beach, Wonderland)' },
            { locationId: 'Revere-Beach', name: 'Revere Beach & Shirley Ave.' },
            { locationId: 'Orange-Line-Stops', name: 'Orange Line Stops (Oak Grove, Malden Center, Sullivan Sq., Community College, Ruggles, Forest Hills)' },
            { locationId: 'Green-Line-Boston', name: 'Green Line Stops (B line - Boston College & Boston University)' },
            { locationId: 'Working-Class-Areas', name: 'Working-Class Areas (Revere, Lynn, Lawrence, Lowell, North Andover; New Bedford, Fall River)' },
            { locationId: 'Wellesley-College', name: 'Wellesley College (Women\'s College)' }
        ]);


        console.log('Data seeded');
        process.exit();
    })
    .catch(err => {
        console.error('Error seeding data:', err);
        process.exit(1);
    });
