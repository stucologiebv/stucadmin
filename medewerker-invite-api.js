// POST /api/team/invite-medewerker - Vast personeel uitnodigen
app.post('/api/team/invite-medewerker', requireAuth, async (req, res) => {
    const companyId = req.session?.bedrijf_id;
    if (!companyId) return res.status(400).json({ error: 'Geen bedrijf gekoppeld' });
    
    const { email, naam, contractType, message } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email is verplicht' });
    }
    
    try {
        // Genereer unieke token
        const token = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date();
        expires.setDate(expires.getDate() + 7); // 7 dagen geldig
        
        // Sla invite op
        const invites = loadCompanyData(companyId, 'medewerkerInvites') || [];
        invites.push({
            id: 'inv_' + Date.now(),
            token,
            email,
            naam: naam || '',
            contractType: contractType || 'arbeidsovereenkomst',
            message: message || '',
            type: 'vast',
            createdAt: new Date().toISOString(),
            expires: expires.toISOString(),
            status: 'pending'
        });
        saveCompanyData(companyId, 'medewerkerInvites', invites);
        
        // Stuur email (als SMTP geconfigureerd is)
        const company = loadCompanyData(companyId, 'settings') || {};
        const companyName = company.bedrijfsnaam || 'StucAdmin';
        const inviteUrl = `https://stucadmin.nl/medewerker-registratie.html?token=${token}`;
        
        // Check of we email kunnen sturen
        const smtpConfig = loadCompanyData(companyId, 'smtp');
        if (smtpConfig && smtpConfig.host) {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: smtpConfig.host,
                port: smtpConfig.port || 587,
                secure: smtpConfig.secure || false,
                auth: {
                    user: smtpConfig.user,
                    pass: smtpConfig.pass
                }
            });
            
            await transporter.sendMail({
                from: smtpConfig.from || smtpConfig.user,
                to: email,
                subject: `Uitnodiging om te werken bij ${companyName}`,
                html: `
                    <h2>Welkom bij ${companyName}!</h2>
                    <p>${naam ? `Hoi ${naam},` : 'Hoi,'}</p>
                    ${message ? `<p>${message}</p>` : ''}
                    <p>Je bent uitgenodigd om je te registreren als medewerker.</p>
                    <p><a href="${inviteUrl}" style="background:#8b5cf6;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Registreren</a></p>
                    <p><small>Deze link is 7 dagen geldig.</small></p>
                `
            });
            
            console.log(`📨 Medewerker uitnodiging verzonden naar ${email}`);
            res.json({ success: true, message: 'Uitnodiging verzonden' });
        } else {
            // Geen SMTP - geef link terug
            console.log(`📨 Medewerker uitnodiging aangemaakt voor ${email} (geen email verzonden)`);
            res.json({ 
                success: true, 
                message: 'Uitnodiging aangemaakt (email niet geconfigureerd)',
                inviteUrl 
            });
        }
        
    } catch (e) {
        console.error('Medewerker invite error:', e);
        res.status(500).json({ error: 'Fout bij verzenden uitnodiging' });
    }
});
