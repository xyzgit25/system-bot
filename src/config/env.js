const dotenv = require('dotenv');

dotenv.config();

const requiredVariables = ['TOKEN'];
const missing = requiredVariables.filter((key) => !process.env[key]);

if (missing.length > 0) {
    throw new Error(`Fehlende Pflicht-Umgebungsvariablen: ${missing.join(', ')}`);
}

function getEnv() {
    return process.env;
}

module.exports = {
    getEnv
};

