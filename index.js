require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const app = express();
const moment = require('moment');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const port = process.env.PORT || 5000;


// Set the trust proxy to handle correct IP forwarding when behind a proxy (like Heroku)
app.set('trust proxy', 1); // This is important when using Heroku or similar platforms

// Rate limit for tracking QR codes (POST /track)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 40, // Limit each IP to 40 requests per windowMs
    message: "Too many requests from this IP, please try again after 15 minutes"
});

// Rate limit for viewing scans (GET /scans)
const scanViewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Allow only 50 requests per 15 minutes for scan logs
    message: "Too many requests to view scan logs, please try again later",
});

// Rate limiter for both IP and session ID (hybrid limiter)
const hybridLimiter = rateLimit({
    keyGenerator: (req) => {
        return req.ip + req.cookies.userSessionId; // Combines IP and session ID
    },
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Allow 100 requests per 15 minutes for each IP-session pair
    message: "Too many requests, please try again later",
});

// Import the Scan model
const Scan = require('./models/Scan'); // Make sure this path is correct

// Middleware setup
app.use(cookieParser());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    dbName: 'qrtrack',  // <-- explicitly sets the database name
    useNewUrlParser: true,
    useUnifiedTopology: true
})
  .then(() => console.log("MongoDB connected to 'qrtrack' database"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Define mock locations
const locations = {
    "location1": "Quincy",
    "location2": "Boston",
    "location3": "Salem",
    "location4": "Amherst"
};

// Utility to generate unique session ID
function generateUniqueSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// Test route
app.get('/', (req, res) => {
  res.send('QR Tracking App is running!');
});

// Apply rate limit to your scan tracking route
app.use('/track', hybridLimiter); // Apply the hybrid rate limiter for both IP and session ID
app.use('/scans', scanViewLimiter); // Apply the scan view limiter

// Temporary debugging route for /track/:code (GET request)
app.get('/track/:code', (req, res) => {
    res.send(`Simulating scan for QR code: ${req.params.code}`);
});

// QR code tracking route
app.post('/track/:code', async (req, res) => {
    const { code } = req.params;
    const [adId, locationId] = code.split('-'); // Split the code to get ad and location IDs
    const locationName = locations[locationId]; // Get the location name from the mapping
    let userSessionId = req.cookies.userSessionId; // Track via session ID stored in a cookie
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    if (!userSessionId) {
        // Generate a new session ID for the user if it doesn't exist
        userSessionId = generateUniqueSessionId();
        // Set the cookie for 1 day expiry, with secure flag for production environment
        res.cookie('userSessionId', userSessionId, { 
            httpOnly: true,  // Prevent JavaScript access to the cookie (for XSS protection)
            secure: process.env.NODE_ENV === 'production',  // Set the cookie to be secure only in production
            maxAge: 24 * 60 * 60 * 1000  // 1 day expiry
        });
    }

    // Check if the session ID and code combination already exists in the database
    const existingScan = await Scan.findOne({ code: code, userSessionId: userSessionId });

    if (existingScan) {
        return res.status(200).send('You have already scanned this QR code.');
    }

    // Create a new scan record with ad and location information
    const newScan = new Scan({
        code: code,         // This now contains the adId-locationId
        adId: adId,         // Store the adId separately
        locationId: locationId,  // Store the locationId separately
        locationName: locationName, // Store the location name
        userSessionId: userSessionId,
        ipAddress: ipAddress,
        userAgent: userAgent
    });

    try {
        // Save the scan record to MongoDB
        await newScan.save();
        console.log('Scan logged:', newScan);  // Logs the scan data

        // Redirect user to a URL (can be customized based on the code)
        res.redirect(`https://yourdestination.com/${adId}-${locationId}`);
    } catch (error) {
        console.error('Error saving scan to database:', error); // Log any errors
        res.status(500).send('Error tracking QR code scan.');
    }
});

// View all scan logs (GET /scans)
app.get('/scans', async (req, res) => {
    try {
        const scans = await Scan.find().sort({ timestamp: -1 }); // Newest first

        // Map the scans to a more readable format
        const formattedScans = scans.map(scan => ({
            _id: scan._id,
            code: scan.code,
            adId: scan.adId,
            locationId: scan.locationId,
            locationName: scan.locationName, // Include the location name
            timestamp: scan.timestamp.toLocaleString(), // More readable date format
        }));

        res.json(formattedScans);
    } catch (err) {
        console.error('Error fetching scans:', err);
        res.status(500).send('Error retrieving scans.');
    }
});

// Generate QR code for a given ad and location
app.get('/generate-qr/:adId/:locationId', (req, res) => {
    const { adId, locationId } = req.params;
    
    // Dynamically build the URL based on the host
    const protocol = req.protocol; // e.g., 'http' or 'https'
    const host = req.get('host');  // e.g., 'qrcodeapplication-4ecfc40322a3.herokuapp.com'
    const url = `${protocol}://${host}/track/${adId}-${locationId}`;  // Unique URL for each ad-location pair

    QRCode.toDataURL(url, (err, qrCodeDataUrl) => {
        if (err) {
            res.status(500).send('Error generating QR code');
            return;
        }

        res.send(`<img src="${qrCodeDataUrl}" alt="QR Code">`);
    });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
