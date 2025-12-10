const nodemailer = require('nodemailer');

// Test verschillende SMTP servers
const configs = [
    { name: 'smtp.hostnet.nl:587', host: 'smtp.hostnet.nl', port: 587, secure: false },
    { name: 'smtp.hostnet.nl:465', host: 'smtp.hostnet.nl', port: 465, secure: true },
    { name: 'mailout.hostnet.nl:587', host: 'mailout.hostnet.nl', port: 587, secure: false },
    { name: 'mail.hostnet.nl:587', host: 'mail.hostnet.nl', port: 587, secure: false },
];

async function testConfig(cfg) {
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: 'info@stucadmin.nl', pass: 'ppGmklop@2025' },
        connectionTimeout: 5000
    });
    
    try {
        await transporter.verify();
        console.log('✅', cfg.name, '- WORKS!');
        return true;
    } catch (e) {
        console.log('❌', cfg.name, '-', e.message);
        return false;
    }
}

(async () => {
    for (const cfg of configs) {
        const ok = await testConfig(cfg);
        if (ok) break;
    }
    process.exit();
})();
