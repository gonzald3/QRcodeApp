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
const cors = require('cors');
const corsOptions = {
    origin: ['https://yourfrontend.com', 'https://qrcodeapplication-4ecfc40322a3.herokuapp.com'], // add all expected domains
    credentials: true
};
app.use(cors(corsOptions));

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

})
  .then(() => console.log("MongoDB connected to 'qrtrack' database"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Define mock locations
const locations = {
    "Quincy": "Quincy",
    "Boston": "Boston",
    "Salem": "Salem",
    "Amherst": "Amherst"
};

// Utility to generate unique session ID
function generateUniqueSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function isValidParam(value) {
    return /^[a-zA-Z0-9\-]+$/.test(value); // Alphanumeric and hyphens only
  }
  

// Test route
app.get('/', (req, res) => {
  res.send('QR Tracking App is running!');
});

// Apply rate limit to your scan tracking route
app.use('/track', hybridLimiter); // Apply the hybrid rate limiter for both IP and session ID
app.use('/scans', scanViewLimiter); // Apply the scan view limiter


// QR code tracking route
app.get('/track/:code', async (req, res) => {
    console.log("Tracking QR code via GET /track/:code");

    const { code } = req.params;
    if (!isValidParam(code)) {
        return res.status(400).send('Invalid code format.');
    }


    const [adId, locationId] = code.split('-');
    if (!isValidParam(adId) || !isValidParam(locationId)) {
        return res.status(400).send('Invalid ad or location ID.');
    }
    const locationName = locations[locationId];
    let userSessionId = req.cookies.userSessionId;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    if (!userSessionId) {
        userSessionId = generateUniqueSessionId();
        res.cookie('userSessionId', userSessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'None',
            maxAge: 24 * 60 * 60 * 1000
        });
    }

    const existingScan = await Scan.findOne({ code: code, userSessionId: userSessionId });

    if (existingScan) {
        console.log('Already scanned by this session');
        return res.redirect('https://yourdestination.com/already-scanned'); // optional: create a different page
    }

    try {
        const newScan = new Scan({
            code,
            adId,
            locationId,
            locationName,
            userSessionId,
            ipAddress,
            userAgent
        });

        await newScan.save();
        console.log('Scan saved:', newScan);
        return res.redirect('https://yourdestination.com/success'); // Customize this URL
    } catch (err) {
        console.error('Error saving scan:', err);
        return res.status(500).send('Error tracking QR code scan.');
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

// Serve the redirect page after scanning QR code
// Replace this route
app.get('/scan/:adId-:locationId', async (req, res) => {
    const { adId, locationId } = req.params;
    if (!isValidParam(adId) || !isValidParam(locationId)) {
        return res.status(400).send('Invalid ad or location ID.');
    }
    const code = `${adId}-${locationId}`;
  
    try {
      await Scan.create({
        code,
        adId,
        locationId,
        locationName: getLocationName(locationId), // Replace with your own logic or a lookup
        timestamp: new Date(),
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
  
      res.redirect('https://yourdestination.com/success'); // Customize as needed
    } catch (err) {
      console.error('Error recording scan:', err);
      res.status(500).send('Error tracking QR scan.');
    }
  });
  


// Generate QR code for a given ad and location
app.get('/generate-qr/:adId/:locationId', (req, res) => {
    const { adId, locationId } = req.params;
    if (!isValidParam(adId) || !isValidParam(locationId)) {
        return res.status(400).send('Invalid ad or location ID.');
    }
    
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
