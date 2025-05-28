require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const app = express();
const moment = require('moment-timezone');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const Ad = require('./models/Ad');  // Import the Ad model
const Location = require('./models/Location');  // Import the Location model
const basicAuth = require('express-basic-auth'); // for password username


const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Ensure the 'public' folder exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}



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
    const hashMatch = token.match(/-([a-f0-9]{64})$/);
    if (!hashMatch) return null;

    const hash = hashMatch[1];
    const withoutHash = token.slice(0, token.length - hash.length - 1); // remove last dash + hash
    const lastDash = withoutHash.lastIndexOf('-');

    if (lastDash === -1) return null;

    const adId = withoutHash.slice(0, lastDash);
    const locationId = withoutHash.slice(lastDash + 1);

    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${adId}:${locationId}`).digest('hex');

    if (expected !== hash) {
        console.log('❌ HASH MISMATCH');
        console.log('adId:', adId);
        console.log('locationId:', locationId);
        console.log('expected:', expected);
        console.log('received:', hash);
        console.log('TOKEN_SECRET used:', TOKEN_SECRET);
    }
    

    return expected === hash ? { adId, locationId } : null;
}




// Home page with test QR codes
app.get('/', requireBasicAuth, async (req, res) => {
    try {
        const ads = await Ad.find();
        const locations = await Location.find();

        const baseUrl = process.env.BASE_URL || 'https://qrcodeapplication-4ecfc40322a3.herokuapp.com';
        const qrMetadata = [];

        const qrCodes = await Promise.all(ads.map(async ({ adId, name: adName }) => {
            return Promise.all(locations.map(async ({ locationId, name: locationName }) => {
                const token = generateSignedToken(adId, locationId);
                const url = `${baseUrl}/track/${token}`;
                const qrCodeDataUrl = await QRCode.toDataURL(encodeURI(url));


                qrMetadata.push({ adId, adName, locationId, locationName, url });

                return `
                    <div class="qr-item">
                        <h3>${adId} - ${locationName}</h3>
                        <a href="${url}" target="_blank">
                            <img src="${qrCodeDataUrl}" alt="QR Code for ${adId} - ${locationName}">
                        </a>
                    </div>
                `;
            }));
        }));

        // Generate Excel file
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('QR Metadata');

        sheet.columns = [
            { header: 'Ad ID', key: 'adId', width: 15 },
            { header: 'Ad Name', key: 'adName', width: 25 },
            { header: 'Location ID', key: 'locationId', width: 15 },
            { header: 'Location Name', key: 'locationName', width: 25 },
            { header: 'QR URL', key: 'url', width: 50 },
        ];
        qrMetadata.forEach(row => sheet.addRow(row));



        const publicDir = path.join(__dirname, 'public');
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir);
            }
        const excelFilePath = path.join(__dirname, 'public', 'qr_metadata.xlsx');
        await workbook.xlsx.writeFile(excelFilePath);

        const qrCodeHtml = qrCodes.flat().join('');

        res.send(`
            <html>
            <head>
                <title>QR Codes for Ads</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
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
                        background-color: #fff;
                        width: 180px;
                        margin: 10px;
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    }
                    .qr-item img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 4px;
                    }
                    h1 {
                        margin-bottom: 10px;
                    }
                    .download-button {
                        margin-bottom: 20px;
                        display: inline-block;
                        padding: 10px 20px;
                        background-color: #007bff;
                        color: white;
                        text-decoration: none;
                        border-radius: 5px;
                    }
                </style>
            </head>
            <body>
                <h1>QR Codes for Ads</h1>
                <a href="/download-qr-excel" class="download-button" download>Download Excel Table</a>
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



//serve the file
app.get('/download-qr-excel', requireBasicAuth, (req, res) => {
    const filePath = path.join(__dirname, 'public', 'qr_metadata.xlsx');
    res.download(filePath, 'qr_metadata.xlsx');
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
        return res.redirect('https://acp.us');
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
        res.redirect('https://acp.us');
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
                            <td>${moment(scan.timestamp).tz('America/New_York').format('YYYY-MM-DD hh:mm:ss A')}</td>
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
