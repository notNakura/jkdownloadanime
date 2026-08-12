function construirEnlace(server, remoteDecoded) {
    const nombre = server.server;

    if (nombre === 'Mega') {
        let idMatch = remoteDecoded.match(/\/embed\/([^?]+)\?/);
        let keyMatch = remoteDecoded.match(/\?(.+)/);

        if (!idMatch || !keyMatch) {
            idMatch = remoteDecoded.match(/\/embed\/([^#]+)#/);
            keyMatch = remoteDecoded.match(/#(.+)/);
        }

        if (idMatch && keyMatch) {
            return `https://mega.nz/file/${idMatch[1]}#${keyMatch[1]}`;
        }
        return null;
    }

    if (nombre === 'Mediafire') {
        return remoteDecoded;
    }

    return null;
}

module.exports = construirEnlace;
