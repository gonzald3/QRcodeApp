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
        const cleanLocationId = (id) => {
            return id.replace(/[^a-zA-Z0-9\-]/g, '-');  // Replace non-alphanumeric characters with a dash
        };
        


        await Location.insertMany([
            { locationId: cleanLocationId('Dewey-South-Poles'), name: 'Electrical poles outside South Station' },
            { locationId: cleanLocationId('UMass-Boston-Campus'), name: 'Wheatley, McCormack, UHall, Campus Center, UMass Boston' },
            { locationId: cleanLocationId('Harvard-Sq'), name: 'Harvard Sq.' },
            { locationId: cleanLocationId('Boston-Wharfs'), name: 'Boston Wharfs' },
            { locationId: cleanLocationId('Fish-Pier-Small-Trucks'), name: 'Fish Pier: Commercial Seafood, Small Trucks' },
            { locationId: cleanLocationId('Long-Wharf-Hangout'), name: 'Long Wharf  Columbus Park: General Hangout' },
            { locationId: cleanLocationId('Battery-Wharf-Strike'), name: 'Battery Wharf: Hotel with workers on strike, Local 26' },
            { locationId: cleanLocationId('Red-Line-Stops'), name: 'Red Line Stops Alewife, Harvard, Andrew, JFK, Fields Corner, Quincy Center, Ashmont' },
            { locationId: cleanLocationId('Blue-Line-Stops'), name: 'Blue Line Stops (Maverick, Airport, Revere Beach, Wonderland)' },
            { locationId: cleanLocationId('Revere-Beach'), name: 'Revere Beach & Shirley Ave.' },
            { locationId: cleanLocationId('Orange-Line-Stops'), name: 'Orange Line Stops (Oak Grove, Malden Center, Sullivan Sq., Community College, Ruggles, Forest Hills)' },
            { locationId: cleanLocationId('Green-Line-Boston'), name: 'Green Line Stops (B line - Boston College & Boston University)' },
            { locationId: cleanLocationId('Working-Class-Areas'), name: 'Working-Class Areas (Revere, Lynn, Lawrence, Lowell, North Andover; New Bedford, Fall River)' },
            { locationId: cleanLocationId('Wellesley-College'), name: 'Wellesley College (Women\'s College)' }
        ]);


        console.log('Data seeded');
        process.exit();
    })
    .catch(err => {
        console.error('Error seeding data:', err);
        process.exit(1);
    });
