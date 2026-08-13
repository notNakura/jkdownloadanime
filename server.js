const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const proxyRoutes = require('./src/routes/proxy');
const checkStreamRoutes = require('./src/routes/checkStream');

const app = express();

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    // El polling de progreso ya tiene su propio limiter (progressLimiter) más
    // permisivo montado antes que este. Como express corre TODOS los
    // middlewares cuyo path matchea (no solo el más específico), sin este
    // "skip" las requests de polling también quedaban contadas acá contra el
    // límite de 20/min, así que el front terminaba viendo "Demasiadas
    // solicitudes" aunque el backend siguiera procesando todo con normalidad.
    skip: req => /^\/check-stream\/[^/]+\/progress/.test(req.path),
    message: { error: 'Demasiadas solicitudes, esperá un momento.' }
});

// El polling de progreso hace una request corta cada 1.5s mientras dura
// la verificación (puede ser varios minutos con 1000+ episodios), así
// que necesita un límite mucho más alto que el resto de la API.
const progressLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, esperá un momento.' }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10kb' }));

app.use('/api/check-stream/:jobId/progress', progressLimiter);
app.use('/api', apiLimiter);
app.use('/api', proxyRoutes);
app.use('/api', checkStreamRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(config.PORT, () => {
    console.log(`\n🚀 Servidor corriendo en: http://localhost:${config.PORT}`);
    console.log(`📦 Concurrencia de episodios: ${config.EPISODE_CONCURRENCY}`);
});

process.on('uncaughtException', error => {
    console.error('❌ Error no capturado:', error.message);
    process.exit(1);
});

process.on('unhandledRejection', error => {
    console.error('❌ Promesa rechazada:', error?.message || error);
    process.exit(1);
});
