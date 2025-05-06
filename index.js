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
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'yoursecretkey'; // Add to .env

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

const locations = {
    "Quincy": "Quincy",
    "Boston": "Boston",
    "Salem": "Salem",
    "Amherst": "Amherst"
};

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
app.get('/', async (req, res) => {
    const ads = [
        { adId: 'ad1', locationId: 'california' },
        { adId: 'ad2', locationId: 'newyork' },
        { adId: 'ad3', locationId: 'texas' },
        { adId: 'ad4', locationId: 'florida' }
    ];

    try {
        const qrCodes = await Promise.all(ads.map(async ({ adId, locationId }) => {
            const token = generateSignedToken(adId, locationId);
            const url = `${req.protocol}://${req.get('host')}/track/${token}`;
            const qrCodeDataUrl = await QRCode.toDataURL(url);
            return { adId, locationId, qrCodeDataUrl };
        }));

        let qrCodeHtml = '<h1>QR Codes for Ads</h1>';
        qrCodes.forEach(qr => {
            qrCodeHtml += `
                <div>
                    <h3>Ad: ${qr.adId} - Location: ${qr.locationId}</h3>
                    <img src="${qr.qrCodeDataUrl}" alt="QR Code for ${qr.adId} - ${qr.locationId}">
                </div>
            `;
        });

        res.send(qrCodeHtml);
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
    const tokenData = verifySignedToken(req.params.token);
    if (!tokenData) return res.status(400).send('Invalid QR code');

    const { adId, locationId } = tokenData;
    const code = `${adId}-${locationId}`;
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

    const existingScan = await Scan.findOne({ code, userSessionId });
    if (existingScan) {
        return res.redirect('https://yourdestination.com/already-scanned');
    }

    try {
        await Scan.create({
            code,
            adId,
            locationId,
            locationName,
            userSessionId,
            ipAddress,
            userAgent
        });
        return res.redirect('https://yourdestination.com/success');
    } catch (err) {
        console.error('Scan save error:', err);
        return res.status(500).send('Tracking error.');
    }
});

// View all scans
app.get('/scans', async (req, res) => {
    try {
        const scans = await Scan.find().sort({ timestamp: -1 });

        let html = `
            <html>
            <head>
                <title>QR Scan Logs</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; background: #f8f8f8; }
                    table { border-collapse: collapse; width: 100%; background: #fff; }
                    th, td { padding: 10px; border: 1px solid #ccc; text-align: left; }
                    th { background: #333; color: white; }
                    tr:nth-child(even) { background-color: #f2f2f2; }
                </style>
            </head>
            <body>
                <h1>QR Code Scan Logs</h1>
                <table>
                    <tr>
                        <th>Ad ID</th>
                        <th>Location ID</th>
                        <th>Location Name</th>
                        <th>Code</th>
                        <th>Timestamp</th>
                    </tr>
        `;

        scans.forEach(scan => {
            html += `
                <tr>
                    <td>${scan.adId}</td>
                    <td>${scan.locationId}</td>
                    <td>${scan.locationName || '-'}</td>
                    <td>${scan.code}</td>
                    <td>${scan.timestamp.toLocaleString()}</td>
                </tr>
            `;
        });

        html += `
                </table>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error('Scan fetch error:', err);
        res.status(500).send('Failed to load scans.');
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
