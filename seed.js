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
            { locationId: 'Dewey Sq South Station', name: 'Electrical poles South Station' },
            { locationId: 'UMass Boston', name: 'Wheatley, McCormack, UHall, Campus Center' },
            { locationId: 'Harvard Sq', name: 'Harvard Sq' },
            { locationId: 'Boston Wharfs', name: 'Boston Wharfs' },
            { locationId: 'Fish Pier', name: 'Fish Pier Commercial Seafood Small Trucks' },
            { locationId: 'Long Wharf Columbus Park', name: 'Long Wharf and Columbus Park' },
            { locationId: 'Battery Wharf', name: 'Battery Wharf Hotel with workers on strike Local 26' },
          
            { locationId: 'Red Alewife', name: 'Red Line Alewife' },
            { locationId: 'Red Harvard', name: 'Red Line Harvard' },
            { locationId: 'Red Andrew', name: 'Red Line Andrew' },
            { locationId: 'Red JFK', name: 'Red Line JFK' },
            { locationId: 'Red Fields Corner', name: 'Red Line Fields Corner' },
            { locationId: 'Red Quincy Center', name: 'Red Line Quincy Center' },
            { locationId: 'Red Ashmont', name: 'Red Line Ashmont' },
          
            { locationId: 'Blue Maverick', name: 'Blue Line Maverick' },
            { locationId: 'Blue Airport', name: 'Blue Line Airport' },
            { locationId: 'Blue Revere Beach', name: 'Blue Line Revere Beach' },
            { locationId: 'Blue Wonderland', name: 'Blue Line Wonderland' },
          
            { locationId: 'Revere Beach', name: 'Revere Beach and Shirley Ave' },
          
            { locationId: 'Orange Oak Grove', name: 'Orange Line Oak Grove' },
            { locationId: 'Orange Malden Center', name: 'Orange Line Malden Center' },
            { locationId: 'Orange Sullivan Sq', name: 'Orange Line Sullivan Sq' },
            { locationId: 'Orange Community College', name: 'Orange Line Community College' },
            { locationId: 'Orange Ruggles', name: 'Orange Line Ruggles' },
            { locationId: 'Orange Forest Hills', name: 'Orange Line Forest Hills' },
          
            { locationId: 'Green Boston College', name: 'Green Line B Boston College' },
            { locationId: 'Green Boston University', name: 'Green Line B Boston University' },
          
            { locationId: 'Revere', name: 'Working class area Revere' },
            { locationId: 'Lynn', name: 'Working class area Lynn' },
            { locationId: 'Lawrence', name: 'Working class area Lawrence' },
            { locationId: 'Lowell', name: 'Working class area Lowell' },
            { locationId: 'North Andover', name: 'Working class area North Andover' },
            { locationId: 'New Bedford', name: 'Working class area New Bedford' },
            { locationId: 'Fall River', name: 'Working class area Fall River' },
          
            { locationId: 'Wellesley College', name: 'Wellesley College womens college' }
          ]);
          

        console.log('Data seeded');
        process.exit();
    })
    .catch(err => {
        console.error('Error seeding data:', err);
        process.exit(1);
    });
