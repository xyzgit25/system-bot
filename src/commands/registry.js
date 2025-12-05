function createCommandRegistry(handlerGroups = []) {
    const commandMap = new Map();

    for (const group of handlerGroups) {
        if (!group) continue;
        for (const [name, handler] of Object.entries(group)) {
            if (commandMap.has(name)) {
                console.warn(`⚠️ Befehl ${name} wird mehrfach registriert. Überschreibe vorhandenen Handler.`);
            }
            commandMap.set(name, handler);
        }
    }

    return {
        get(name) {
            return commandMap.get(name);
        },
        entries() {
            return commandMap.entries();
        }
    };
}

module.exports = {
    createCommandRegistry
};

