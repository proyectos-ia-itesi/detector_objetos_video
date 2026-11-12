# Frontend (`frontend/`)

Interfaz web del detector de objetos. Es una página estática (HTML, CSS y JavaScript sin dependencias) servida por Apache. Toda la lógica de extracción de frames corre en el navegador del usuario; el servidor solo sirve los archivos y reenvía las llamadas a la API.

---

## Estructura

| Archivo | Qué contiene |
|---|---|
| `Dockerfile` | Imagen `httpd:2.4-alpine`. Copia `httpd.conf` y `public/` a Apache. |
| `httpd.conf` | Configuración mínima de Apache: sirve `public/` y hace proxy de `/api/` hacia `http://backend/`. |
| `public/index.html` | Estructura de la página: biblioteca (izquierda), visor y resultados (centro) y ajustes (derecha). |
| `public/css/styles.css` | Estilos, disposición en tres columnas y tema claro/oscuro según el sistema. |
| `public/js/app.js` | Lógica: biblioteca de videos, extracción de frames, llamadas al backend y presentación de resultados. |

---

## Disposición

- **Izquierda, *Videos*:** agrega archivos de video desde el equipo (se guardan solo en memoria durante la sesión), elige uno con un clic y lo quita con **Quitar selección** o volviendo a pulsarlo.
- **Centro, *Video seleccionado* y *Resultados*:** muestra el video elegido en el visor, el botón **Analizar video**, el progreso y, al terminar, los resultados.
- **Derecha, *Ajustes*:** controla el análisis (ver tabla más abajo).

En pantallas de menos de 1024 px las tres columnas se apilan en ese orden.

Mientras se analiza, los paneles de videos y de ajustes quedan bloqueados para no cambiar nada a mitad del proceso.

---

## Ajustes

| Ajuste | Por defecto | Rango | Efecto |
|---|---|---|---|
| Frames por segundo a analizar | 1 | 0.5, 1, 2, 4 | Cuántos frames por segundo de video se analizan. |
| Máximo de frames a analizar | 600 | 300, 600, 1200, 2400 | Tope de frames del análisis; los videos largos se recortan a este número. |
| Confianza mínima | 50 % | 5 % a 95 % | Descarta las detecciones con menos confianza. |
| Umbral de solapamiento (IoU) | 70 % | 10 % a 90 % | Controla cuándo dos cajas se consideran el mismo objeto. |
| Tamaño de análisis | 640 | 480, 640, 960, 1280 | Resolución con la que se analiza cada frame. También fija el ancho del frame enviado. |
| Clases a detectar | todas | casillas | Si no se marca ninguna, se detectan todas las clases. |

**Restablecer ajustes** vuelve a los valores por defecto. Los ajustes no se guardan entre recargas de la página.

---

## Flujo de un análisis

1. `leerAjustes()` toma los valores de los controles.
2. `analizarVideo()` espera los metadatos del video y calcula cuántos frames se analizarán: `min(duración × fps + 1, máximo de frames)`.
3. Para cada instante, el video se posiciona con `currentTime`, se dibuja en un `<canvas>` y se exporta como JPEG.
4. Cada JPEG se envía con `detectar()` a `services.php?servicio=detect`, junto con los ajustes. Hasta **4 peticiones** (`CONCURRENCIA`) se procesan en paralelo.
5. Cada respuesta se filtra con la confianza elegida (`filtrarDetecciones()`) y se guarda por frame.
6. Al completarse todos los frames, `agregarResultados()` calcula el resumen y `mostrarResultados()` lo pinta en las vistas de conteo y reporte.

Si el motor rechaza una petición (por ejemplo, por una clase no reconocida), el backend responde con código 200 pero con `codigo_motor` distinto de 200. El frontend revisa ese campo y muestra el error en pantalla.

---

## Constantes configurables en `app.js`

| Constante | Valor | Descripción |
|---|---|---|
| `API` | `/api/services.php` | Punto de entrada del backend. |
| `CONCURRENCIA` | `4` | Peticiones de detección simultáneas. Subirla acelera el análisis si el motor tiene recursos; también aumenta la carga del servidor. |
| `ANCHO_MAXIMO_FRAME` | `1280` | Tope de seguridad para el ancho del frame enviado. |
| `AJUSTES_POR_DEFECTO` | `{ confianza: 50, iou: 70, tamano: 640 }` | Valores de **Restablecer ajustes**. |
| `TRADUCCIONES` | 40 clases COCO | Nombres en español mostrados en la interfaz. Las clases que no están aquí se muestran en inglés. |

---

## Limitaciones conocidas

- **Formatos de video:** depende de lo que el navegador pueda decodificar. Algunos formatos (HEVC, MKV en ciertos navegadores) pueden no reproducirse ni analizarse.
- **Traducciones:** la lista de clases y los resultados solo traducen 40 de las 80 clases de COCO. El filtro de clases solo ofrece esas 40.
- **Búsqueda en el video:** `capturarFrame()` espera el evento `seeked`. Si el instante pedido coincide con la posición actual, algunos navegadores no disparan el evento y el análisis puede quedarse esperando.
- **Sin persistencia:** los videos de la biblioteca y los ajustes viven solo mientras la pestaña está abierta.

---

## Probar la interfaz

1. Levanta los contenedores: `docker compose up --build`.
2. Abre http://localhost:8080.
3. Agrega un video, elígelo y pulsa **Analizar video**.

Tras cambiar algo en `public/`, reconstruye solo este servicio: `docker compose up -d --build frontend`.
