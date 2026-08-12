const { File } = require('megajs');

async function verificarMega(enlace) {
    if (!enlace) return false;

    try {
        const file = File.fromURL(enlace);
        await file.loadAttributes();
        return !!file.name;
    } catch (error) {
        return false;
    }
}

module.exports = verificarMega;
