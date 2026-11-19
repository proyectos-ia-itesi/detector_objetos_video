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

// Estado del modelo: cuál está cargado en el motor y si hay una carga en curso.
let modeloMontado = 'yolo26x.pt';
let montajeId = 0;          // identifica la última carga pedida
let montando = false;

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
        actualizarBotonAnalizar();
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
    actualizarBotonAnalizar();
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
        const entrada = biblioteca.find((e) => e.id === seleccionadoId);
        if (!entrada) {
            throw new Error('Selecciona un video antes de analizar.');
        }

        const fps = parseFloat($('fps').value);
        const maxFrames = parseInt($('max-frames').value, 10);
        const ajustes = leerAjustes();
        const inicio = new Date();
        const modelo = ajustes.modelo;

        // 1) Se guarda el video y se abre un reporte; 2) se analizan los frames ligados a él;
        // 3) se cierra el reporte con el resumen del análisis.
        $('progreso-bloque').hidden = false;
        $('progreso').value = 0;
        $('progreso-texto').textContent = 'Subiendo video…';
        const reporteId = await subirVideo(entrada.archivo, fps, ajustes, maxFrames);

        const video = $('preview');
        const frames = await analizarVideo(video, fps, ajustes, maxFrames, reporteId);
        const resumen = agregarResultados(frames);
        // Datos del informe: se guardan junto al resumen para poder replicar el análisis.
        resumen.informe = {
            video: entrada.archivo.name,
            tamanoBytes: entrada.archivo.size,
            resolucion: `${video.videoWidth}×${video.videoHeight}`,
            duracion: video.duration,
            modelo,
            inicio: inicio.toISOString(),
            fin: new Date().toISOString(),
            fps,
            maxFrames,
            ajustes,
        };
        await finalizarReporte(reporteId, resumen);
        mostrarResultados(resumen);
    } catch (err) {
        mostrarError(err.message);
    } finally {
        actualizarBotonAnalizar();
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
        modelo: $('modelo').value,
        confianza: Number($('confianza').value) / 100,
        iou: Number($('iou').value) / 100,
        tamano: parseInt($('tamano').value, 10),
        clases: clasesSeleccionadas(),
    };
}

function restablecerAjustes() {
    $('modelo').value = 'yolo26x.pt';
    montarModelo();
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
$('modelo').addEventListener('change', montarModelo);

// ---------- Montaje del modelo ----------

// "Analizar" solo se habilita con un video elegido y sin una carga de modelo en curso.
function actualizarBotonAnalizar() {
    $('btn-analizar').disabled = seleccionadoId === null || montando;
}

function mostrarEstadoModelo(tipo, texto) {
    const estado = $('estado-modelo');
    estado.className = `estado-modelo ${tipo}`;
    $('estado-modelo-texto').textContent = texto;
    estado.hidden = false;
}

// Pide al motor que cargue el modelo elegido antes de analizar, para que el análisis
// no espere la carga. Mientras dura, no se puede iniciar un análisis.
async function montarModelo() {
    const nombre = $('modelo').value;
    if (nombre === modeloMontado && !montando) return;

    const id = ++montajeId;
    montando = true;
    actualizarBotonAnalizar();
    mostrarEstadoModelo('cargando', `Montando modelo ${nombre}…`);

    const formData = new FormData();
    formData.append('modelo', nombre);
    try {
        const datos = await enviar('cargar_modelo', formData);
        if (datos.codigo_motor !== 200) {
            throw new Error(datos.resultado?.detail ?? 'No se pudo montar el modelo.');
        }
        if (id !== montajeId) return;   // se eligió otro modelo mientras tanto
        modeloMontado = nombre;
        mostrarEstadoModelo('listo', `Modelo ${nombre} listo`);
    } catch (err) {
        if (id !== montajeId) return;
        mostrarEstadoModelo('error', err.message);
    } finally {
        if (id === montajeId) {
            montando = false;
            actualizarBotonAnalizar();
        }
    }
}

construirClases();
restablecerAjustes();

// ---------- Extracción de frames y análisis ----------

async function analizarVideo(video, fps, ajustes, maxFrames, reporteId) {
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

        const tarea = detectar(blob, ajustes, reporteId, tiempo)
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

// Envía un formulario a un servicio del backend y devuelve su respuesta JSON.
async function enviar(servicio, formData) {
    const res = await fetch(`${API}?servicio=${servicio}`, { method: 'POST', body: formData });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(datos.error ?? `El servicio "${servicio}" respondió con error ${res.status}.`);
    }
    return datos;
}

// Sube el video y abre un reporte con los ajustes. Devuelve el id del reporte.
async function subirVideo(archivo, fps, ajustes, maxFrames) {
    const formData = new FormData();
    formData.append('file', archivo, archivo.name);
    formData.append('modelo', ajustes.modelo);
    formData.append('fps', String(fps));
    formData.append('max_frames', String(maxFrames));
    formData.append('confianza', String(ajustes.confianza));
    formData.append('iou', String(ajustes.iou));
    formData.append('tamano', String(ajustes.tamano));
    if (ajustes.clases.length > 0) {
        formData.append('clases', ajustes.clases.join(','));
    }
    const datos = await enviar('subir_video', formData);
    return datos.reporte_id;
}

// Cierra el reporte guardando su resumen.
async function finalizarReporte(reporteId, resumen) {
    const formData = new FormData();
    formData.append('reporte_id', String(reporteId));
    formData.append('resumen', JSON.stringify(resumen));
    return enviar('finalizar_reporte', formData);
}

async function detectar(blob, ajustes, reporteId, instante) {
    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');
    formData.append('modelo', ajustes.modelo);
    formData.append('confianza', String(ajustes.confianza));
    formData.append('iou', String(ajustes.iou));
    formData.append('tamano', String(ajustes.tamano));
    if (ajustes.clases.length > 0) {
        formData.append('clases', ajustes.clases.join(','));
    }
    formData.append('reporte_id', String(reporteId));
    formData.append('instante', String(instante));

    const res = await fetch(`${API}?servicio=detect`, { method: 'POST', body: formData });
    if (!res.ok) {
        const datos = await res.json().catch(() => ({}));
        throw new Error(datos.error ?? `El servicio de detección respondió con error ${res.status}.`);
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
        serie: [],         // total de objetos por frame (incluye frames vacíos)
        serieClases: [],   // conteo por clase en cada frame (incluye frames vacíos)
    };

    for (const { tiempo, conteo, detecciones } of frames) {
        resumen.serie.push({ tiempo, total: detecciones.length });
        resumen.serieClases.push({ tiempo, conteo });

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

    renderizarInforme(resumen, clases);

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

// ---------- Informe (vista reporte) ----------

const NS_SVG = 'http://www.w3.org/2000/svg';

function formatearFecha(iso) {
    return new Date(iso).toLocaleString('es', { dateStyle: 'long', timeStyle: 'medium' });
}

// Rellena una lista de definiciones con pares [etiqueta, valor].
function rellenarPares(lista, pares) {
    lista.replaceChildren();
    for (const [etiqueta, valor] of pares) {
        const caja = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = etiqueta;
        dd.textContent = String(valor);
        caja.append(dt, dd);
        lista.appendChild(caja);
    }
}

// Crea un elemento SVG con sus atributos e hijos.
function crearSvg(tag, attrs = {}, hijos = []) {
    const el = document.createElementNS(NS_SVG, tag);
    for (const [clave, valor] of Object.entries(attrs)) {
        el.setAttribute(clave, String(valor));
    }
    el.append(...hijos);
    return el;
}

function renderizarInforme(resumen, clases) {
    const info = resumen.informe;
    if (!info) return;

    const totalObjetos = clases.reduce((suma, c) => suma + resumen.maxPorClase[c], 0);

    rellenarPares($('ficha-reporte'), [
        ['Video', info.video],
        ['Tamaño del archivo', formatearTamano(info.tamanoBytes)],
        ['Resolución del video', info.resolucion],
        ['Duración del video', formatearTiempo(info.duracion)],
        ['Modelo', info.modelo],
        ['Inicio del análisis', formatearFecha(info.inicio)],
        ['Fin del análisis', formatearFecha(info.fin)],
        ['Tiempo de análisis', formatearDuracion(new Date(info.fin) - new Date(info.inicio))],
        ['Frames analizados', resumen.totalFrames],
        ['Objetos detectados', totalObjetos],
    ]);

    rellenarPares($('ajustes-reporte'), [
        ['Frames por segundo', info.fps],
        ['Máximo de frames', info.maxFrames],
        ['Confianza mínima', `${Math.round(info.ajustes.confianza * 100)}%`],
        ['Umbral de solapamiento (IoU)', `${Math.round(info.ajustes.iou * 100)}%`],
        ['Tamaño de análisis', `${info.ajustes.tamano} px`],
        ['Clases', info.ajustes.clases.length > 0
            ? info.ajustes.clases.map(nombreClase).join(', ')
            : 'todas'],
    ]);

    $('descripcion-reporte').textContent = describirInforme(resumen, clases);

    $('grafica-barras').replaceChildren(graficaBarras(resumen, clases));
    $('grafica-presencia').replaceChildren(graficaPresencia(resumen, clases));
    $('grafica-conteo-clases').replaceChildren(graficaConteoClases(resumen, clases));
    $('grafica-linea').replaceChildren(graficaLinea(resumen));
    $('grafica-dona').replaceChildren(graficaDona(resumen, clases));
}

function describirInforme(resumen, clases) {
    const info = resumen.informe;
    const tiempoAnalisis = formatearDuracion(new Date(info.fin) - new Date(info.inicio));
    const partes = [
        `El video «${info.video}» dura ${formatearTiempo(info.duracion)} y se analizó ` +
        `con el modelo ${info.modelo} a ${info.fps} frame(s) por segundo, ` +
        `con ${resumen.totalFrames} frame(s) en total. El análisis tardó ${tiempoAnalisis}.`,
        describir(resumen, clases),
    ];

    const pico = resumen.serie.reduce((max, s) => (s.total > max.total ? s : max), { tiempo: 0, total: 0 });
    if (pico.total > 0) {
        partes.push(`El mayor número de objetos visibles a la vez fue ${pico.total}, ` +
            `en el segundo ${formatearTiempo(pico.tiempo)}.`);
    }

    return partes.join(' ');
}

// Barras horizontales: máximo de objetos visibles a la vez por tipo.
function graficaBarras(resumen, clases) {
    if (clases.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'suave';
        vacio.textContent = 'No hay objetos para graficar.';
        return vacio;
    }

    const ancho = 600;
    const filaAlto = 30;
    const etiquetaAncho = 130;
    const margenDerecho = 50;
    const areaAncho = ancho - etiquetaAncho - margenDerecho;
    const alto = clases.length * filaAlto + 4;
    const maximo = Math.max(...clases.map((c) => resumen.maxPorClase[c]));

    const hijos = clases.flatMap((clase, i) => {
        const valor = resumen.maxPorClase[clase];
        const y = i * filaAlto + 4;
        const largo = (valor / maximo) * areaAncho;
        return [
            crearSvg('text', {
                x: etiquetaAncho - 10, y: y + filaAlto / 2 + 4,
                'text-anchor': 'end', class: 'etiqueta-clase',
            }, [nombreClase(clase)]),
            crearSvg('rect', {
                x: etiquetaAncho, y: y + 6, width: largo, height: filaAlto - 12, rx: 4, class: 'barra',
            }),
            crearSvg('text', {
                x: etiquetaAncho + largo + 8, y: y + filaAlto / 2 + 4, class: 'etiqueta-valor',
            }, [String(valor)]),
        ];
    });

    return crearSvg('svg', {
        viewBox: `0 0 ${ancho} ${alto}`,
        role: 'img',
        'aria-label': 'Gráfica de barras: máximo de objetos a la vez por tipo',
    }, hijos);
}

// Línea de área: cuántos objetos hay visibles en cada instante del video.
function graficaLinea(resumen) {
    const serie = resumen.serie;
    if (serie.length === 0) return document.createTextNode('');

    const ancho = 600;
    const alto = 220;
    const izquierda = 44;
    const abajo = 28;
    const arriba = 12;
    const derecha = 12;
    const areaAncho = ancho - izquierda - derecha;
    const areaAlto = alto - arriba - abajo;

    const duracion = resumen.informe.duracion > 0
        ? resumen.informe.duracion
        : Math.max(serie[serie.length - 1].tiempo, 1);
    const maximo = Math.max(1, ...serie.map((s) => s.total));

    const x = (t) => izquierda + (Math.min(t, duracion) / duracion) * areaAncho;
    const y = (v) => arriba + areaAlto - (v / maximo) * areaAlto;
    const base = arriba + areaAlto;

    const puntos = serie.map((s) => `${x(s.tiempo).toFixed(1)},${y(s.total).toFixed(1)}`);
    const primero = x(serie[0].tiempo).toFixed(1);
    const ultimo = x(serie[serie.length - 1].tiempo).toFixed(1);

    // Líneas de rejilla y etiquetas del eje vertical (número de objetos)
    const niveles = [...new Set([0, Math.round(maximo / 2), maximo])];
    const rejilla = niveles.flatMap((v) => [
        crearSvg('line', { x1: izquierda, x2: ancho - derecha, y1: y(v), y2: y(v), class: 'rejilla' }),
        crearSvg('text', { x: izquierda - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'etiqueta' }, [String(v)]),
    ]);

    // Etiquetas del eje horizontal (tiempo): inicio, mitad y final
    const marcas = [0, duracion / 2, duracion].map((t) =>
        crearSvg('text', {
            x: x(t), y: alto - 6,
            'text-anchor': t === 0 ? 'start' : t === duracion ? 'end' : 'middle',
            class: 'etiqueta',
        }, [formatearTiempo(t)]));

    return crearSvg('svg', {
        viewBox: `0 0 ${ancho} ${alto}`,
        role: 'img',
        'aria-label': 'Gráfica de línea: objetos visibles a lo largo del video',
    }, [
        ...rejilla,
        crearSvg('path', {
            d: `M${primero},${base} L${puntos.join(' L')} L${ultimo},${base} Z`,
            class: 'area',
        }),
        crearSvg('polyline', { points: puntos.join(' '), class: 'linea' }),
        crearSvg('line', { x1: izquierda, x2: ancho - derecha, y1: base, y2: base, class: 'eje' }),
        ...marcas,
    ]);
}

const PALETA = ['#2563eb', '#f97316', '#16a34a', '#dc2626', '#9333ea',
                '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#65a30d'];
const colorDe = (indice) => PALETA[indice % PALETA.length];

// Tiempo de análisis en formato legible: "45 s" o "2 min 5 s".
function formatearDuracion(ms) {
    const segundos = Math.max(0, Math.round(ms / 1000));
    if (segundos < 60) return `${segundos} s`;
    return `${Math.floor(segundos / 60)} min ${segundos % 60} s`;
}

function duracionDelInforme(resumen) {
    return resumen.informe.duracion > 0
        ? resumen.informe.duracion
        : Math.max(resumen.serie[resumen.serie.length - 1].tiempo, 1);
}

function mensajeVacio(texto) {
    const p = document.createElement('p');
    p.className = 'suave';
    p.textContent = texto;
    return p;
}

// Leyenda con un punto de color por serie.
function leyenda(items) {
    const ul = document.createElement('ul');
    ul.className = 'leyenda';
    for (const { texto, color } of items) {
        const li = document.createElement('li');
        const punto = document.createElement('span');
        punto.className = 'punto';
        punto.style.background = color;
        li.append(punto, texto);
        ul.appendChild(li);
    }
    return ul;
}

// Tramos de tiempo en los que una clase está visible: [inicio, fin] en segundos.
function tramosDeClase(serieClases, clase, paso, duracion) {
    const tramos = [];
    let inicio = null;
    let ultimo = null;
    for (const { tiempo, conteo } of serieClases) {
        if ((conteo[clase] ?? 0) > 0) {
            inicio ??= tiempo;
            ultimo = tiempo;
        } else if (inicio !== null) {
            tramos.push([inicio, Math.min(ultimo + paso, duracion)]);
            inicio = null;
        }
    }
    if (inicio !== null) tramos.push([inicio, Math.min(ultimo + paso, duracion)]);
    return tramos;
}

// Presencia por tipo: una fila por clase, con barras donde aparece en el video.
function graficaPresencia(resumen, clases) {
    if (clases.length === 0) return mensajeVacio('No hay objetos para graficar.');

    const ancho = 600;
    const filaAlto = 30;
    const izquierda = 130;
    const derecha = 12;
    const arriba = 8;
    const abajo = 24;
    const areaAncho = ancho - izquierda - derecha;
    const areaAlto = clases.length * filaAlto;
    const alto = arriba + areaAlto + abajo;
    const duracion = duracionDelInforme(resumen);
    const paso = 1 / resumen.informe.fps;

    const x = (t) => izquierda + (Math.min(t, duracion) / duracion) * areaAncho;

    const hijos = [];
    for (const t of [0, duracion / 2, duracion]) {
        hijos.push(crearSvg('line', {
            x1: x(t), x2: x(t), y1: arriba, y2: arriba + areaAlto, class: 'rejilla',
        }));
        hijos.push(crearSvg('text', {
            x: x(t), y: alto - 6,
            'text-anchor': t === 0 ? 'start' : t === duracion ? 'end' : 'middle',
            class: 'etiqueta',
        }, [formatearTiempo(t)]));
    }

    clases.forEach((clase, i) => {
        const y = arriba + i * filaAlto;
        hijos.push(crearSvg('text', {
            x: izquierda - 10, y: y + filaAlto / 2 + 4, 'text-anchor': 'end', class: 'etiqueta-clase',
        }, [nombreClase(clase)]));
        for (const [inicio, fin] of tramosDeClase(resumen.serieClases, clase, paso, duracion)) {
            hijos.push(crearSvg('rect', {
                x: x(inicio), y: y + 7, width: Math.max(2, x(fin) - x(inicio)),
                height: filaAlto - 14, rx: 3, fill: colorDe(i),
            }));
        }
    });

    return crearSvg('svg', {
        viewBox: `0 0 ${ancho} ${alto}`,
        role: 'img',
        'aria-label': 'Gráfica de presencia: momentos en que aparece cada tipo de objeto',
    }, hijos);
}

// Conteo por tipo a lo largo del video: una línea por clase para compararlas.
function graficaConteoClases(resumen, clases) {
    if (clases.length === 0) return mensajeVacio('No hay objetos para graficar.');

    const ancho = 600;
    const alto = 220;
    const izquierda = 44;
    const abajo = 28;
    const arriba = 12;
    const derecha = 12;
    const areaAncho = ancho - izquierda - derecha;
    const areaAlto = alto - arriba - abajo;
    const duracion = duracionDelInforme(resumen);

    const maximo = Math.max(1, ...resumen.serieClases.flatMap(
        (s) => clases.map((c) => s.conteo[c] ?? 0)));
    const x = (t) => izquierda + (Math.min(t, duracion) / duracion) * areaAncho;
    const y = (v) => arriba + areaAlto - (v / maximo) * areaAlto;
    const base = arriba + areaAlto;

    const niveles = [...new Set([0, Math.round(maximo / 2), maximo])];
    const hijos = niveles.flatMap((v) => [
        crearSvg('line', { x1: izquierda, x2: ancho - derecha, y1: y(v), y2: y(v), class: 'rejilla' }),
        crearSvg('text', { x: izquierda - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'etiqueta' }, [String(v)]),
    ]);
    for (const t of [0, duracion / 2, duracion]) {
        hijos.push(crearSvg('text', {
            x: x(t), y: alto - 6,
            'text-anchor': t === 0 ? 'start' : t === duracion ? 'end' : 'middle',
            class: 'etiqueta',
        }, [formatearTiempo(t)]));
    }
    clases.forEach((clase, i) => {
        const puntos = resumen.serieClases
            .map((s) => `${x(s.tiempo).toFixed(1)},${y(s.conteo[clase] ?? 0).toFixed(1)}`)
            .join(' ');
        hijos.push(crearSvg('polyline', {
            points: puntos, fill: 'none', stroke: colorDe(i), 'stroke-width': 2, 'stroke-linejoin': 'round',
        }));
    });
    hijos.push(crearSvg('line', { x1: izquierda, x2: ancho - derecha, y1: base, y2: base, class: 'eje' }));

    const svg = crearSvg('svg', {
        viewBox: `0 0 ${ancho} ${alto}`,
        role: 'img',
        'aria-label': 'Gráfica de líneas: objetos visibles por tipo a lo largo del video',
    }, hijos);

    const contenedor = document.createElement('div');
    contenedor.append(svg, leyenda(clases.map((c, i) => ({ texto: nombreClase(c), color: colorDe(i) }))));
    return contenedor;
}

// Proporción de apariciones por tipo (gráfica de dona).
function graficaDona(resumen, clases) {
    const total = clases.reduce((suma, c) => suma + resumen.apariciones[c], 0);
    if (total === 0) return mensajeVacio('No hay objetos para graficar.');

    const radio = 70;
    const circunferencia = 2 * Math.PI * radio;
    const centro = 100;
    let acumulado = 0;

    const arcos = clases.map((clase, i) => {
        const longitud = (resumen.apariciones[clase] / total) * circunferencia;
        const arco = crearSvg('circle', {
            cx: centro, cy: centro, r: radio, fill: 'none',
            stroke: colorDe(i), 'stroke-width': 28,
            'stroke-dasharray': `${longitud} ${circunferencia - longitud}`,
            'stroke-dashoffset': String(-acumulado),
            transform: `rotate(-90 ${centro} ${centro})`,
        });
        acumulado += longitud;
        return arco;
    });

    const svg = crearSvg('svg', {
        viewBox: '0 0 200 200', class: 'dona', role: 'img',
        'aria-label': 'Gráfica de dona: proporción de apariciones por tipo',
    }, [
        ...arcos,
        crearSvg('text', { x: centro, y: centro + 2, 'text-anchor': 'middle', class: 'etiqueta-valor' }, [String(total)]),
        crearSvg('text', { x: centro, y: centro + 18, 'text-anchor': 'middle', class: 'etiqueta' }, ['apariciones']),
    ]);

    const contenedor = document.createElement('div');
    contenedor.className = 'dona-contenido';
    contenedor.append(svg, leyenda(clases.map((c, i) => ({
        texto: `${nombreClase(c)}: ${resumen.apariciones[c]} (${Math.round((resumen.apariciones[c] / total) * 100)}%)`,
        color: colorDe(i),
    }))));
    return contenedor;
}

function mostrarError(mensaje) {
    const el = $('error');
    el.textContent = mensaje;
    el.hidden = false;
}

function ocultarError() {
    $('error').hidden = true;
}
