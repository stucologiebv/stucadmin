const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '.data', 'medewerkers.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const milan = data.find(m => m.naam.includes('Milan'));
if (milan) {
    console.log('Gevonden:', milan.naam);
    console.log('Huidige pincode (gehasht):', milan.pincode.substring(0, 30) + '...');
    
    // Reset naar plaintext 8225 - wordt automatisch gehasht bij eerste login
    milan.pincode = '8225';
    
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log('PIN gereset naar: 8225');
} else {
    console.log('Milan niet gevonden!');
}
