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
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Inter', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .container {
                max-width: 1400px;
                margin: 0 auto;
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                overflow: hidden;
            }
            .header {
                background: linear-gradient(135deg, #4a6fa5 0%, #166088 100%);
                color: white;
                padding: 2rem;
                text-align: center;
            }
            .nav-bar {
                background: #1a1d21;
                padding: 1rem;
                display: flex;
                justify-content: center;
                gap: 1rem;
                flex-wrap: wrap;
            }
            .nav-button {
                background: rgba(255,255,255,0.1);
                color: white;
                padding: 0.75rem 1.5rem;
                border-radius: 8px;
                text-decoration: none;
                transition: all 0.3s ease;
            }
            .nav-button:hover { background: rgba(255,255,255,0.2); }
            .nav-button.primary { background: #4a6fa5; }
            .nav-button.success { background: #10b981; }
            .nav-button.warning { background: #f59e0b; }
            .main-content { padding: 2rem; }
            .stats-container {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1.5rem;
                margin-bottom: 2rem;
            }
            .stat-card {
                background: white;
                border-radius: 12px;
                padding: 1.5rem;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                text-align: center;
                border-top: 4px solid #4a6fa5;
            }
            .stat-value { font-size: 2.5rem; font-weight: bold; color: #4a6fa5; }
            .qr-container {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 1.5rem;
            }
            .qr-item {
                background: white;
                border-radius: 12px;
                padding: 1.5rem;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                text-align: center;
            }
            .qr-item img { max-width: 200px; height: auto; }
            .url-badge {
                display: inline-block;
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
                font-size: 0.85rem;
                margin-top: 0.5rem;
            }
            .url-badge.custom { background: #d1fae5; color: #065f46; }
            .url-badge.default { background: #f3f4f6; color: #374151; }
            .btn {
                background: #4a6fa5;
                color: white;
                border: none;
                padding: 0.75rem 1.5rem;
                border-radius: 8px;
                text-decoration: none;
                display: inline-block;
                transition: all 0.3s ease;
            }
            .btn-success { background: #10b981; }
            .footer {
                background: #1a1d21;
                color: white;
                text-align: center;
                padding: 1.5rem;
            }
            @media (max-width: 768px) {
                .nav-bar { flex-direction: column; }
                .stats-container { grid-template-columns: 1fr; }
            }
        </style>
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
                <p>QR Code Manager &copy; ${new Date().getFullYear()} | Scans: ${totalScans}</p>
            </footer>
        </div>
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

// ========== TRACKING ROUTE (FIXED) ==========
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
        
        // Find redirect URL - FIRST check if this QR code exists
        const pair = await GeneratedPair.findOne({ adId, locationId });
        
        if (!pair) {
            console.log('❌ QR code not found in database');
            return res.redirect('https://acp.us');
        }
        
        let redirectUrl = pair.customUrl || pair.defaultRedirect || 'https://acp.us';
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

// ========== HOME PAGE (FIXED - ONLY SHOWS GENERATED COMBINATIONS) ==========
app.get('/', async (req, res) => {
    try {
        // Get ONLY the combinations that have been generated
        const pairs = await GeneratedPair.find().populate('adId').populate('locationId');
        const totalScans = await Scan.countDocuments();
        const uniqueSessions = await Scan.distinct('userSessionId').then(s => s.length);
        
        let qrCodeHtml = '';
        
        if (pairs.length === 0) {
            qrCodeHtml = '<p class="alert alert-warning">No QR codes generated yet. <a href="/generate">Generate your first QR code</a></p>';
        } else {
            const qrCodes = await Promise.all(pairs.map(async (pair) => {
                const ad = await Ad.findOne({ adId: pair.adId });
                const location = await Location.findOne({ locationId: pair.locationId });
                
                if (!ad || !location) return '';
                
                const token = generateSignedToken(pair.adId, pair.locationId);
                const url = getFullUrl(`/track/${token}`, req);
                const qrCodeDataUrl = await QRCode.toDataURL(encodeURI(url));
                const hasCustomUrl = !!pair.customUrl;
                
                return `
                <div class="qr-item">
                    <h3>${pair.adId} - ${location.name}</h3>
                    <p class="qr-url"><small>${url}</small></p>
                    <a href="${url}" target="_blank"><img src="${qrCodeDataUrl}" alt="QR Code"></a>
                    <div class="url-badge ${hasCustomUrl ? 'custom' : 'default'}">
                        <i class="fas fa-${hasCustomUrl ? 'link' : 'globe'}"></i>
                        ${hasCustomUrl ? 'Custom URL' : 'Default URL'}
                    </div>
                </div>
                `;
            }));
            
            qrCodeHtml = qrCodes.filter(Boolean).join('');
        }

        const content = `
        <div class="stats-container">
            <div class="stat-card">
                <h3>Total QR Codes</h3>
                <div class="stat-value">${pairs.length}</div>
            </div>
            <div class="stat-card">
                <h3>Total Scans</h3>
                <div class="stat-value">${totalScans}</div>
            </div>
            <div class="stat-card">
                <h3>Unique Users</h3>
                <div class="stat-value">${uniqueSessions}</div>
            </div>
        </div>

        <h2>Your QR Codes</h2>
        <div class="qr-container">
            ${qrCodeHtml}
        </div>
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
    <div class="form-container" style="max-width: 600px; margin: 0 auto;">
        <h2>Generate New QR Code</h2>
        
        <div class="alert alert-info">
            <i class="fas fa-info-circle"></i> All QR codes track scans. You can set custom redirect URLs.
        </div>
        
        <form method="POST" action="/generate">
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">Ad ID *</label>
                <input type="text" name="adId" required pattern="[a-zA-Z0-9]+" 
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px;">
            </div>
            
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">Location ID *</label>
                <input type="text" name="locationId" required pattern="[a-zA-Z0-9\\-]+"
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px;">
            </div>
            
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">Default Redirect URL</label>
                <input type="url" name="defaultRedirect" value="https://acp.us"
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px;">
            </div>
            
            <div class="form-check" style="margin-bottom: 1rem;">
                <input type="checkbox" name="useCustomUrl" id="useCustomUrl" style="margin-right: 0.5rem;">
                <label for="useCustomUrl">Set Custom URL</label>
            </div>
            
            <div class="form-group" style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">Custom URL</label>
                <input type="url" name="customUrl" id="customUrl" disabled
                    style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px;">
            </div>
            
            <button type="submit" class="btn btn-success" style="width: 100%;">Generate QR Code</button>
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

        // Create or update Ad
        let ad = await Ad.findOne({ adId });
        if (!ad) {
            ad = await Ad.create({ adId, name: adId });
        }

        // Create or update Location
        let location = await Location.findOne({ locationId });
        if (!location) {
            location = await Location.create({ locationId, name: locationId });
        }

        // Create or update GeneratedPair
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
        <div style="text-align: center; max-width: 500px; margin: 0 auto;">
            <div style="font-size: 4rem; color: #10b981; margin-bottom: 1rem;">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2 style="color: #10b981; margin-bottom: 1rem;">QR Code Generated!</h2>
            
            <div style="background: #f8f9fa; padding: 2rem; border-radius: 12px; margin: 2rem 0;">
                <h3>${adId} - ${location.name}</h3>
                <img src="${qrCodeDataUrl}" style="max-width: 200px; margin: 1rem 0;">
                <p style="word-break: break-all; background: white; padding: 1rem; border-radius: 8px;">
                    <strong>Tracking URL:</strong><br>${url}
                </p>
                <p>
                    <strong>Redirects to:</strong><br>
                    ${pair.customUrl || pair.defaultRedirect}
                </p>
            </div>
            
            <div style="display: flex; gap: 1rem; justify-content: center;">
                <a href="/generate" class="btn btn-success">Generate Another</a>
                <a href="/" class="btn">Home</a>
            </div>
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
        
        let pairsList = '';
        if (pairs.length > 0) {
            pairsList = pairs.map(pair => {
                const hasCustomUrl = !!pair.customUrl;
                return `
                <div style="background: #f8f9fa; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; border-left: 4px solid ${hasCustomUrl ? '#10b981' : '#4a6fa5'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h3 style="margin: 0;">${pair.adId} - ${pair.locationId}</h3>
                        <span style="background: ${hasCustomUrl ? '#d1fae5' : '#f3f4f6'}; color: ${hasCustomUrl ? '#065f46' : '#374151'}; padding: 0.25rem 0.75rem; border-radius: 20px;">
                            ${hasCustomUrl ? 'Custom URL' : 'Default URL'}
                        </span>
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <p><strong>Custom URL:</strong> ${pair.customUrl || '<em>Not set</em>'}</p>
                        <p><strong>Default URL:</strong> ${pair.defaultRedirect}</p>
                    </div>
                    
                    <form action="/update-url" method="POST">
                        <input type="hidden" name="adId" value="${pair.adId}">
                        <input type="hidden" name="locationId" value="${pair.locationId}">
                        <div style="display: flex; gap: 0.5rem;">
                            <input type="url" name="customUrl" value="${pair.customUrl || ''}" 
                                placeholder="Enter custom URL" 
                                style="flex: 1; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px;">
                            <button type="submit" class="btn" style="padding: 0.75rem 1.5rem;">Update</button>
                        </div>
                    </form>
                </div>
                `;
            }).join('');
        }

        const content = `
        <h2>URL Management</h2>
        ${pairs.length === 0 ? 
            '<div class="alert alert-warning">No QR codes found. <a href="/generate">Generate your first QR code</a></div>' : 
            pairsList}
        `;
        
        res.send(await layout(content, 'Manage URLs'));
    } catch (err) {
        console.error('Manage URLs error:', err);
        res.status(500).send('Error loading manage URLs');
    }
});

// ========== UPDATE URL ==========
app.post('/update-url', async (req, res) => {
    try {
        const { adId, locationId, customUrl } = req.body;
        
        await GeneratedPair.findOneAndUpdate(
            { adId, locationId },
            { customUrl: customUrl || null }
        );
        
        res.redirect('/manage-urls?updated=true');
    } catch (err) {
        console.error('Update URL error:', err);
        res.status(500).send('Error updating URL');
    }
});

// ========== SCANS PAGE ==========
app.get('/scans', async (req, res) => {
    try {
        const scans = await Scan.find().sort({ timestamp: -1 }).limit(100);
        const totalScans = await Scan.countDocuments();
        const uniqueSessions = await Scan.distinct('userSessionId').then(s => s.length);
        
        let scansTable = '';
        if (scans.length > 0) {
            scansTable = `
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead style="background: #4a6fa5; color: white;">
                        <tr>
                            <th style="padding: 1rem; text-align: left;">Code</th>
                            <th style="padding: 1rem; text-align: left;">Location</th>
                            <th style="padding: 1rem; text-align: left;">Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${scans.map(s => `
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 1rem;"><code>${s.code}</code></td>
                            <td style="padding: 1rem;">${s.locationName}</td>
                            <td style="padding: 1rem;">${moment(s.timestamp).format('YYYY-MM-DD HH:mm:ss')}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            `;
        }

        const content = `
        <h2>Scan Analytics</h2>
        
        <div class="stats-container">
            <div class="stat-card">
                <h3>Total Scans</h3>
                <div class="stat-value">${totalScans}</div>
            </div>
            <div class="stat-card">
                <h3>Unique Users</h3>
                <div class="stat-value">${uniqueSessions}</div>
            </div>
        </div>
        
        <h3>Recent Scans</h3>
        ${scans.length === 0 ? 
            '<div class="alert alert-warning">No scans recorded yet.</div>' : 
            scansTable}
        `;
        
        res.send(await layout(content, 'Scan Analytics'));
    } catch (err) {
        console.error('Scans error:', err);
        res.status(500).send('Error loading scans');
    }
});

// ========== DOWNLOAD EXCEL ==========
app.get('/download-qr-excel', async (req, res) => {
    try {
        const pairs = await GeneratedPair.find();
        
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('QR Codes');
        
        sheet.columns = [
            { header: 'Ad ID', key: 'adId', width: 15 },
            { header: 'Location ID', key: 'locationId', width: 15 },
            { header: 'Custom URL', key: 'customUrl', width: 50 },
            { header: 'Default URL', key: 'defaultRedirect', width: 50 },
        ];
        
        pairs.forEach(pair => sheet.addRow({
            adId: pair.adId,
            locationId: pair.locationId,
            customUrl: pair.customUrl || '',
            defaultRedirect: pair.defaultRedirect
        }));
        
        const filePath = path.join(publicDir, 'qr_metadata.xlsx');
        await workbook.xlsx.writeFile(filePath);
        res.download(filePath);
    } catch (err) {
        console.error('Excel error:', err);
        res.status(500).send('Error generating Excel file');
    }
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
    res.status(404).send(`
        <div style="text-align: center; padding: 4rem 2rem;">
            <h1 style="color: #ef4444;">404 - Page Not Found</h1>
            <a href="/" class="btn">Go to Dashboard</a>
        </div>
    `);
});

// ========== START SERVER ==========
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});