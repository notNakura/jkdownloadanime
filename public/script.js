const urlInput = document.getElementById('urlInput');
const checkBtn = document.getElementById('checkBtn');
const error = document.getElementById('error');
const errorMsg = document.getElementById('errorMsg');
const initialLoader = document.getElementById('initialLoader');
const resultsPanel = document.getElementById('resultsPanel');
const resultsGifContainer = document.getElementById('resultsGifContainer');

const initialState = document.getElementById('initialState');
const notFoundState = document.getElementById('notFoundState');
const serverErrorState = document.getElementById('serverErrorState');

const megaList = document.getElementById('megaList');
const mediafireList = document.getElementById('mediafireList');
const mixedList = document.getElementById('mixedList');

const megaCount = document.getElementById('megaCount');
const mediafireCount = document.getElementById('mediafireCount');
const mixedCount = document.getElementById('mixedCount');

const megaBadge = document.getElementById('megaBadge');
const mediafireBadge = document.getElementById('mediafireBadge');
const mixedBadge = document.getElementById('mixedBadge');

const copyMegaBtn = document.getElementById('copyMegaBtn');
const copyMediafireBtn = document.getElementById('copyMediafireBtn');
const copyMixedBtn = document.getElementById('copyMixedBtn');

const megaFilterInput = document.getElementById('megaFilter');
const mediafireFilterInput = document.getElementById('mediafireFilter');
const mixedFilterInput = document.getElementById('mixedFilter');

const megaFilterClearBtn = document.getElementById('megaFilterClear');
const mediafireFilterClearBtn = document.getElementById('mediafireFilterClear');
const mixedFilterClearBtn = document.getElementById('mixedFilterClear');

let episodeData = {};
let totalEpisodes = 0;
let rangeStart = 1;
let rangeEnd = 0;
let currentAnimeName = '';

function hideAllStates() {
    initialState.classList.remove('active');
    notFoundState.classList.remove('active');
    serverErrorState.classList.remove('active');
    initialLoader.classList.remove('active');
    resultsPanel.classList.remove('active');
    resultsGifContainer.classList.remove('active');
}

function showInitialState() {
    hideAllStates();
    initialState.classList.add('active');
}

function showNotFoundState() {
    hideAllStates();
    notFoundState.classList.add('active');
}

function showServerErrorState() {
    hideAllStates();
    serverErrorState.classList.add('active');
}

function buildPlaceholderRows() {
    megaList.innerHTML = '';
    mediafireList.innerHTML = '';
    mixedList.innerHTML = '';

    for (let ep = rangeStart; ep <= rangeEnd; ep++) {
        megaList.appendChild(makeRow(ep, checkingStatus()));
        mediafireList.appendChild(makeRow(ep, checkingStatus()));
        mixedList.appendChild(makeRow(ep, checkingStatus()));
    }
}

function attachEpisodeFilter(inputEl, listEl, clearBtn) {
    if (!inputEl || !listEl) {
        return;
    }

    const applyFilter = () => {
        const query = inputEl.value.trim();

        listEl.querySelectorAll('.ep-item').forEach(row => {
            const match = query === '' || row.dataset.ep === query;
            row.style.display = match ? '' : 'none';
        });

        if (clearBtn) {
            clearBtn.hidden = query === '';
        }
    };

    inputEl.addEventListener('input', applyFilter);

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            inputEl.value = '';
            applyFilter();
            inputEl.focus();
        });
    }
}

function clearEpisodeFilters() {
    [
        [megaFilterInput, megaFilterClearBtn],
        [mediafireFilterInput, mediafireFilterClearBtn],
        [mixedFilterInput, mixedFilterClearBtn]
    ].forEach(([input, clearBtn]) => {
        if (input) {
            input.value = '';
        }

        if (clearBtn) {
            clearBtn.hidden = true;
        }
    });
}

function makeRow(ep, statusHtml) {
    const row = document.createElement('div');

    row.className = 'ep-item';
    row.id = 'ep-' + ep;
    row.dataset.ep = ep;

    row.innerHTML = `
        <span class="ep-num">#${ep}</span>
        <span class="ep-status">${statusHtml}</span>
    `;

    return row;
}

function checkingStatus() {
    return `
        <span class="badge-status checking">
            <span class="spinner-small"></span>
            verificando
        </span>
    `;
}

function unavailableStatus(label) {
    return `
        <span class="badge-status unavailable">
            ${label}
        </span>
    `;
}

function availableStatus(link, size, extra) {
    const short = link.length > 42 ? link.slice(0, 42) + '…' : link;

    return `
        <a href="${link}" target="_blank" rel="noopener" class="link">
            ${short}
        </a>
        <span class="size">
            (${extra ? extra + ' · ' : ''}${size || '?'})
        </span>
    `;
}

function updateRow(container, ep, statusHtml) {
    const row = container.querySelector(`#ep-${ep}`) || makeRow(ep, statusHtml);

    row.querySelector('.ep-status').innerHTML = statusHtml;

    if (!container.contains(row)) {
        container.appendChild(row);
    }

    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
}

function updateStats() {
    try {
        updateStatsInner();
    } catch (e) {
        console.error('updateStats failed:', e);
    }
}

function updateStatsInner() {
    const values = Object.values(episodeData);

    const megaOk = values.filter(e => e.mega && e.mega !== 'checking').length;
    const megaChecking = values.filter(e => e.mega === 'checking').length;
    const mfOk = values.filter(e => e.mediafire && e.mediafire !== 'checking').length;
    const mfChecking = values.filter(e => e.mediafire === 'checking').length;
    const mixedOk = values.filter(e => e.mejor).length;

    megaCount.textContent = `${megaOk} disponibles`;
    mediafireCount.textContent = `${mfOk} disponibles`;
    mixedCount.textContent = `${mixedOk} disponibles`;

    megaBadge.textContent = megaChecking > 0 ? `${megaChecking} pendientes` : 'listo';
    mediafireBadge.textContent = mfChecking > 0 ? `${mfChecking} pendientes` : 'listo';

    mixedBadge.textContent =
        values.length > 0 &&
        values.every(e => e.mega !== 'checking' && e.mediafire !== 'checking')
            ? 'listo'
            : `${values.filter(e => e.mega === 'checking' || e.mediafire === 'checking').length} pendientes`;

    copyMegaBtn.disabled = megaOk === 0;
    copyMediafireBtn.disabled = mfOk === 0;
    copyMixedBtn.disabled = mixedOk === 0;
}

function processMessage(data) {
    if (data.type !== 'result') {
        return;
    }

    const ep = data.episodio;

    episodeData[ep] = {
        mega: data.mega || null,
        mediafire: data.mediafire || null,
        mejor: null
    };

    if (data.mediafire) {
        episodeData[ep].mejor = {
            link: data.mediafire.link,
            servidor: 'Mediafire',
            size: data.mediafire.size
        };
    } else if (data.mega) {
        episodeData[ep].mejor = {
            link: data.mega.link,
            servidor: 'Mega',
            size: data.mega.size
        };
    }

    updateRow(
        megaList,
        ep,
        data.mega
            ? availableStatus(data.mega.link, data.mega.size)
            : unavailableStatus('no disponible')
    );

    updateRow(
        mediafireList,
        ep,
        data.mediafire
            ? availableStatus(data.mediafire.link, data.mediafire.size)
            : unavailableStatus('no disponible')
    );

    const mejor = episodeData[ep].mejor;

    updateRow(
        mixedList,
        ep,
        mejor
            ? availableStatus(mejor.link, mejor.size, mejor.servidor)
            : unavailableStatus('sin enlace')
    );

    updateStats();
}

let pollTimer = null;
let pollAbortController = null;
let pollGeneration = 0;

function fetchConTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(url, {
        ...options,
        signal: controller.signal
    }).finally(() => clearTimeout(timer));
}

function detenerPolling() {
    pollGeneration++;
    clearTimeout(pollTimer);
    pollTimer = null;

    if (pollAbortController) {
        pollAbortController.abort();
        pollAbortController = null;
    }
}

function mostrarErrorFatal(mensaje) {
    detenerPolling();
    showServerErrorState();
    error.classList.remove('active');
    checkBtn.disabled = false;
    console.error(mensaje);
}

function startVerification(url) {
    episodeData = {};
    totalEpisodes = 0;

    hideAllStates();
    initialLoader.classList.add('active');
    error.classList.remove('active');
    checkBtn.disabled = true;
    detenerPolling();

    const myGeneration = ++pollGeneration;

    fetchConTimeout(
        '/api/check-stream/start',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
        },
        20000
    )
        .then(async response => {
            let body = {};

            try {
                body = await response.json();
            } catch {
                body = {};
            }

            if (!response.ok) {
                const errorObj = new Error(body.error || `HTTP ${response.status}`);
                errorObj.status = response.status;
                throw errorObj;
            }

            return body;
        })
        .then(data => {
            if (myGeneration !== pollGeneration) {
                return;
            }

            totalEpisodes = data.total;
            rangeStart = data.rangeStart || 1;
            rangeEnd = data.rangeEnd || data.total;
            currentAnimeName = data.anime || '';

            episodeData = {};

            for (let ep = rangeStart; ep <= rangeEnd; ep++) {
                episodeData[ep] = {
                    mega: 'checking',
                    mediafire: 'checking',
                    mejor: null
                };
            }

            initialLoader.classList.remove('active');
            resultsGifContainer.classList.add('active');
            resultsPanel.classList.add('active');

            clearEpisodeFilters();
            buildPlaceholderRows();
            updateStats();

            pollProgress(data.jobId, 0, myGeneration, 0);
        })
        .catch(err => {
            if (myGeneration !== pollGeneration) {
                return;
            }

            console.error('Error starting verification:', err);
            checkBtn.disabled = false;
            initialLoader.classList.remove('active');

            if (err.status === 404) {
                showNotFoundState();
            } else {
                showServerErrorState();
            }
        });
}

const POLL_INTERVAL_MS = 1500;
const MAX_FALLOS_SEGUIDOS = 6;

function pollProgress(jobId, since, myGeneration, fallosSeguidos) {
    if (myGeneration !== pollGeneration) {
        return;
    }

    fetchConTimeout(
        `/api/check-stream/${jobId}/progress?since=${since}`,
        {},
        15000
    )
        .then(async response => {
            let body = {};

            try {
                body = await response.json();
            } catch {
                body = {};
            }

            if (!response.ok) {
                const errorObj = new Error(body.error || `HTTP ${response.status}`);
                errorObj.status = response.status;
                throw errorObj;
            }

            return body;
        })
        .then(data => {
            if (myGeneration !== pollGeneration) {
                return;
            }

            for (const resultado of data.results || []) {
                processMessage({
                    type: 'result',
                    ...resultado
                });
            }

            if (data.error) {
                mostrarErrorFatal(data.error);
                return;
            }

            if (data.done) {
                detenerPolling();
                checkBtn.disabled = false;
                mixedBadge.textContent = 'listo';
                return;
            }

            pollTimer = setTimeout(
                () => pollProgress(jobId, data.nextIndex, myGeneration, 0),
                POLL_INTERVAL_MS
            );
        })
        .catch(err => {
            if (myGeneration !== pollGeneration) {
                return;
            }

            console.error('Polling error:', err);

            const fallos = fallosSeguidos + 1;

            if (fallos >= MAX_FALLOS_SEGUIDOS) {
                mostrarErrorFatal(
                    'El servidor no respondió a tiempo. Revisa que esté corriendo y mira su consola.'
                );
                return;
            }

            pollTimer = setTimeout(
                () => pollProgress(jobId, since, myGeneration, fallos),
                POLL_INTERVAL_MS
            );
        });
}

function getEnlacesPorTipo(tipo, filterEp) {
    const enlaces = [];

    for (const ep of Object.keys(episodeData).sort((a, b) => parseInt(a) - parseInt(b))) {
        if (filterEp && ep !== filterEp) {
            continue;
        }

        const item = episodeData[ep];

        if (tipo === 'mega' && item.mega && item.mega !== 'checking') {
            enlaces.push(item.mega.link);
        } else if (tipo === 'mediafire' && item.mediafire && item.mediafire !== 'checking') {
            enlaces.push(item.mediafire.link);
        } else if (tipo === 'mixed' && item.mejor) {
            enlaces.push(item.mejor.link);
        }
    }

    return enlaces;
}

function setCopyButtonSuccess(button) {
    if (!button) {
        return;
    }

    const text = button.querySelector('.copy-text');

    if (!text) {
        return;
    }

    if (button._copyTimer) {
        clearTimeout(button._copyTimer);
    }

    button.classList.add('copy-success');

    const originalText = text.textContent;
    button._originalText = originalText;

    text.textContent = '¡Copiado!';

    button._copyTimer = setTimeout(() => {
        button.classList.remove('copy-success');
        text.textContent = button._originalText || 'Copiar';
        button._copyTimer = null;
    }, 1500);
}

function copiarConFallback(texto, callback) {
    const textarea = document.createElement('textarea');

    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        const correcto = document.execCommand('copy');

        if (correcto && callback) {
            callback();
        }
    } catch (err) {
        console.error('Could not copy:', err);
    }

    document.body.removeChild(textarea);
}

function copyEnlaces(tipo, button, filterInput) {
    const filterEp = filterInput ? filterInput.value.trim() : '';
    const enlaces = getEnlacesPorTipo(tipo, filterEp);

    if (enlaces.length === 0) {
        return;
    }

    const texto = enlaces.join('\n');
    const copiaExitosa = () => {
        setCopyButtonSuccess(button);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
            .writeText(texto)
            .then(copiaExitosa)
            .catch(() => {
                copiarConFallback(texto, copiaExitosa);
            });

        return;
    }

    copiarConFallback(texto, copiaExitosa);
}

checkBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();

    if (!url || !url.includes('jkanime.net')) {
        errorMsg.textContent = 'Ingresa una URL válida de JKanime';
        error.classList.add('active');
        return;
    }

    error.classList.remove('active');
    startVerification(url);
});

urlInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
        checkBtn.click();
    }
});

copyMegaBtn.addEventListener('click', () =>
    copyEnlaces('mega', copyMegaBtn, megaFilterInput)
);

copyMediafireBtn.addEventListener('click', () =>
    copyEnlaces('mediafire', copyMediafireBtn, mediafireFilterInput)
);

copyMixedBtn.addEventListener('click', () =>
    copyEnlaces('mixed', copyMixedBtn, mixedFilterInput)
);

attachEpisodeFilter(megaFilterInput, megaList, megaFilterClearBtn);
attachEpisodeFilter(mediafireFilterInput, mediafireList, mediafireFilterClearBtn);
attachEpisodeFilter(mixedFilterInput, mixedList, mixedFilterClearBtn);