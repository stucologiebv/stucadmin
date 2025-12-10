const crypto = require('crypto');
const storedHash = 'cf5cb268a03cf0c5e8908fcac80e1bcd:23c6dd1728827c0831b5e2ce530bcd46f1a8d4a56d4212bcd0f2fe66e63bf876900f4efe1da1c92a3d7509aa59c628d6731ae485e95a240b588b027f981b810d';
const pin = '8226';
const [salt, hash] = storedHash.split(':');
const verifyHash = crypto.pbkdf2Sync(pin, salt, 100000, 64, 'sha512').toString('hex');
console.log('Stored hash:', hash);
console.log('Computed hash:', verifyHash);
console.log('Match:', hash === verifyHash);
