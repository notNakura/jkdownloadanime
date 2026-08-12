const express = require('express');
const { fetchJkanimePage } = require('../services/jkanimeService');

const router = express.Router();

router.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ error: 'Se requiere el parámetro ?url=' });
    }

    console.log(`[PROXY] 📥 Solicitando: ${targetUrl}`);

    try {
        const html = await fetchJkanimePage(targetUrl);
        res.send(html);
    } catch (error) {
        console.error(`[PROXY] ❌ Error: ${error.message}`);
        res.status(error.status || 500).json({ error: error.message || 'Error al obtener la página' });
    }
});

module.exports = router;
