// Frontend del detector de objetos en video.
// 1) El navegador extrae frames del video a la frecuencia elegida.
// 2) Cada frame se envía al backend (services.php?servicio=detect).
// 3) Se agregan los resultados y se muestran conteos, línea de tiempo y descripción.

const API = '/api/services.php';
const MAX_FRAMES = 300;          // límite de seguridad para videos largos
const ANCHO_MAXIMO = 640;        // ancho de los frames enviados (reduce el tamaño)
const CONFIANZA_MINIMA = 0.5;    // confianza mínima interna (ya no se muestra en la interfaz)

// Traducción de las clases más comunes (nombres COCO). Si no está, se muestra tal cual.
const TRADUCCIONES = {
    person: 'persona', bicycle: 'bicicleta', car: 'auto', motorcycle: 'motocicleta',
    airplane: 'avión', bus: 'autobús', train: 'tren', truck: 'camión', boat: 'barco',
    'traffic light': 'semáforo', 'stop sign': 'señal de alto', bench: 'banca',
    bird: 'pájaro', cat: 'gato', dog: 'perro', horse: 'caballo', sheep: 'oveja',
    cow: 'vaca', elephant: 'elefante', bear: 'oso', zebra: 'cebra', giraffe: 'jirafa',
    backpack: 'mochila', umbrella: 'paraguas', handbag: 'bolso', suitcase: 'maleta',
    bottle: 'botella', cup: 'taza', chair: 'silla', couch: 'sofá', tv: 'televisor',
    laptop: 'laptop', 'cell phone': 'celular', book: 'libro', clock: 'reloj',
    'dining table': 'mesa', pizza: 'pizza', cake: 'pastel', apple: 'manzana',
    banana: 'plátano', sandwich: 'sándwich', orange: 'naranja', scissors: 'tijeras',
};

const $ = (id) => document.getElementById(id);

let urlVideo = null;

// ---------- Eventos de la interfaz ----------

$('video-input').addEventListener('change', (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;

    if (urlVideo) URL.revokeObjectURL(urlVideo);
    urlVideo = URL.createObjectURL(archivo);

    const video = $('preview');
    video.src = urlVideo;
    video.load();
    video.hidden = false;

    $('archivo-nombre').textContent = `Video seleccionado: ${archivo.name}`;
    $('archivo-nombre').hidden = false;
    $('btn-analizar').disabled = false;
    $('resultados').hidden = true;
    ocultarError();
});

$('btn-analizar').addEventListener('click', async () => {
    const boton = $('btn-analizar');
    boton.disabled = true;
    ocultarError();
    $('resultados').hidden = true;

    try {
        const fps = parseFloat($('fps').value);
        const frames = await analizarVideo($('preview'), fps);
        const resumen = agregarResultados(frames);
        mostrarResultados(resumen);
    } catch (err) {
        mostrarError(err.message);
    } finally {
        boton.disabled = false;
        $('progreso-bloque').hidden = true;
    }
});

$('btn-health').addEventListener('click', async () => {
    const estado = $('estado-servicios');
    try {
        const res = await fetch(`${API}?servicio=health`);
        const datos = await res.json();
        estado.textContent = `Backend: ${datos.backend} · Motor: ${datos.motor}`;
    } catch (err) {
        estado.textContent = 'No se pudo contactar el backend.';
    }
});

// ---------- Extracción de frames ----------

async function analizarVideo(video, fps) {
    await esperarMetadatos(video);

    const duracion = video.duration;
    if (!isFinite(duracion) || duracion <= 0) {
        throw new Error('No se pudo leer la duración del video.');
    }

    const paso = 1 / fps;
    const totalFrames = Math.min(Math.floor(duracion * fps) + 1, MAX_FRAMES);
    const canvas = crearCanvas(video);

    $('progreso-bloque').hidden = false;
    const frames = [];

    for (let i = 0; i < totalFrames; i++) {
        const tiempo = Math.min(i * paso, duracion);
        const blob = await capturarFrame(video, canvas, tiempo);
        const detecciones = await detectar(blob);

        const aceptadas = filtrarDetecciones(detecciones);
        frames.push({
            tiempo,
            conteo: contarClases(aceptadas),
            detecciones: aceptadas,
        });

        const porcentaje = Math.round(((i + 1) / totalFrames) * 100);
        $('progreso').value = porcentaje;
        $('progreso-texto').textContent =
            `Analizando frame ${i + 1} de ${totalFrames} (${formatearTiempo(tiempo)})`;
    }

    if (Math.floor(duracion * fps) + 1 > MAX_FRAMES) {
        $('progreso-texto').textContent +=
            ` · Se analizaron solo los primeros ${MAX_FRAMES} frames.`;
    }

    return frames;
}

function esperarMetadatos(video) {
    if (video.readyState >= 1) return Promise.resolve();
    return esperarEvento(video, 'loadedmetadata');
}

function esperarEvento(elemento, evento) {
    return new Promise((resolve, reject) => {
        const alOcurrir = () => { limpiar(); resolve(); };
        const alFallar = () => { limpiar(); reject(new Error('Error al leer el video.')); };
        const limpiar = () => {
            elemento.removeEventListener(evento, alOcurrir);
            elemento.removeEventListener('error', alFallar);
        };
        elemento.addEventListener(evento, alOcurrir);
        elemento.addEventListener('error', alFallar);
    });
}

function crearCanvas(video) {
    const canvas = document.createElement('canvas');
    const escala = Math.min(1, ANCHO_MAXIMO / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * escala);
    canvas.height = Math.round(video.videoHeight * escala);
    return canvas;
}

async function capturarFrame(video, canvas, tiempo) {
    video.currentTime = tiempo;
    await esperarEvento(video, 'seeked');

    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('No se pudo capturar un frame.')),
            'image/jpeg',
            0.85
        );
    });
}

// ---------- Comunicación con el backend ----------

async function detectar(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');

    const res = await fetch(`${API}?servicio=detect`, { method: 'POST', body: formData });
    if (!res.ok) {
        throw new Error(`El servicio de detección respondió con error ${res.status}.`);
    }

    const datos = await res.json();
    return datos.resultado?.detecciones ?? [];
}

// ---------- Agregación de resultados ----------

// Deja solo las detecciones que superan la confianza mínima interna.
function filtrarDetecciones(detecciones) {
    return detecciones
        .filter((d) => !(typeof d.confianza === 'number' && d.confianza < CONFIANZA_MINIMA))
        .map((d) => ({
            clase: String(d.clase ?? 'desconocido'),
            confianza: typeof d.confianza === 'number' ? d.confianza : null,
        }));
}

// Cuenta cuántos objetos de cada clase hay en un frame.
function contarClases(detecciones) {
    const conteo = {};
    for (const d of detecciones) {
        conteo[d.clase] = (conteo[d.clase] ?? 0) + 1;
    }
    return conteo;
}

function agregarResultados(frames) {
    const resumen = {
        totalFrames: frames.length,
        maxPorClase: {},   // mayor número visible a la vez
        apariciones: {},   // suma de detecciones en todos los frames
        primera: {},       // primer instante en que aparece
        ultima: {},        // último instante en que aparece
        linea: [],         // frames con detecciones
    };

    for (const { tiempo, conteo, detecciones } of frames) {
        const clases = Object.keys(conteo);
        if (clases.length === 0) continue;

        resumen.linea.push({ tiempo, conteo, detecciones });

        for (const clase of clases) {
            const n = conteo[clase];
            resumen.maxPorClase[clase] = Math.max(resumen.maxPorClase[clase] ?? 0, n);
            resumen.apariciones[clase] = (resumen.apariciones[clase] ?? 0) + n;
            resumen.primera[clase] ??= tiempo;
            resumen.ultima[clase] = tiempo;
        }
    }

    return resumen;
}

// ---------- Presentación ----------

function mostrarResultados(resumen) {
    const clases = Object.keys(resumen.maxPorClase)
        .sort((a, b) => resumen.maxPorClase[b] - resumen.maxPorClase[a]);

    const totalObjetos = clases.reduce((suma, c) => suma + resumen.maxPorClase[c], 0);

    $('total-objetos').textContent = totalObjetos;
    $('total-clases').textContent = clases.length;
    $('total-frames').textContent = resumen.totalFrames;

    const descripcion = describir(resumen, clases);
    $('descripcion').textContent = descripcion;
    $('descripcion-reporte').textContent = descripcion;

    const tbody = $('tabla-conteo');
    tbody.replaceChildren();
    for (const clase of clases) {
        const fila = document.createElement('tr');
        const celdas = [
            nombreClase(clase),
            resumen.maxPorClase[clase],
            resumen.apariciones[clase],
            `${formatearTiempo(resumen.primera[clase])} – ${formatearTiempo(resumen.ultima[clase])}`,
        ];
        for (const valor of celdas) {
            const td = document.createElement('td');
            td.textContent = valor;
            fila.appendChild(td);
        }
        tbody.appendChild(fila);
    }

    // Reporte: una fila por cada objeto encontrado, en orden de tiempo
    const tbodyReporte = $('tabla-reporte');
    tbodyReporte.replaceChildren();
    let filas = 0;
    for (const { tiempo, detecciones } of resumen.linea) {
        for (const d of detecciones) {
            const fila = document.createElement('tr');
            const celdas = [
                formatearTiempo(tiempo),
                nombreClase(d.clase),
                d.confianza === null ? 'N/D' : `${Math.round(d.confianza * 100)}%`,
            ];
            for (const valor of celdas) {
                const td = document.createElement('td');
                td.textContent = valor;
                fila.appendChild(td);
            }
            tbodyReporte.appendChild(fila);
            filas++;
        }
    }
    $('total-reporte').textContent = filas === 0
        ? 'No hay objetos para mostrar.'
        : `${filas} objeto(s) encontrado(s) en total.`;

    aplicarTipoResultado();
    $('resultados').hidden = false;
}

// Muestra solo la vista elegida en el selector (conteo o reporte).
function aplicarTipoResultado() {
    const reporte = $('tipo-resultado').value === 'reporte';
    $('vista-conteo').hidden = reporte;
    $('vista-reporte').hidden = !reporte;
}

$('tipo-resultado').addEventListener('change', aplicarTipoResultado);

function describir(resumen, clases) {
    if (clases.length === 0) {
        return 'No se detectaron objetos en el video con la confianza mínima seleccionada.';
    }

    const totalObjetos = clases.reduce((suma, c) => suma + resumen.maxPorClase[c], 0);
    const partes = clases.map((c) =>
        `${nombreClase(c)}: hasta ${resumen.maxPorClase[c]} a la vez, ` +
        `visible entre ${formatearTiempo(resumen.primera[c])} y ${formatearTiempo(resumen.ultima[c])}`
    );

    return `En el video se detectaron ${totalObjetos} objeto(s) de ${clases.length} tipo(s). ` +
        partes.join('. ') + '.';
}

function nombreClase(clase) {
    return TRADUCCIONES[clase.toLowerCase()] ?? clase;
}

function formatearTiempo(segundos) {
    const total = Math.floor(segundos ?? 0);
    const min = Math.floor(total / 60);
    const seg = String(total % 60).padStart(2, '0');
    return `${min}:${seg}`;
}

function mostrarError(mensaje) {
    const el = $('error');
    el.textContent = mensaje;
    el.hidden = false;
}

function ocultarError() {
    $('error').hidden = true;
}
