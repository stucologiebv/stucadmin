const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'mailout.hostnet.nl',
    port: 587,
    secure: false,
    auth: {
        user: 'info@stucadmin.nl',
        pass: 'ppGmklop@2025'
    }
});

transporter.verify()
    .then(() => {
        console.log('SMTP OK - connection works');
        return transporter.sendMail({
            from: 'info@stucadmin.nl',
            to: 'minas@stucologie.nl',
            subject: 'Test email',
            text: 'Dit is een test'
        });
    })
    .then(() => console.log('Email sent!'))
    .catch(e => console.log('Error:', e.message))
    .finally(() => process.exit());
