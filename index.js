require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const app = express();
const moment = require('moment-timezone');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const Ad = require('./models/Ad');
const Location = require('./models/Location');
const basicAuth = require('express-basic-auth');
const GeneratedPair = require('./models/GeneratedPair');
const helmet = require('helmet');

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Ensure the 'public' folder exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// URL validation helper
function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

const port = process.env.PORT || 4200;
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

const requireBasicAuth = basicAuth({
    users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASSWORD },
    challenge: true,
    realm: 'QR Code Authentication'
});

app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));

const cors = require('cors');
app.use(cors({ origin: true, credentials: true }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const scanViewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const hybridLimiter = rateLimit({
    keyGenerator: (req) => req.ip + (req.cookies.userSessionId || ''),
    windowMs: 15 * 60 * 1000,
    max: 150
});

const Scan = require('./models/Scan');

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { dbName: 'qrtrack' })
    .then(() => console.log("✅ MongoDB connected successfully"))
    .catch(err => {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1);
    });

// ========== UTILITY FUNCTIONS ==========
function generateUniqueSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function isValidParam(value) {
    return /^[a-zA-Z0-9]+$/.test(value);
}

function generateSignedToken(adId, locationId) {
    const data = `${adId}:${locationId}`;
    const hash = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    return `${adId}-${locationId}-${hash}`;
}

function verifySignedToken(token) {
    try {
        const parts = token.split('-');
        if (parts.length < 3) return null;
        
        const hash = parts.pop();
        const locationId = parts.pop();
        const adId = parts.join('-');
        
        const expected = crypto.createHmac('sha256', TOKEN_SECRET)
            .update(`${adId}:${locationId}`)
            .digest('hex');
        
        return expected === hash ? { adId, locationId } : null;
    } catch (err) {
        return null;
    }
}

function getFullUrl(path, req) {
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.get('host');
        baseUrl = `${protocol}://${host}`;
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${cleanPath}`;
}

// ========== LAYOUT FUNCTION ==========
async function layout(content, title = 'QR Code Manager', showNav = true) {
    let totalScans = 0;
    try {
        totalScans = await Scan.countDocuments();
    } catch (err) {
        console.error('Error getting scan count:', err);
    }
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <link rel="stylesheet" href="/style.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    </head>
    <body>
        <div class="container">
            <header class="header">
                <h1><i class="fas fa-qrcode"></i> ${title}</h1>
                <p>Professional QR Code Management & Analytics</p>
            </header>
            
            ${showNav ? `
            <nav class="nav-bar">
                <a href="/" class="nav-button primary"><i class="fas fa-home"></i> Home</a>
                <a href="/generate" class="nav-button success"><i class="fas fa-plus-circle"></i> Generate QR</a>
                <a href="/manage-urls" class="nav-button"><i class="fas fa-link"></i> Manage URLs</a>
                <a href="/scans" class="nav-button"><i class="fas fa-chart-bar"></i> Analytics</a>
                <a href="/download-qr-excel" class="nav-button warning"><i class="fas fa-file-excel"></i> Export Excel</a>
            </nav>
            ` : ''}
            
            <main class="main-content">
                ${content}
            </main>
            
            <footer class="footer">
                <p>QR Code Manager &copy; ${new Date().getFullYear()} | Environment: ${process.env.NODE_ENV || 'development'} | Scans: ${totalScans}</p>
                <p>Base URL: ${process.env.BASE_URL || 'Not configured'}</p>
            </footer>
        </div>
        
        <script>
            setTimeout(() => {
                document.querySelectorAll('.alert').forEach(alert => {
                    alert.style.opacity = '0';
                    setTimeout(() => alert.remove(), 500);
                });
            }, 5000);
        </script>
    </body>
    </html>
    `;
}

// ========== MIDDLEWARE ==========
let recentQrCodeHtml = '';

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// ========== CRITICAL: TRACKING ROUTE (MUST BE EARLY) ==========
app.get('/track/:token', async (req, res) => {
    try {
        console.log('=== QR CODE SCANNED ===');
        console.log('Token:', req.params.token);
        
        // Parse token
        const token = req.params.token;
        const parts = token.split('-');
        
        if (parts.length < 3) {
            console.log('Invalid token format');
            return res.redirect('https://acp.us');
        }
        
        const hash = parts.pop();
        const locationId = parts.pop();
        const adId = parts.join('-');
        
        console.log('Ad ID:', adId, 'Location ID:', locationId);
        
        // Find redirect URL
        const pair = await GeneratedPair.findOne({ adId, locationId });
        
        let redirectUrl = 'https://acp.us'; // Default
        
        if (pair) {
            if (pair.customUrl) {
                redirectUrl = pair.customUrl;
                console.log('Using custom URL:', redirectUrl);
            } else if (pair.defaultRedirect) {
                redirectUrl = pair.defaultRedirect;
                console.log('Using default URL:', redirectUrl);
            }
        }
        
        console.log('Redirecting to:', redirectUrl);
        
        // Track scan (don't await)
        try {
            const location = await Location.findOne({ locationId });
            Scan.create({
                code: `${adId}-${locationId}`,
                adId,
                locationId,
                locationName: location?.name || locationId,
                userSessionId: req.cookies.userSessionId || 'anonymous',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            }).catch(err => console.error('Scan save error:', err));
        } catch (scanErr) {
            console.error('Error creating scan:', scanErr);
        }
        
        // Redirect
        res.redirect(redirectUrl);
        
    } catch (err) {
        console.error('Track route error:', err);
        res.redirect('https://acp.us');
    }
});

// ========== AUTHENTICATED ROUTES ==========
app.use(['/', '/generate', '/manage-urls', '/scans', '/download-qr-excel'], requireBasicAuth);

// ========== HOME PAGE ==========
app.get('/', async (req, res) => {
    try {
        const ads = await Ad.find();
        const locations = await Location.find();
        const totalScans = await Scan.countDocuments();
        const uniqueSessions = await Scan.distinct('userSessionId').then(s => s.length);
        
        let qrCodeHtml = '';
        
        const qrCodes = await Promise.all(ads.map(async ({ adId, name: adName }) => {
            return Promise.all(locations.map(async ({ locationId, name: locationName }) => {
                const token = generateSignedToken(adId, locationId);
                const url = getFullUrl(`/track/${token}`, req);
                const qrCodeDataUrl = await QRCode.toDataURL(encodeURI(url));
                const pair = await GeneratedPair.findOne({ adId, locationId });
                const hasCustomUrl = pair?.customUrl;
                
                return `
                <div class="qr-item">
                    <h3>${adId} - ${locationName}</h3>
                    <p class="qr-url"><small>${url}</small></p>
                    <a href="${url}" target="_blank"><img src="${qrCodeDataUrl}" alt="QR Code"></a>
                    <div class="url-badge ${hasCustomUrl ? 'custom' : 'default'}">
                        <i class="fas fa-${hasCustomUrl ? 'link' : 'globe'}"></i>
                        ${hasCustomUrl ? 'Custom URL' : 'Default URL'}
                    </div>
                </div>
                `;
            }));
        }));

        qrCodeHtml = qrCodes.flat().join('');
        
        if (recentQrCodeHtml) {
            qrCodeHtml += `<div class="qr-item">${recentQrCodeHtml}</div>`;
        }

        const content = `
        <div class="stats-container">
            <div class="stat-card">
                <h3>Total QR Pairs</h3>
                <div class="stat-value">${ads.length * locations.length}</div>
            </div>
            <div class="stat-card">
                <h3>Total Scans</h3>
                <div class="stat-value">${totalScans}</div>
            </div>
            <div class="stat-card">
                <h3>Unique Users</h3>
                <div class="stat-value">${uniqueSessions}</div>
            </div>
            <div class="stat-card">
                <h3>Active Ads</h3>
                <div class="stat-value">${ads.length}</div>
            </div>
        </div>

        <h2>All QR Codes</h2>
        ${ads.length === 0 || locations.length === 0 ? 
            `<div class="alert alert-warning">No QR codes found. <a href="/generate">Generate your first QR code</a></div>` : 
            `<div class="qr-container">${qrCodeHtml}</div>`
        }
        `;

        res.send(await layout(content, 'QR Code Dashboard'));
    } catch (err) {
        console.error('Home error:', err);
        res.send(await layout(`<div class="alert alert-danger">Error: ${err.message}</div>`, 'Error'));
    }
});

// ========== GENERATE PAGE ==========
app.get('/generate', async (req, res) => {
    const content = `
    <div class="form-container">
        <h2>Generate New QR Code</h2>
        
        <form method="POST" action="/generate">
            <div class="form-group">
                <label>Ad ID *</label>
                <input type="text" name="adId" required pattern="[a-zA-Z0-9]+">
            </div>
            
            <div class="form-group">
                <label>Location ID *</label>
                <input type="text" name="locationId" required pattern="[a-zA-Z0-9\\-]+">
            </div>
            
            <div class="form-group">
                <label>Default Redirect URL</label>
                <input type="url" name="defaultRedirect" value="https://acp.us">
            </div>
            
            <div class="form-check">
                <input type="checkbox" name="useCustomUrl" id="useCustomUrl">
                <label for="useCustomUrl">Set Custom URL</label>
            </div>
            
            <div class="form-group">
                <label>Custom URL</label>
                <input type="url" name="customUrl" id="customUrl" disabled>
            </div>
            
            <button type="submit" class="btn btn-success">Generate QR Code</button>
        </form>
    </div>

    <script>
        document.getElementById('useCustomUrl').addEventListener('change', function() {
            document.getElementById('customUrl').disabled = !this.checked;
        });
    </script>
    `;
    
    res.send(await layout(content, 'Generate QR Code'));
});

// ========== POST GENERATE ==========
app.post('/generate', async (req, res) => {
    try {
        const { adId, locationId, customUrl, defaultRedirect } = req.body;
        const useCustomUrl = req.body.useCustomUrl === 'on';

        if (!isValidParam(adId) || !isValidParam(locationId)) {
            return res.status(400).send('Invalid input.');
        }

        let ad = await Ad.findOne({ adId }) || await Ad.create({ adId, name: adId });
        let location = await Location.findOne({ locationId }) || await Location.create({ locationId, name: locationId });

        const pair = await GeneratedPair.findOneAndUpdate(
            { adId, locationId },
            { 
                customUrl: useCustomUrl ? customUrl : null,
                defaultRedirect: defaultRedirect || 'https://acp.us'
            },
            { upsert: true, new: true }
        );

        const token = generateSignedToken(adId, locationId);
        const url = getFullUrl(`/track/${token}`, req);
        const qrCodeDataUrl = await QRCode.toDataURL(url);

        const successContent = `
        <div style="text-align: center;">
            <h2 style="color: var(--success-color);">✅ QR Code Generated!</h2>
            <div class="qr-item">
                <h3>${adId} - ${location.name}</h3>
                <img src="${qrCodeDataUrl}" style="max-width: 200px;">
                <p>Tracking URL: ${url}</p>
                <p>Redirects to: ${pair.customUrl || pair.defaultRedirect}</p>
            </div>
            <a href="/generate" class="btn btn-success">Generate Another</a>
            <a href="/" class="btn">Home</a>
        </div>
        `;

        res.send(await layout(successContent, 'Success', false));
        
    } catch (err) {
        console.error('Generate error:', err);
        res.status(500).send('Error generating QR code');
    }
});

// ========== MANAGE URLS ==========
app.get('/manage-urls', async (req, res) => {
    try {
        const pairs = await GeneratedPair.find().sort({ updatedAt: -1 });
        
        let pairsList = pairs.map(pair => `
        <div class="url-item">
            <h4>${pair.adId} - ${pair.locationId}</h4>
            <p>Custom URL: ${pair.customUrl || 'Not set'}</p>
            <p>Default URL: ${pair.defaultRedirect}</p>
            <form action="/update-url" method="POST">
                <input type="hidden" name="adId" value="${pair.adId}">
                <input type="hidden" name="locationId" value="${pair.locationId}">
                <input type="url" name="customUrl" value="${pair.customUrl || ''}" placeholder="Custom URL">
                <button type="submit" class="btn">Update</button>
            </form>
        </div>
        `).join('');

        const content = `
        <h2>URL Management</h2>
        ${pairs.length === 0 ? '<p>No QR codes found. Generate one first.</p>' : pairsList}
        `;
        
        res.send(await layout(content, 'Manage URLs'));
    } catch (err) {
        res.status(500).send('Error loading manage URLs');
    }
});

// ========== UPDATE URL ==========
app.post('/update-url', async (req, res) => {
    const { adId, locationId, customUrl } = req.body;
    await GeneratedPair.findOneAndUpdate(
        { adId, locationId },
        { customUrl: customUrl || null }
    );
    res.redirect('/manage-urls');
});

// ========== SCANS PAGE ==========
app.get('/scans', async (req, res) => {
    try {
        const scans = await Scan.find().sort({ timestamp: -1 }).limit(100);
        
        const content = `
        <h2>Recent Scans</h2>
        <table>
            <tr><th>Code</th><th>Location</th><th>Time</th></tr>
            ${scans.map(s => `
                <tr>
                    <td>${s.code}</td>
                    <td>${s.locationName}</td>
                    <td>${moment(s.timestamp).format('YYYY-MM-DD HH:mm')}</td>
                </tr>
            `).join('')}
        </table>
        `;
        
        res.send(await layout(content, 'Scan Analytics'));
    } catch (err) {
        res.status(500).send('Error loading scans');
    }
});

// ========== DOWNLOAD EXCEL ==========
app.get('/download-qr-excel', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'qr_metadata.xlsx');
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('File not found');
    }
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
    res.status(404).send('404 - Page Not Found');
});

// ========== START SERVER ==========
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});