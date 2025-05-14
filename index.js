require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const app = express();
const moment = require('moment');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const Ad = require('./models/Ad');  // Import the Ad model
const Location = require('./models/Location');  // Import the Location model
const basicAuth = require('express-basic-auth'); // for password username

const port = process.env.PORT || 5000;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'yoursecretkey'; // Add to .env

const requireBasicAuth = basicAuth({
    users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASSWORD },
    challenge: true,
    realm: 'QR Code Authentication'
  });



app.set('trust proxy', 1);

const cors = require('cors');
const corsOptions = {
    origin: ['https://yourfrontend.com', 'https://qrcodeapplication-4ecfc40322a3.herokuapp.com'],
    credentials: true
};
app.use(cors(corsOptions));

// Rate limiters
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, message: "Too many requests." });
const scanViewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: "Too many requests." });
const hybridLimiter = rateLimit({
    keyGenerator: (req) => req.ip + req.cookies.userSessionId,
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests, please try again later",
});

// Models & middleware
const Scan = require('./models/Scan');
app.use(cookieParser());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, { dbName: 'qrtrack' })
  .then(() => console.log("MongoDB connected"))
  .catch(err => { console.error("MongoDB error:", err); process.exit(1); });



// Utils
function generateUniqueSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function isValidParam(value) {
    return /^[a-zA-Z0-9\-]+$/.test(value);
}

function generateSignedToken(adId, locationId) {
    const data = `${adId}:${locationId}`;
    const hash = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    return `${adId}-${locationId}-${hash}`;
}

function verifySignedToken(token) {
    const parts = token.split('-');
    if (parts.length < 3) return null;
    const hash = parts.pop();
    const locationId = parts.pop();
    const adId = parts.join('-');
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${adId}:${locationId}`).digest('hex');
    return (expected === hash) ? { adId, locationId } : null;
}


// Home page with test QR codes
app.get('/', requireBasicAuth, async (req, res) => {
    try {
        // Fetch ads and locations from the database
        const ads = await Ad.find();
        const locations = await Location.find();

        // Generate QR codes for each ad-location pair
        const qrCodes = await Promise.all(ads.map(async ({ adId, name }) => {
            return Promise.all(locations.map(async ({ locationId, name: locationName }) => {
                const token = generateSignedToken(adId, locationId);  // Using sanitized IDs
                const baseUrl = process.env.BASE_URL || 'https://qrcodeapplication-4ecfc40322a3.herokuapp.com';
                const url = `${baseUrl}/track/${token}`;
                const qrCodeDataUrl = await QRCode.toDataURL(encodeURI(url));
                return { adId, locationId, locationName, qrCodeDataUrl };
            }));
        }));

        // Flatten the array of QR codes
        const qrCodeHtml = qrCodes.flat().map(qr => {
            const token = generateSignedToken(qr.adId, qr.locationId);  // Using sanitized IDs
            const baseUrl = process.env.BASE_URL || 'https://qrcodeapplication-4ecfc40322a3.herokuapp.com';
            const url = `${baseUrl}/track/${token}`;
        
            return `
                <div class="qr-item">
                    <h3>${qr.adId} - ${qr.locationName}</h3>
                    <a href="${url}" target="_blank">
                        <img src="${qr.qrCodeDataUrl}" alt="QR Code for ${qr.adId} - ${qr.locationName}">
                    </a>
                </div>
            `;
        }).join('');

        // Send the HTML response with inline styles
        res.send(`
            <html>
                <head>
                    <title>QR Codes for Ads</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            flex-wrap: wrap;
                            justify-content: space-between;
                            padding: 20px;
                        }
                        .qr-container {
                            display: flex;
                            flex-wrap: wrap;
                            justify-content: space-between;
                        }
                        .qr-item {
                            text-align: center;
                            border: 1px solid #ddd;
                            border-radius: 8px;
                            padding: 8px;
                            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                            background-color: #fff;
                            width: 180px;
                            margin: 10px;
                        }
                        .qr-item img {
                            max-width: 100%;
                            height: auto;
                            border-radius: 4px;
                        }
                        .qr-item h3 {
                            font-size: 1rem;
                            margin-top: 8px;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <h1>QR Codes for Ads</h1>
                    <div class="qr-container">
                        ${qrCodeHtml}
                    </div>
                </body>
            </html>
        `);
    } catch (err) {
        console.error('QR error:', err);
        res.status(500).send('Error generating QR codes.');
    }
});




// Rate limiters
app.use('/track', hybridLimiter);
app.use('/scans', scanViewLimiter);

// QR scan tracking
app.get('/track/:token', async (req, res) => {
    const tokenData = verifySignedToken(req.params.token);  // This function verifies the sanitized token
    if (!tokenData) return res.status(400).send('Invalid QR code');

    const { adId, locationId } = tokenData;
    const locationName = await Location.findOne({ locationId }).select('name');
    if (!locationName) return res.status(400).send('Invalid location');

    // Generate a session cookie
    let userSessionId = req.cookies.userSessionId;

    if (!userSessionId) {
        userSessionId = generateUniqueSessionId();
        res.cookie('userSessionId', userSessionId, {
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            httpOnly: true,
            secure: true,
            sameSite: 'Strict'
        });
    }

    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    // Check for duplicate scan within 24 hours for same userSessionId, IP, and userAgent
    const existingScan = await Scan.findOne({
        code: `${adId}-${locationId}`,
        $or: [
            { userSessionId },
            { ipAddress, userAgent }
        ],
        timestamp: { $gt: Date.now() - 24 * 60 * 60 * 1000 } // Only allow one scan per 24 hours
    });

    // If a duplicate scan is found, redirect
    if (existingScan) {
        console.log('Duplicate scan detected:', { adId, locationId, userSessionId, ipAddress, userAgent });
        return res.redirect('https://yourdestination.com/already-scanned');
    }

    // Save the scan
    try {
        await Scan.create({
            code: `${adId}-${locationId}`,
            adId,
            locationId,
            locationName: locationName.name,
            userSessionId,
            ipAddress,
            userAgent
        });
        res.redirect('https://yourdestination.com/success');
    } catch (err) {
        console.error('Scan save error:', err);
        res.status(500).send('Tracking error.');
    }
});



// View all scans
app.get('/scans', async (req, res) => {
    try {
        // Fetch the latest scans from the database
        const scans = await Scan.find().sort({ timestamp: -1 });

        if (!scans || scans.length === 0) {
            return res.send('<h1>No scans found</h1>'); // Early return if no scans
        }

        // Count unique user sessions
        const totalScans = scans.length;
        const uniqueSessions = new Set(scans.map(scan => scan.userSessionId)).size;

        // Organize scans by location and ad
        const scansByLocation = {};
        const scansByAd = {};
        scans.forEach(scan => {
            scansByLocation[scan.locationId] = (scansByLocation[scan.locationId] || 0) + 1;
            scansByAd[scan.adId] = (scansByAd[scan.adId] || 0) + 1;
        });

        // Generate HTML report with scans and table
        let html = `
        <html>
        <head>
            <title>QR Scan Analytics</title>
            <style>
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                tr:nth-child(even) { background-color: #f9f9f9; }
            </style>
        </head>
        <body>
            <h1>QR Code Scan Analytics</h1>
            <p>Total Scans: ${totalScans}</p>
            <p>Unique Sessions: ${uniqueSessions}</p>
            <h2>Scans by Location</h2>
            <ul>
                ${Object.entries(scansByLocation).map(([loc, count]) => `<li>${loc}: ${count}</li>`).join('')}
            </ul>
            <h2>Scans by Ad</h2>
            <ul>
                ${Object.entries(scansByAd).map(([ad, count]) => `<li>${ad}: ${count}</li>`).join('')}
            </ul>

            <h2>Recent Scans</h2>
            <table>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Location</th>
                        <th>Timestamp</th>
                    </tr>
                </thead>
                <tbody>
                    ${scans.map(scan => `
                        <tr>
                            <td>${scan.code}</td>
                            <td>${scan.locationName}</td>
                            <td>${moment(scan.timestamp).format('YYYY-MM-DD HH:mm:ss')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
        `;
        res.send(html);
    } catch (err) {
        console.error('Scan analytics error:', err);
        res.status(500).send('Failed to load analytics.');
    }
});




// Generate individual QR with secure token
app.get('/generate-qr/:adId/:locationId', async (req, res) => {
    const { adId, locationId } = req.params;
    if (!isValidParam(adId) || !isValidParam(locationId)) {
        return res.status(400).send('Invalid input.');
    }

    const token = generateSignedToken(adId, locationId);
    const url = `${req.protocol}://${req.get('host')}/track/${token}`;

    QRCode.toDataURL(url, (err, qrCodeDataUrl) => {
        if (err) return res.status(500).send('QR generation failed');
        res.send(`<img src="${qrCodeDataUrl}" alt="QR Code">`);
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
