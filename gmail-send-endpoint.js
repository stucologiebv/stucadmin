// ALGEMENE EMAIL SEND ENDPOINT
// Voeg dit toe NA de send-manstaat endpoint (rond regel 2260)

app.post('/api/gmail/send', requireAuth, async (req, res) => {
    const { to, subject, body } = req.body;
    
    if (!to || !subject || !body) {
        return res.status(400).json({ error: 'Ontvanger, onderwerp en bericht zijn verplicht' });
    }
    
    try {
        const accessToken = await getValidGoogleToken();
        if (!accessToken) {
            return res.status(401).json({ error: 'Google niet verbonden', needsAuth: true });
        }
        
        const fetch = (await import('node-fetch')).default;
        
        // Create simple HTML email
        const emailContent = [
            `To: ${to}`,
            `From: info@stucologie.nl`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            body
        ].join('\r\n');
        
        // Base64 encode for Gmail API
        const encodedEmail = Buffer.from(emailContent)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: encodedEmail })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Gmail send error:', data.error);
            return res.status(400).json({ error: data.error.message || 'Fout bij verzenden' });
        }
        
        console.log(`📧 Email verzonden naar: ${to}`);
        res.json({ success: true, messageId: data.id });
        
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ error: error.message });
    }
});
