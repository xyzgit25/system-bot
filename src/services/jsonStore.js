const fs = require('fs').promises;
const path = require('path');

async function ensureDirectory(filePath) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}

function createJsonBackedMap(filename) {
    const map = new Map();
    const filePath = path.join(process.cwd(), 'data', filename);
    const legacyPath = path.join(process.cwd(), filename);

    async function load() {
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            map.clear();
            for (const [key, value] of Object.entries(parsed)) {
                map.set(key, value);
            }
            return map;
        } catch (error) {
            if (error.code === 'ENOENT') {
                try {
                    const legacyRaw = await fs.readFile(legacyPath, 'utf-8');
                    const legacyParsed = JSON.parse(legacyRaw);
                    map.clear();
                    for (const [key, value] of Object.entries(legacyParsed)) {
                        map.set(key, value);
                    }
                    return map;
                } catch (legacyError) {
                    if (legacyError.code !== 'ENOENT') {
                        throw legacyError;
                    }
                    return map;
                }
            }
            throw error;
        }
    }

    async function save() {
        await ensureDirectory(filePath);
        const serialized = JSON.stringify(Object.fromEntries(map), null, 2);
        await fs.writeFile(filePath, serialized, 'utf-8');
    }

    return { map, filePath, load, save };
}

module.exports = {
    createJsonBackedMap
};

