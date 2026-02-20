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
const helmet = require('helmet'); // Added for security

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Ensure the 'public' folder exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Add this helper function for URL validation
function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

const port = process.env.PORT || 4200;
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex'); // Better default

const requireBasicAuth = basicAuth({
    users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASSWORD },
    challenge: true,
    realm: 'QR Code Authentication'
});

app.set('trust proxy', 1); // Trust Heroku's proxy

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

// Allow all origins for Heroku
app.use(cors({
    origin: true, // This allows any origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.urlencoded({ extended: true }));

// Rate limiters
const limiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: "Too many requests." 
});
const scanViewLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: "Too many requests." 
});
const hybridLimiter = rateLimit({
    keyGenerator: (req) => req.ip + (req.cookies.userSessionId || ''),
    windowMs: 15 * 60 * 1000,
    max: 150,
    message: "Too many requests, please try again later",
});

const Scan = require('./models/Scan');
app.use(cookieParser());
app.use(express.json());

// MongoDB connection with Heroku compatibility
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/qrtrack', { 
    dbName: 'qrtrack',
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log("✅ MongoDB connected successfully"))
.catch(err => { 
    console.error("❌ MongoDB connection error:", err); 
    process.exit(1); 
});

// Utils
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Add a layout wrapper function
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
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>
            body, button, input, select, textarea {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            }
            * {
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
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
                <a href="/" class="nav-button primary">
                    <i class="fas fa-home"></i> Home
                </a>
                <a href="/generate" class="nav-button success">
                    <i class="fas fa-plus-circle"></i> Generate QR
                </a>
                <a href="/manage-urls" class="nav-button">
                    <i class="fas fa-link"></i> Manage URLs
                </a>
                <a href="/scans" class="nav-button">
                    <i class="fas fa-chart-bar"></i> Analytics
                </a>
                <a href="/download-qr-excel" class="nav-button warning">
                    <i class="fas fa-file-excel"></i> Export Excel
                </a>
            </nav>
            ` : ''}
            
            <main class="main-content">
                ${content}
            </main>
            
            <footer class="footer">
                <p>QR Code Manager &copy; ${new Date().getFullYear()} | Environment: ${process.env.NODE_ENV || 'development'} | Scans: ${totalScans}</p>
                <p style="margin-top: 0.5rem; font-size: 0.9rem; opacity: 0.7;">
                    Base URL: ${process.env.BASE_URL || 'Not configured'}
                </p>
            </footer>
        </div>
        
        <script>
            // Auto-hide alerts after 5 seconds
            setTimeout(() => {
                const alerts = document.querySelectorAll('.alert');
                alerts.forEach(alert => {
                    alert.style.opacity = '0';
                    alert.style.transition = 'opacity 0.5s';
                    setTimeout(() => alert.remove(), 500);
                });
            }, 5000);
            
            // Form validation
            document.addEventListener('DOMContentLoaded', function() {
                const forms = document.querySelectorAll('form');
                forms.forEach(form => {
                    form.addEventListener('submit', function(e) {
                        const requiredFields = form.querySelectorAll('[required]');
                        let valid = true;
                        
                        requiredFields.forEach(field => {
                            if (!field.value.trim()) {
                                valid = false;
                                field.style.borderColor = 'var(--danger-color)';
                            } else {
                                field.style.borderColor = '';
                            }
                        });
                        
                        if (!valid) {
                            e.preventDefault();
                            alert('Please fill in all required fields.');
                        }
                    });
                });
            });
        </script>
    </body>
    </html>
    `;
}

function verifySignedToken(token) {
    try {
        console.log('Verifying token:', token);
        
        // Token format: adId-locationId-hash
        const parts = token.split('-');
        console.log('Token parts count:', parts.length);
        
        if (parts.length < 3) {
            console.log('❌ Token has wrong number of parts');
            return null;
        }
        
        // The hash is always 64 characters (last part)
        const hash = parts[parts.length - 1];
        
        // Check if hash is 64 chars (sha256)
        if (hash.length !== 64) {
            console.log('❌ Hash length is', hash.length, 'expected 64');
            return null;
        }
        
        // Reconstruct adId and locationId (adId might have hyphens)
        const adId = parts.slice(0, parts.length - 2).join('-');
        const locationId = parts[parts.length - 2];
        
        console.log('Extracted - adId:', adId, 'locationId:', locationId);
        
        // Verify hash
        const expected = crypto.createHmac('sha256', TOKEN_SECRET)
            .update(`${adId}:${locationId}`)
            .digest('hex');
        
        const isValid = expected === hash;
        console.log('Token valid:', isValid);
        
        if (!isValid) {
            console.log('Expected hash:', expected);
            console.log('Actual hash:  ', hash);
        }
        
        return isValid ? { adId, locationId } : null;
        
    } catch (err) {
        console.error('Error verifying token:', err);
        return null;
    }
}

// Function to ensure proper URLs for Heroku
function getFullUrl(path, req) {
    // Always use BASE_URL from environment if set
    let baseUrl = process.env.BASE_URL;
    
    if (!baseUrl) {
        // For Heroku - use x-forwarded-proto
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.get('host');
        baseUrl = `${protocol}://${host}`;
    }
    
    // Ensure baseUrl doesn't end with slash
    baseUrl = baseUrl.replace(/\/$/, '');
    
    // Ensure path starts with slash
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    return `${baseUrl}${cleanPath}`;
}

// Middleware to store recent QR code generation result temporarily
let recentQrCodeHtml = '';

// Health check endpoint (required by Heroku)
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Home page
app.get('/', requireBasicAuth, async (req, res) => {
    try {
        const ads = await Ad.find();
        const locations = await Location.find();
        const totalScans = await Scan.countDocuments();
        const uniqueSessions = await Scan.distinct('userSessionId').then(sessions => sessions.length);
        
        let qrCodeHtml = '';
        
        // Generate QR codes grid
        const qrCodes = await Promise.all(ads.map(async ({ adId, name: adName }) => {
            return Promise.all(locations.map(async ({ locationId, name: locationName }) => {
                const token = generateSignedToken(adId, locationId);
                const url = getFullUrl(`/track/${token}`, req);
                const qrCodeDataUrl = await QRCode.toDataURL(encodeURI(url));
                
                const generatedPair = await GeneratedPair.findOne({ adId, locationId });
                const hasCustomUrl = generatedPair?.customUrl;
                
                return `
                <div class="qr-item">
                    <h3>${adId} - ${locationName}</h3>
                    <p class="qr-url"><small>${url}</small></p>
                    <a href="${url}" target="_blank">
                        <img src="${qrCodeDataUrl}" alt="QR Code">
                    </a>
                    <div class="url-badge ${hasCustomUrl ? 'custom' : 'default'}">
                        <i class="fas fa-${hasCustomUrl ? 'link' : 'globe'}"></i>
                        ${hasCustomUrl ? 'Custom URL' : 'Default URL'}
                    </div>
                    <div style="margin-top: 10px;">
                        <a href="/update-url/${adId}/${locationId}" class="btn btn-success" style="padding: 5px 10px; font-size: 0.9rem;">
                            <i class="fas fa-edit"></i> Edit
                        </a>
                    </div>
                </div>
                `;
            }));
        }));

        qrCodeHtml = qrCodes.flat().join('');
        
        // Add recent QR code if exists
        if (recentQrCodeHtml) {
            qrCodeHtml += `
            <div class="qr-item" style="border: 2px solid var(--accent-color);">
                <h3><i class="fas fa-star"></i> Most Recent QR Code</h3>
                ${recentQrCodeHtml}
            </div>
            `;
        }

        const content = `
        <div class="stats-container">
            <div class="stat-card">
                <h3><i class="fas fa-qrcode"></i> Total QR Pairs</h3>
                <div class="stat-value">${ads.length * locations.length}</div>
                <div class="stat-label">Ad × Location Combinations</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-chart-line"></i> Total Scans</h3>
                <div class="stat-value">${totalScans}</div>
                <div class="stat-label">All Time Scans</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-users"></i> Unique Users</h3>
                <div class="stat-value">${uniqueSessions}</div>
                <div class="stat-label">Unique Sessions</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-bullhorn"></i> Active Ads</h3>
                <div class="stat-value">${ads.length}</div>
                <div class="stat-label">Currently Active</div>
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin: 2rem 0;">
            <h2><i class="fas fa-qrcode"></i> All QR Codes</h2>
            <div>
                <span class="badge badge-primary">${ads.length} Ads</span>
                <span class="badge badge-success">${locations.length} Locations</span>
            </div>
        </div>

        ${ads.length === 0 || locations.length === 0 ? 
            `<div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                No QR codes found. <a href="/generate">Generate your first QR code</a>
            </div>` : 
            `<div class="qr-container">${qrCodeHtml}</div>`
        }
        `;

        res.send(await layout(content, 'QR Code Dashboard'));
    } catch (err) {
        console.error('QR error:', err);
        const errorContent = `
        <div class="alert alert-danger">
            <i class="fas fa-exclamation-circle"></i>
            Error loading QR codes: ${err.message}
        </div>
        <a href="/" class="btn"><i class="fas fa-redo"></i> Try Again</a>
        `;
        res.send(layout(errorContent, 'Error'));
    }
});

// Generate page: Add new QR codes
app.get('/generate', requireBasicAuth, async (req, res) => {
    const content = `
    <div class="form-container">
        <h2><i class="fas fa-plus-circle"></i> Generate New QR Code</h2>
        
        <div class="alert alert-info">
            <i class="fas fa-info-circle"></i>
            All QR codes track scans and redirect users. You can set custom redirect URLs.
        </div>
        
        <form method="POST" action="/generate" onsubmit="return validateForm();">
            <div class="form-group">
                <label for="adId"><i class="fas fa-bullhorn"></i> Ad ID *</label>
                <input type="text" id="adId" name="adId" required 
                    pattern="[a-zA-Z0-9]+" 
                    placeholder="e.g., SPRING2024"
                    title="Only letters and numbers (no spaces or special characters)">
                <small style="color: #666;">Unique identifier for your ad campaign</small>
            </div>
            
            <div class="form-group">
                <label for="locationId"><i class="fas fa-map-marker-alt"></i> Location ID *</label>
                <input type="text" id="locationId" name="locationId" required 
                    pattern="[a-zA-Z0-9\\-]+"
                    placeholder="e.g., NYC-TIMES-SQ"
                    title="Letters, numbers, and hyphens only">
                <small style="color: #666;">Where this QR code will be displayed</small>
            </div>
            
            <div style="background: #f8f9fa; padding: 1.5rem; border-radius: var(--border-radius); margin: 1.5rem 0;">
                <h3 style="color: var(--secondary-color); margin-bottom: 1rem;">
                    <i class="fas fa-link"></i> Redirect Settings
                </h3>
                
                <div class="form-group">
                    <label for="defaultRedirect">Default Redirect URL *</label>
                    <input type="url" id="defaultRedirect" name="defaultRedirect" 
                        placeholder="https://acp.us" 
                        value="https://acp.us"
                        required
                        title="Where to redirect if no custom URL is set">
                    <small style="color: #666;">Users will go here if no custom URL is set</small>
                </div>
                
                <div class="form-check">
                    <input type="checkbox" id="useCustomUrl" name="useCustomUrl" onclick="toggleCustomUrl()">
                    <label for="useCustomUrl" style="font-weight: 600;">
                        <i class="fas fa-magic"></i> Set Custom Redirect URL
                    </label>
                </div>
                
                <div class="form-group" id="customUrlGroup" style="margin-top: 1rem;">
                    <label for="customUrl">Custom URL (Optional)</label>
                    <input type="url" id="customUrl" name="customUrl" 
                        placeholder="https://your-custom-url.com/promo"
                        pattern="https?://.+"
                        title="Include http:// or https://"
                        disabled />
                    <small style="color: #666;">Overrides the default URL. Leave empty to use default.</small>
                </div>
            </div>
            
            <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                <button type="submit" class="btn btn-success btn-block">
                    <i class="fas fa-qrcode"></i> Generate QR Code
                </button>
                <a href="/" class="btn btn-block" style="background: #6c757d;">
                    <i class="fas fa-times"></i> Cancel
                </a>
            </div>
        </form>
    </div>

    <script>
        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            // Make sure the checkbox click handler is properly attached
            const checkbox = document.getElementById('useCustomUrl');
            if (checkbox) {
                checkbox.addEventListener('change', toggleCustomUrl);
            }
        });
        
        function validateForm() {
            const adId = document.getElementById("adId").value.trim();
            const locationId = document.getElementById("locationId").value.trim();
            const customUrl = document.getElementById("customUrl").value.trim();
            
            const pattern = /^[a-zA-Z0-9]+$/;
            if (!pattern.test(adId) || !pattern.test(locationId)) {
                alert("❌ Invalid input! Only letters and numbers are allowed for IDs.");
                return false;
            }
            
            function isValidUrl(url) {
                if (!url) return true;
                try {
                    new URL(url);
                    return true;
                } catch (e) {
                    return false;
                }
            }
            
            const useCustomUrl = document.getElementById("useCustomUrl").checked;
            if (useCustomUrl && customUrl && !isValidUrl(customUrl)) {
                alert("❌ Please enter a valid Custom URL (include http:// or https://)");
                return false;
            }
            
            return true;
        }
        
        function toggleCustomUrl() {
            const useCustom = document.getElementById("useCustomUrl").checked;
            const customUrlInput = document.getElementById("customUrl");
            console.log('toggleCustomUrl called, useCustom:', useCustom);
            
            // Remove the disabled attribute when checked
            if (useCustom) {
                customUrlInput.removeAttribute('disabled');
                customUrlInput.focus();
            } else {
                customUrlInput.setAttribute('disabled', 'disabled');
                customUrlInput.value = "";
            }
        }
    </script>
    `;
    
    res.send(await layout(content, 'Generate QR Code'));
});

// POST generate QR code and store in memory
// Update the POST /generate route
app.post('/generate', requireBasicAuth, async (req, res) => {
    try {
        console.log('=== POST /generate START ===');
        console.log('1. Request body:', req.body);
        
        const { adId, locationId, customUrl, defaultRedirect } = req.body;
        const useCustomUrl = req.body.useCustomUrl === 'on';
        
        console.log('2. Parsed values:', { adId, locationId, customUrl, defaultRedirect, useCustomUrl });

        // Validate IDs
        if (!isValidParam(adId) || !isValidParam(locationId)) {
            console.log('3. ❌ Invalid ID params');
            return res.status(400).send('Invalid input.');
        }
        console.log('3. ✅ ID params valid');

        // Validate URLs
        if (useCustomUrl && customUrl && !isValidHttpUrl(customUrl)) {
            console.log('4. ❌ Invalid custom URL:', customUrl);
            return res.status(400).send('Invalid custom URL format. Include http:// or https://');
        }
        console.log('4. ✅ URL validation passed');

        // Ensure ad exists
        console.log('5. Checking/creating Ad...');
        let ad = await Ad.findOne({ adId });
        if (!ad) {
            console.log('5a. Creating new Ad:', adId);
            ad = await Ad.create({ adId, name: adId });
        }
        console.log('5b. Ad found/created:', ad);

        // Ensure location exists
        console.log('6. Checking/creating Location...');
        let location = await Location.findOne({ locationId });
        if (!location) {
            console.log('6a. Creating new Location:', locationId);
            location = await Location.create({ locationId, name: locationId });
        }
        console.log('6b. Location found/created:', location);

        // Create or update GeneratedPair
        console.log('7. Updating GeneratedPair...');
        const generatedPair = await GeneratedPair.findOneAndUpdate(
            { adId, locationId },
            { 
                customUrl: useCustomUrl ? customUrl : null,
                defaultRedirect: defaultRedirect || 'https://acp.us',
                updatedAt: Date.now()
            },
            { upsert: true, new: true }
        );
        console.log('7b. GeneratedPair updated:', generatedPair);

        // Generate token and QR code
        console.log('8. Generating token...');
        const token = generateSignedToken(adId, locationId);
        console.log('8b. Token:', token);
        
        console.log('9. Getting full URL...');
        const url = getFullUrl(`/track/${token}`, req);
        console.log('9b. URL:', url);
        
        console.log('10. Generating QR code...');
        const qrCodeDataUrl = await QRCode.toDataURL(url);
        console.log('10b. QR code generated');

        // Update recent QR display
        console.log('11. Creating recent QR HTML...');
        recentQrCodeHtml = `
            <div class="qr-item">
                <h3>${adId} - ${location.name}</h3>
                <p><strong>Tracking URL:</strong><br><small>${url}</small></p>
                ${generatedPair.customUrl ? 
                    `<p><strong>Custom Redirect:</strong><br><small>${generatedPair.customUrl}</small></p>` : 
                    `<p><strong>Default Redirect:</strong><br><small>${generatedPair.defaultRedirect}</small></p>`
                }
                <img src="${qrCodeDataUrl}" alt="QR Code for ${adId} - ${location.name}">
            </div>
        `;
        console.log('11b. Recent QR HTML created');

        // Create content
        console.log('12. Creating content HTML...');
        const content = `
        <div style="text-align: center; padding: 4rem 2rem;">
            <div style="font-size: 4rem; color: var(--success-color); margin-bottom: 2rem;">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2 class="semibold">QR Code Generated Successfully!</h2>
            <p class="regular" style="color: #666; margin: 1rem 0 2rem;">
                Your QR code has been created and is ready to use.
            </p>
            
            <div style="background: white; border-radius: var(--border-radius); padding: 2rem; margin: 2rem auto; max-width: 500px; box-shadow: var(--box-shadow);">
                ${recentQrCodeHtml}
            </div>
            
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <a href="/generate" class="btn btn-success">
                    <i class="fas fa-plus"></i> Create Another
                </a>
                <a href="/manage-urls" class="btn">
                    <i class="fas fa-link"></i> Manage URLs
                </a>
                <a href="/" class="btn">
                    <i class="fas fa-home"></i> Dashboard
                </a>
            </div>
        </div>
        `;
        console.log('12b. Content HTML created');

        // Send response
        console.log('13. Calling layout function...');
        const finalHtml = await layout(content, 'Success!', true);
        console.log('13b. Layout complete, sending response');
        
        res.send(finalHtml);
        console.log('=== POST /generate END (SUCCESS) ===');
        
    } catch (err) {
        console.error('❌❌❌ ERROR in POST /generate:');
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);
        
        const errorContent = `
        <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 4rem; color: var(--danger-color); margin-bottom: 1rem;">
                <i class="fas fa-exclamation-circle"></i>
            </div>
            <h2 style="color: var(--danger-color);">Error Generating QR Code</h2>
            <p style="color: #666; margin: 1rem 0; font-family: monospace; background: #f5f5f5; padding: 1rem; border-radius: 8px;">
                ${err.message}
            </p>
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <a href="/generate" class="btn"><i class="fas fa-redo"></i> Try Again</a>
                <a href="/" class="btn"><i class="fas fa-home"></i> Dashboard</a>
            </div>
        </div>
        `;
        
        try {
            const errorHtml = await layout(errorContent, 'Error', true);
            res.status(500).send(errorHtml);
        } catch (layoutErr) {
            console.error('❌ Even error layout failed:', layoutErr);
            res.status(500).send(`
                <h1>Error</h1>
                <p>${err.message}</p>
                <pre>${err.stack}</pre>
                <a href="/">Go Home</a>
            `);
        }
    }
});

// Manage URLS page: Add a management page for URLs
app.get('/manage-urls', requireBasicAuth, async (req, res) => {
    try {
        const pairs = await GeneratedPair.find().sort({ updatedAt: -1 });
        
        let pairsList = '';
        if (pairs.length > 0) {
            pairsList = pairs.map(pair => `
            <div class="url-item">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <h4><i class="fas fa-qrcode"></i> ${pair.adId} - ${pair.locationId}</h4>
                        <p><small>Last updated: ${moment(pair.updatedAt).fromNow()}</small></p>
                    </div>
                    <span class="badge ${pair.customUrl ? 'badge-success' : 'badge-warning'}">
                        ${pair.customUrl ? 'Custom URL' : 'Default URL'}
                    </span>
                </div>
                
                <div style="margin-top: 1rem;">
                    <div style="margin-bottom: 0.5rem;">
                        <strong><i class="fas fa-link"></i> Custom URL:</strong>
                        <div class="url">${pair.customUrl || '<em>Not set</em>'}</div>
                    </div>
                    <div>
                        <strong><i class="fas fa-globe"></i> Default URL:</strong>
                        <div class="url">${pair.defaultRedirect || 'https://acp.us'}</div>
                    </div>
                </div>
                
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                    <form action="/update-url" method="POST" style="display: inline;">
                        <input type="hidden" name="adId" value="${pair.adId}">
                        <input type="hidden" name="locationId" value="${pair.locationId}">
                        <div style="display: flex; gap: 0.5rem;">
                            <input type="url" name="customUrl" value="${pair.customUrl || ''}" 
                                placeholder="https://custom-url.com" 
                                style="flex: 1; padding: 0.5rem;">
                            <button type="submit" class="btn" style="padding: 0.5rem 1rem;">
                                <i class="fas fa-save"></i> Update
                            </button>
                        </div>
                    </form>
                    ${pair.customUrl ? `
                    <form action="/clear-custom-url" method="POST" style="display: inline;">
                        <input type="hidden" name="adId" value="${pair.adId}">
                        <input type="hidden" name="locationId" value="${pair.locationId}">
                        <button type="submit" class="btn btn-danger" style="padding: 0.5rem 1rem;">
                            <i class="fas fa-times"></i> Clear
                        </button>
                    </form>
                    ` : ''}
                </div>
            </div>
            `).join('');
        }
        
        const content = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
            <h1><i class="fas fa-link"></i> URL Management</h1>
            <a href="/generate" class="btn btn-success">
                <i class="fas fa-plus"></i> New QR Code
            </a>
        </div>
        
        <div class="alert alert-info">
            <i class="fas fa-info-circle"></i>
            Custom URLs override default URLs. When users scan the QR code, they'll be redirected to the custom URL if set, otherwise to the default URL.
        </div>
        
        ${pairs.length === 0 ? 
            `<div class="alert alert-warning" style="text-align: center; padding: 3rem;">
                <i class="fas fa-qrcode" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                <h3>No QR Codes Found</h3>
                <p>Generate your first QR code to start managing URLs.</p>
                <a href="/generate" class="btn btn-success" style="margin-top: 1rem;">
                    <i class="fas fa-plus-circle"></i> Generate QR Code
                </a>
            </div>` : 
            pairsList
        }
        
        <div style="margin-top: 3rem; background: #f8f9fa; padding: 1.5rem; border-radius: var(--border-radius);">
            <h3><i class="fas fa-question-circle"></i> How URL Management Works</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-top: 1rem;">
                <div style="background: white; padding: 1rem; border-radius: var(--border-radius);">
                    <h4><i class="fas fa-arrow-right text-primary"></i> 1. User Scans QR</h4>
                    <p>The QR code contains your tracking link</p>
                </div>
                <div style="background: white; padding: 1rem; border-radius: var(--border-radius);">
                    <h4><i class="fas fa-database text-success"></i> 2. Scan is Recorded</h4>
                    <p>We track the scan in our database</p>
                </div>
                <div style="background: white; padding: 1rem; border-radius: var(--border-radius);">
                    <h4><i class="fas fa-link text-warning"></i> 3. Check for Custom URL</h4>
                    <p>System checks if custom URL is set</p>
                </div>
                <div style="background: white; padding: 1rem; border-radius: var(--border-radius);">
                    <h4><i class="fas fa-redo text-danger"></i> 4. Redirect User</h4>
                    <p>User is redirected to appropriate URL</p>
                </div>
            </div>
        </div>
        `;
        
        res.send(await layout(content, 'URL Management'));
    } catch (err) {
        console.error('URL management error:', err);
        const errorContent = `
        <div class="alert alert-danger">
            <i class="fas fa-exclamation-circle"></i>
            Error loading URL management: ${err.message}
        </div>
        <a href="/manage-urls" class="btn"><i class="fas fa-redo"></i> Try Again</a>
        `;
        res.send(await layout(errorContent, 'Management Error'));
    }
});

app.post('/update-url', requireBasicAuth, async (req, res) => {
    const { adId, locationId, customUrl, defaultRedirect } = req.body;
    
    try {
        // Validate URLs
        if (customUrl && !isValidHttpUrl(customUrl)) {
            return res.status(400).send('Invalid custom URL format.');
        }
        
        if (defaultRedirect && !isValidHttpUrl(defaultRedirect)) {
            return res.status(400).send('Invalid default redirect URL format.');
        }
        
        await GeneratedPair.findOneAndUpdate(
            { adId, locationId },
            { 
                customUrl: customUrl || null,
                defaultRedirect: defaultRedirect || 'https://acp.us',
                updatedAt: Date.now()
            },
            { upsert: true, new: true }
        );
        
        res.redirect('/manage-urls?updated=true');
    } catch (err) {
        console.error('Update URL error:', err);
        res.status(500).send('Error updating URL.');
    }
});

app.post('/clear-custom-url', requireBasicAuth, async (req, res) => {
    const { adId, locationId } = req.body;
    
    try {
        await GeneratedPair.findOneAndUpdate(
            { adId, locationId },
            { 
                customUrl: null,
                updatedAt: Date.now()
            }
        );
        
        res.redirect('/manage-urls?cleared=true');
    } catch (err) {
        console.error('Clear URL error:', err);
        res.status(500).send('Error clearing custom URL.');
    }
});

// Success page after generation
app.get('/generate/success', requireBasicAuth, (req, res) => {
    const content = `
    <div style="text-align: center; padding: 4rem 2rem;">
        <div style="font-size: 4rem; color: var(--success-color); margin-bottom: 2rem;">
            <i class="fas fa-check-circle"></i>
        </div>
        <h2>QR Code Generated Successfully!</h2>
        <p style="color: #666; margin: 1rem 0 2rem;">Your QR code has been created and is ready to use.</p>
        
        <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
            <a href="/generate" class="btn btn-success">
                <i class="fas fa-plus"></i> Create Another
            </a>
            <a href="/" class="btn">
                <i class="fas fa-home"></i> Back to Dashboard
            </a>
        </div>
    </div>
    `;
    
    res.send(layout(content, 'Success!'));
});

// QR Code Preview Page
app.get('/qr-preview/:adId/:locationId', requireBasicAuth, async (req, res) => {
    const { adId, locationId } = req.params;
    
    try {
        const token = generateSignedToken(adId, locationId);
        const url = getFullUrl(`/track/${token}`, req);
        const qrCodeDataUrl = await QRCode.toDataURL(url);
        
        const generatedPair = await GeneratedPair.findOne({ adId, locationId });
        const ad = await Ad.findOne({ adId });
        const location = await Location.findOne({ locationId });
        
        const content = `
        <div class="qr-preview">
            <h2><i class="fas fa-eye"></i> QR Code Preview</h2>
            <p><strong>Ad:</strong> ${ad?.name || adId}</p>
            <p><strong>Location:</strong> ${location?.name || locationId}</p>
            
            <div style="margin: 2rem 0;">
                <img src="${qrCodeDataUrl}" alt="QR Code">
            </div>
            
            <div style="background: #f8f9fa; padding: 1rem; border-radius: var(--border-radius); margin: 1rem 0;">
                <p><strong>Tracking URL:</strong><br>
                <small style="word-break: break-all;">${url}</small></p>
                
                <p><strong>Redirects to:</strong><br>
                <small style="color: ${generatedPair?.customUrl ? 'green' : 'gray'};">
                    ${generatedPair?.customUrl || generatedPair?.defaultRedirect || 'https://acp.us'}
                </small></p>
            </div>
            
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <a href="${url}" target="_blank" class="btn">
                    <i class="fas fa-external-link-alt"></i> Test Scan
                </a>
                <a href="/" class="btn btn-success">
                    <i class="fas fa-home"></i> Dashboard
                </a>
            </div>
        </div>
        `;
        
        res.send(layout(content, 'QR Preview'));
    } catch (err) {
        const errorContent = `
        <div class="alert alert-danger">
            <i class="fas fa-exclamation-circle"></i>
            Error loading QR preview: ${err.message}
        </div>
        `;
        res.send(layout(errorContent, 'Preview Error'));
    }
});

// Serve the file
app.get('/download-qr-excel', requireBasicAuth, (req, res) => {
    const filePath = path.join(__dirname, 'public', 'qr_metadata.xlsx');
    if (fs.existsSync(filePath)) {
        res.download(filePath, 'qr_metadata.xlsx');
    } else {
        res.status(404).send('File not found');
    }
});

// Rate limiters
app.use('/track', hybridLimiter);
app.use('/scans', scanViewLimiter);

// QR scan tracking
// QR scan tracking - FIXED VERSION
app.get('/track/:token', async (req, res) => {
    try {
        console.log('=== QR CODE SCANNED ===');
        console.log('Token:', req.params.token);
        
        const tokenData = verifySignedToken(req.params.token);
        console.log('Token data:', tokenData);
        
        if (!tokenData) {
            console.log('❌ Invalid token - redirecting to fallback');
            return res.redirect('https://acp.us');
        }

        const { adId, locationId } = tokenData;
        console.log('Ad ID:', adId, 'Location ID:', locationId);
        
        // Find location name
        const location = await Location.findOne({ locationId }).select('name');
        console.log('Location found:', location);
        
        if (!location) {
            console.log('❌ Location not found - redirecting to fallback');
            return res.redirect('https://acp.us');
        }

        // Generate or get session cookie
        let userSessionId = req.cookies.userSessionId;
        if (!userSessionId) {
            userSessionId = generateUniqueSessionId();
            console.log('Generated new session:', userSessionId);
            res.cookie('userSessionId', userSessionId, {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'Lax'
            });
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent') || 'Unknown';
        console.log('IP:', ipAddress, 'User Agent:', userAgent);

        // Check for duplicate scan within 24 hours
        const existingScan = await Scan.findOne({
            code: `${adId}-${locationId}`,
            $or: [
                { userSessionId },
                { ipAddress, userAgent }
            ],
            timestamp: { $gt: Date.now() - 24 * 60 * 60 * 1000 }
        });
        
        console.log('Existing scan:', existingScan ? 'Yes' : 'No');

        if (existingScan) {
            console.log('Duplicate scan detected - redirecting without saving');
            
            // Get redirect URL from GeneratedPair
            const generatedPair = await GeneratedPair.findOne({ adId, locationId });
            console.log('Generated pair found:', generatedPair ? 'Yes' : 'No');
            
            // Determine redirect URL
            let redirectUrl = 'https://acp.us'; // Default fallback
            
            if (generatedPair) {
                if (generatedPair.customUrl) {
                    redirectUrl = generatedPair.customUrl;
                } else if (generatedPair.defaultRedirect) {
                    redirectUrl = generatedPair.defaultRedirect;
                }
            }
            
            console.log('Redirecting duplicate scan to:', redirectUrl);
            return res.redirect(redirectUrl);
        }

        // Save the scan
        console.log('Creating new scan record...');
        
        // Get the redirect URL first (before saving)
        const generatedPair = await GeneratedPair.findOne({ adId, locationId });
        console.log('Generated pair found for redirect:', generatedPair ? 'Yes' : 'No');
        
        // Determine redirect URL
        let redirectUrl = 'https://acp.us'; // Default fallback
        
        if (generatedPair) {
            if (generatedPair.customUrl) {
                redirectUrl = generatedPair.customUrl;
            } else if (generatedPair.defaultRedirect) {
                redirectUrl = generatedPair.defaultRedirect;
            }
        }
        
        console.log('Will redirect to:', redirectUrl);

        // Save the scan (don't await - let it happen in background)
        Scan.create({
            code: `${adId}-${locationId}`,
            adId,
            locationId,
            locationName: location.name,
            userSessionId,
            ipAddress,
            userAgent
        }).then(() => {
            console.log('✅ Scan saved successfully');
        }).catch(err => {
            console.error('❌ Error saving scan:', err.message);
        });

        // Redirect immediately
        console.log('Redirecting user to:', redirectUrl);
        res.redirect(redirectUrl);
        
    } catch (err) {
        console.error('❌❌❌ Track route error:', err);
        // Always redirect somewhere, even on error
        res.redirect('https://acp.us');
    }
});

// Scans page: View all scans
app.get('/scans', async (req, res) => {
    try {
        const scans = await Scan.find().sort({ timestamp: -1 }).limit(100);
        const totalScans = await Scan.countDocuments();
        const uniqueSessions = await Scan.distinct('userSessionId').then(sessions => sessions.length);
        
        // Get scan statistics
        const scansByLocation = await Scan.aggregate([
            { $group: { _id: "$locationId", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        
        const scansByAd = await Scan.aggregate([
            { $group: { _id: "$adId", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        
        // Recent scans table
        let scansTable = '';
        if (scans.length > 0) {
            scansTable = `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th><i class="fas fa-hashtag"></i> Code</th>
                            <th><i class="fas fa-bullhorn"></i> Ad ID</th>
                            <th><i class="fas fa-map-marker-alt"></i> Location</th>
                            <th><i class="fas fa-clock"></i> Timestamp</th>
                            <th><i class="fas fa-user"></i> Session</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${scans.map(scan => `
                        <tr>
                            <td><code>${scan.code}</code></td>
                            <td><span class="badge badge-primary">${scan.adId}</span></td>
                            <td>${scan.locationName}</td>
                            <td>${moment(scan.timestamp).tz('America/New_York').format('YYYY-MM-DD hh:mm:ss A')}</td>
                            <td><small>${scan.userSessionId.substring(0, 8)}...</small></td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            `;
        }
        
        const content = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
            <h1><i class="fas fa-chart-bar"></i> Scan Analytics</h1>
            <div>
                <span class="badge badge-primary">${totalScans} Total Scans</span>
                <span class="badge badge-success">${uniqueSessions} Unique Users</span>
            </div>
        </div>

        <div class="stats-container">
            <div class="stat-card">
                <h3><i class="fas fa-chart-line"></i> Total Scans</h3>
                <div class="stat-value">${totalScans}</div>
                <div class="stat-label">All Time</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-users"></i> Unique Users</h3>
                <div class="stat-value">${uniqueSessions}</div>
                <div class="stat-label">Based on Session ID</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-map"></i> Top Location</h3>
                <div class="stat-value">${scansByLocation[0]?._id || 'N/A'}</div>
                <div class="stat-label">${scansByLocation[0]?.count || 0} scans</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-bullhorn"></i> Top Ad</h3>
                <div class="stat-value">${scansByAd[0]?._id || 'N/A'}</div>
                <div class="stat-label">${scansByAd[0]?.count || 0} scans</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin: 2rem 0;">
            <div style="background: white; padding: 1.5rem; border-radius: var(--border-radius); box-shadow: var(--box-shadow);">
                <h3><i class="fas fa-map-marker-alt"></i> Scans by Location</h3>
                ${scansByLocation.map(loc => `
                <div style="margin: 1rem 0;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>${loc._id}</span>
                        <span class="badge badge-primary">${loc.count}</span>
                    </div>
                    <div style="height: 8px; background: #e9ecef; border-radius: 4px;">
                        <div style="height: 100%; width: ${(loc.count / Math.max(...scansByLocation.map(l => l.count)) * 100)}%; 
                            background: var(--primary-color); border-radius: 4px;"></div>
                    </div>
                </div>
                `).join('')}
            </div>
            
            <div style="background: white; padding: 1.5rem; border-radius: var(--border-radius); box-shadow: var(--box-shadow);">
                <h3><i class="fas fa-bullhorn"></i> Scans by Ad</h3>
                ${scansByAd.map(ad => `
                <div style="margin: 1rem 0;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>${ad._id}</span>
                        <span class="badge badge-success">${ad.count}</span>
                    </div>
                    <div style="height: 8px; background: #e5e7eb; border-radius: 4px;">
                        <div style="height: 100%; width: ${(ad.count / Math.max(...scansByAd.map(a => a.count)) * 100)}%; 
                            background: var(--success-color); border-radius: 4px;"></div>
                    </div>
                </div>
                `).join('')}
            </div>
        </div>

        <h2><i class="fas fa-history"></i> Recent Scans (Last 100)</h2>
        ${scans.length === 0 ? 
            `<div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                No scans recorded yet. QR codes need to be scanned first.
            </div>` : 
            scansTable
        }
        
        <div style="margin-top: 2rem; display: flex; gap: 1rem;">
            <a href="/" class="btn">
                <i class="fas fa-arrow-left"></i> Back to QR Codes
            </a>
            <a href="/download-qr-excel" class="btn btn-success">
                <i class="fas fa-file-excel"></i> Export Data
            </a>
        </div>
        `;
        
        res.send(await layout(content, 'Scan Analytics'));
    } catch (err) {
        console.error('Analytics error:', err);
        const errorContent = `
        <div class="alert alert-danger">
            <i class="fas fa-exclamation-circle"></i>
            Error loading analytics: ${err.message}
        </div>
        <a href="/scans" class="btn"><i class="fas fa-redo"></i> Try Again</a>
        `;
        res.send(await layout(errorContent, 'Analytics Error'));
    }
});

// Generate individual QR with secure token
app.get('/generate-qr/:adId/:locationId', async (req, res) => {
    const { adId, locationId } = req.params;
    if (!isValidParam(adId) || !isValidParam(locationId)) {
        return res.status(400).send('Invalid input.');
    }

    const token = generateSignedToken(adId, locationId);
    const url = getFullUrl(`/track/${token}`, req);

    QRCode.toDataURL(url, (err, qrCodeDataUrl) => {
        if (err) return res.status(500).send('QR generation failed');
        res.send(`<img src="${qrCodeDataUrl}" alt="QR Code">`);
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send(`
        <div style="text-align: center; padding: 4rem 2rem;">
            <h1 style="color: var(--danger-color);"><i class="fas fa-exclamation-triangle"></i> 404 - Page Not Found</h1>
            <p style="margin: 2rem 0;">The page you're looking for doesn't exist.</p>
            <a href="/" class="btn">Go to Dashboard</a>
        </div>
    `);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).send(`
        <div style="text-align: center; padding: 4rem 2rem;">
            <h1 style="color: var(--danger-color);"><i class="fas fa-exclamation-circle"></i> 500 - Server Error</h1>
            <p style="margin: 2rem 0;">Something went wrong on our end.</p>
            <a href="/" class="btn">Go to Dashboard</a>
        </div>
    `);
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${port}/health`);
    console.log(`📊 Dashboard: http://localhost:${port}/`);
});