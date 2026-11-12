// Frontend del detector de objetos en video.
// 1) El usuario agrega videos a la biblioteca y elige uno.
// 2) El navegador extrae frames del video a la frecuencia elegida.
// 3) Cada frame se envía al backend (services.php?servicio=detect), varios en paralelo.
// 4) Se agregan los resultados y se muestran conteos, línea de tiempo y descripción.

const API = '/api/services.php';
const ANCHO_MAXIMO_FRAME = 1280;   // tope de seguridad para el ancho del frame enviado
const CONCURRENCIA = 4;            // peticiones de detección simultáneas

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

// ---------- Biblioteca de videos (panel izquierdo) ----------

let biblioteca = [];        // videos agregados en esta sesión: { id, archivo, url? }
let contadorId = 0;
let seleccionadoId = null;  // video elegido; se muestra en el visor central

$('video-input').addEventListener('change', (e) => {
    for (const archivo of e.target.files) {
        biblioteca.push({ id: ++contadorId, archivo });
    }
    e.target.value = '';    // permite volver a agregar el mismo archivo
    renderizarLista();
});

function renderizarLista() {
    const lista = $('lista-videos');
    lista.replaceChildren();

    for (const { id, archivo } of biblioteca) {
        const activo = id === seleccionadoId;

        const li = document.createElement('li');
        li.className = 'video-item' + (activo ? ' seleccionado' : '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(activo));
        li.tabIndex = 0;

        const nombre = document.createElement('span');
        nombre.className = 'video-nombre';
        nombre.textContent = archivo.name;

        const meta = document.createElement('span');
        meta.className = 'suave';
        meta.textContent = formatearTamano(archivo.size) + (activo ? ' · Seleccionado' : '');

        li.append(nombre, meta);
        li.addEventListener('click', () => alternarSeleccion(id));
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                alternarSeleccion(id);
            }
        });
        lista.appendChild(li);
    }

    $('lista-vacia').hidden = biblioteca.length > 0;
    $('btn-quitar').disabled = seleccionadoId === null;
}

// Elegir otro video lo cambia; volver a pulsar el seleccionado lo quita.
function alternarSeleccion(id) {
    const nuevo = seleccionadoId === id ? null : id;
    aplicarSeleccion(biblioteca.find((v) => v.id === nuevo) ?? null);
    renderizarLista();
}

$('btn-quitar').addEventListener('click', () => {
    aplicarSeleccion(null);
    renderizarLista();
});

// URL reproducible de un video de la biblioteca (se crea una sola vez por video).
function urlDe(entrada) {
    entrada.url ??= URL.createObjectURL(entrada.archivo);
    return entrada.url;
}

// ---------- Visor central ----------

// Muestra el video elegido en el visor central, o el recuadro vacío si es null.
function aplicarSeleccion(entrada) {
    seleccionadoId = entrada?.id ?? null;

    const video = $('preview');
    $('resultados').hidden = true;
    ocultarError();

    if (!entrada) {
        video.pause();
        video.removeAttribute('src');
        video.removeAttribute('data-id');
        video.load();
        video.hidden = true;
        $('visor-vacio').hidden = false;
        $('archivo-nombre').hidden = true;
        $('btn-analizar').disabled = true;
        return;
    }

    if (video.dataset.id !== String(entrada.id)) {
        video.src = urlDe(entrada);
        video.dataset.id = String(entrada.id);
        video.load();
    }
    video.hidden = false;
    $('visor-vacio').hidden = true;

    $('archivo-nombre').textContent = `Video seleccionado: ${entrada.archivo.name}`;
    $('archivo-nombre').hidden = false;
    $('btn-analizar').disabled = false;
}

function formatearTamano(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mientras se analiza, no se puede cambiar de video ni de ajustes.
function bloquearPaneles(bloquear) {
    $('panel-videos').inert = bloquear;
    $('panel-ajustes').inert = bloquear;
}

$('btn-analizar').addEventListener('click', async () => {
    const boton = $('btn-analizar');
    boton.disabled = true;
    bloquearPaneles(true);
    ocultarError();
    $('resultados').hidden = true;

    try {
        const fps = parseFloat($('fps').value);
        const maxFrames = parseInt($('max-frames').value, 10);
        const ajustes = leerAjustes();
        const frames = await analizarVideo($('preview'), fps, ajustes, maxFrames);
        const resumen = agregarResultados(frames);
        mostrarResultados(resumen);
    } catch (err) {
        mostrarError(err.message);
    } finally {
        boton.disabled = false;
        bloquearPaneles(false);
        $('progreso-bloque').hidden = true;
    }
});

// ---------- Ajustes de detección (panel derecho) ----------

// Valores de los controles en porcentaje (se convierten a 0–1 al enviarlos).
const AJUSTES_POR_DEFECTO = { confianza: 50, iou: 70, tamano: 640 };

function construirClases() {
    const lista = $('clases-lista');
    const ordenadas = Object.entries(TRADUCCIONES)
        .sort((a, b) => a[1].localeCompare(b[1], 'es'));

    for (const [ingles, espanol] of ordenadas) {
        const etiqueta = document.createElement('label');
        etiqueta.className = 'clase-opcion';

        const casilla = document.createElement('input');
        casilla.type = 'checkbox';
        casilla.value = ingles;
        casilla.addEventListener('change', actualizarResumenClases);

        etiqueta.append(casilla, ` ${espanol}`);
        lista.appendChild(etiqueta);
    }
}

function clasesSeleccionadas() {
    return [...document.querySelectorAll('#clases-lista input:checked')].map((c) => c.value);
}

function actualizarResumenClases() {
    const n = clasesSeleccionadas().length;
    $('clases-resumen').textContent = n === 0 ? 'todas' : `${n} seleccionada(s)`;
}

function actualizarSalidas() {
    $('confianza-valor').textContent = `${$('confianza').value}%`;
    $('iou-valor').textContent = `${$('iou').value}%`;
}

// Lee los controles y los devuelve con los valores que entiende el motor.
function leerAjustes() {
    return {
        confianza: Number($('confianza').value) / 100,
        iou: Number($('iou').value) / 100,
        tamano: parseInt($('tamano').value, 10),
        clases: clasesSeleccionadas(),
    };
}

function restablecerAjustes() {
    $('confianza').value = AJUSTES_POR_DEFECTO.confianza;
    $('iou').value = AJUSTES_POR_DEFECTO.iou;
    $('tamano').value = String(AJUSTES_POR_DEFECTO.tamano);
    for (const casilla of document.querySelectorAll('#clases-lista input')) {
        casilla.checked = false;
    }
    actualizarSalidas();
    actualizarResumenClases();
}

$('confianza').addEventListener('input', actualizarSalidas);
$('iou').addEventListener('input', actualizarSalidas);
$('btn-restablecer').addEventListener('click', restablecerAjustes);

construirClases();
restablecerAjustes();

// ---------- Extracción de frames y análisis ----------

async function analizarVideo(video, fps, ajustes, maxFrames) {
    await esperarMetadatos(video);

    const duracion = video.duration;
    if (!isFinite(duracion) || duracion <= 0) {
        throw new Error('No se pudo leer la duración del video.');
    }

    const paso = 1 / fps;
    const framesDisponibles = Math.floor(duracion * fps) + 1;
    const totalFrames = Math.min(framesDisponibles, maxFrames);
    const canvas = crearCanvas(video, ajustes.tamano);

    $('progreso-bloque').hidden = false;
    actualizarProgreso(0, totalFrames);

    const frames = new Array(totalFrames);
    const enCurso = new Set();
    let completados = 0;
    let error = null;

    // Los frames se capturan en orden (el video se busca instante a instante),
    // pero sus peticiones al motor se envían en paralelo, hasta CONCURRENCIA a la vez.
    for (let i = 0; i < totalFrames; i++) {
        const tiempo = Math.min(i * paso, duracion);
        const blob = await capturarFrame(video, canvas, tiempo);

        while (enCurso.size >= CONCURRENCIA && !error) {
            await Promise.race(enCurso);
        }
        if (error) break;

        const tarea = detectar(blob, ajustes)
            .then((detecciones) => {
                const aceptadas = filtrarDetecciones(detecciones, ajustes.confianza);
                frames[i] = { tiempo, conteo: contarClases(aceptadas), detecciones: aceptadas };
                completados++;
                actualizarProgreso(completados, totalFrames);
            })
            .catch((err) => { error ??= err; })
            .finally(() => enCurso.delete(tarea));
        enCurso.add(tarea);
    }

    await Promise.all(enCurso);
    if (error) throw error;

    if (framesDisponibles > maxFrames) {
        $('progreso-texto').textContent +=
            ` · Se analizaron solo los primeros ${maxFrames} frames.`;
    }

    return frames;
}

function actualizarProgreso(hechos, total) {
    $('progreso').value = total > 0 ? Math.round((hechos / total) * 100) : 0;
    $('progreso-texto').textContent = `Frames analizados: ${hechos} de ${total}`;
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

// El ancho del frame sigue al tamaño de análisis: más resolución de entrada
// solo sirve si el frame enviado tiene esa resolución.
function crearCanvas(video, ancho) {
    const canvas = document.createElement('canvas');
    const destino = Math.min(ancho, ANCHO_MAXIMO_FRAME);
    const escala = Math.min(1, destino / video.videoWidth);
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

async function detectar(blob, ajustes) {
    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');
    formData.append('confianza', String(ajustes.confianza));
    formData.append('iou', String(ajustes.iou));
    formData.append('tamano', String(ajustes.tamano));
    if (ajustes.clases.length > 0) {
        formData.append('clases', ajustes.clases.join(','));
    }

    const res = await fetch(`${API}?servicio=detect`, { method: 'POST', body: formData });
    if (!res.ok) {
        throw new Error(`El servicio de detección respondió con error ${res.status}.`);
    }

    // El backend responde 200 aunque el motor rechace la petición; hay que revisarlo.
    const datos = await res.json();
    if (datos.codigo_motor !== 200) {
        const detalle = datos.resultado?.detail;
        throw new Error(`El motor rechazó el análisis: ${typeof detalle === 'string' ? detalle : 'parámetros no válidos'}.`);
    }
    return datos.resultado?.detecciones ?? [];
}

// ---------- Agregación de resultados ----------

// Deja solo las detecciones que superan la confianza mínima elegida.
function filtrarDetecciones(detecciones, confianzaMinima) {
    return detecciones
        .filter((d) => !(typeof d.confianza === 'number' && d.confianza < confianzaMinima))
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

// Muestra solo la vista elegida (conteo o reporte).
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
