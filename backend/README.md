# Backend (`backend/`)

API de entrada del sistema. Un único punto de entrada (`public/services.php`) que enruta cada petición a su servicio en `app/`; el frontend la llama a través de `/api/`. Su función es validar la petición, reenviarla al motor de IA, guardar el resultado en MySQL y devolver la respuesta envuelta en JSON. No hace inferencia.

---

## Estructura

| Archivo | Qué contiene |
|---|---|
| `Dockerfile` | Imagen `php:8.3-apache` con `pdo_mysql`. Copia `public/` a la web y `app/` fuera de ella. |
| `public/services.php` | Punto de entrada único. Solo enruta: decide el servicio según `servicio` y el método HTTP. |
| `config/uploads.ini` | Límites de subida de PHP (videos de hasta 1 GB). |
| `app/config.php` | Dirección del motor y carpeta de videos. |
| `app/bootstrap.php` | Carga todo el código de `app/`. |
| `app/almacenamiento.php` | Guarda y borra videos en disco; genera la clave única. |
| `app/nucleo/` | `respuesta.php` (JSON y códigos), `validacion.php` (ajustes y nombres seguros), `basedatos.php` (conexión y transacciones). |
| `app/repositorios/` | Consultas SQL por tabla: `archivos.php`, `reportes.php`, `analisis.php` (imágenes y detecciones). |
| `app/servicios/` | Un archivo por endpoint: `salud.php`, `videos.php`, `motor.php` (`detect`), `reportes.php` (`finalizar_reporte`). |

`app/` no es accesible por HTTP: solo `public/` está en la raíz web.

---

## Endpoints

Todos se llaman a través del frontend como `/api/services.php?servicio=…`.

### `GET ?servicio=health`

Comprueba el backend y el motor.

```json
{ "backend": "ok", "motor": "ok" }
```

`motor` vale `"no disponible"` si el motor no responde o no devuelve `200` en `/health` dentro de 5 segundos.

### `POST ?servicio=subir_video`

Recibe un video y lo guarda en el volumen `videos-data` como `/var/www/uploads/<clave_unica>/<nombre>`. La clave única es un UUID v4 que identifica cada video; el nombre conserva el original, limpiando los caracteres no válidos en disco. Registra:

- una fila en `archivos` con la clave única, el nombre original, el nombre guardado y la ruta;
- una fila en `reportes` con los ajustes del análisis (`fps`, `max_frames`, `confianza`, `iou`, `tamano`, `clases`) y estado `en_curso`.

**Entrada** (`multipart/form-data`): `file` (video), `fps`, `max_frames`, `confianza`, `iou`, `tamano` y, opcional, `clases`. Los ajustes se validan por rango; si uno no es válido, responde `400`.

**Salida** (`200`): `{ "archivo_id": 1, "reporte_id": 1, "clave_unica": "…", "nombre": "mi_video.mp4" }`.

Si el registro en la base de datos falla, el video se borra del disco y responde `503`.

Si el video no es de tipo `video/*` (se comprueba por su contenido, no por la extensión) responde `400`.

### `POST ?servicio=detect`

Reenvía una imagen al motor para detectar objetos y guarda el resultado en la base de datos: una fila en `imagenes` y una en `detecciones` por cada objeto. Ambas inserciones van en una transacción; si falla cualquiera, no se guarda nada.

Campos opcionales para asociar el frame a un reporte:

| Campo | Descripción |
|---|---|
| `reporte_id` | Reporte abierto con `subir_video`. Debe existir y seguir `en_curso`; si no, `400`. |
| `instante` | Segundo del video en que se tomó el frame (obligatorio si va `reporte_id`). |

**Entrada** (`multipart/form-data`):

| Campo | Obligatorio | Descripción |
|---|---|---|
| `file` | sí | Imagen (en la práctica, un frame JPEG). |
| `confianza` | no | Confianza mínima, de 0 a 1. |
| `iou` | no | Umbral de solapamiento, de 0 a 1. |
| `tamano` | no | Tamaño de análisis, múltiplo de 32. |
| `max_det` | no | Máximo de detecciones por imagen. |
| `clases` | no | Nombres de clase separados por coma (`person,car`). |

Solo se reenvían esos cinco campos de ajustes; cualquier otro campo de `$_POST` se ignora. Si un ajuste no llega, el motor usa su valor por defecto.

**Salida** (`200`):

```json
{
  "codigo_motor": 200,
  "resultado": {
    "archivo": "frame.jpg",
    "ancho": 640,
    "alto": 360,
    "tamano_bytes": 48213,
    "detecciones": [
      { "clase": "person", "confianza": 0.9407, "x1": 48, "y1": 398, "x2": 245, "y2": 902 }
    ]
  }
}
```

`imagen_id` es el id de la fila guardada en `imagenes` (`null` si el motor rechazó la petición). `resultado` es exactamente la respuesta del motor. Si el motor rechaza la petición, `codigo_motor` tiene el código del motor (por ejemplo `400` o `422`) y `resultado` trae el campo `detail` con el motivo.

### `POST ?servicio=finalizar_reporte`

Cierra un reporte. Campos: `reporte_id` y `resumen` (JSON con el resumen del análisis). El backend calcula `frames_analizados` y `total_detecciones` a partir de lo guardado, marca el reporte como `completado` y guarda la fecha de cierre.

**Salida** (`200`): `{ "reporte_id": 1, "estado": "completado", "frames_analizados": 600, "total_detecciones": 412 }`.

### Errores propios del backend

| Código | Cuándo |
|---|---|
| `400` | Falta el parámetro `servicio`, el servicio no existe o `file` no llegó / no se subió bien. |
| `405` | `detect` se llamó con un método distinto de `POST`. |
| `502` | El motor no respondió (error de conexión o timeout). |
| `503` | No se pudo acceder a la base de datos (o no se pudo guardar el análisis). El resultado no se devuelve. |

---

## Configuración

| Variable | Por defecto | Descripción |
|---|---|---|
| `MOTOR_URL` | `http://motor:8000` | Dirección del motor dentro de la red de Docker. Se define en `docker-compose.yml`. |
| `DB_HOST` | `db` | Servidor MySQL. |
| `DB_NAME` | `deteccion_objetos` | Base de datos. |
| `DB_USER` | `dov_app` | Usuario de la aplicación (solo `SELECT`, `INSERT`, `UPDATE`, `DELETE`). |
| `DB_PASSWORD` | — | Contraseña de `DB_USER`. Se define en `docker-compose.yml`. |

Límites de subida de PHP (`config/uploads.ini`): videos de hasta 1 GB.

Tiempos de espera (definidos en `services.php`):

- `health`: 5 segundos.
- `detect`: 60 segundos. Un frame con el modelo grande puede tardar casi un segundo en CPU; el margen cubre colas de peticiones paralelas.

---

## Probar el backend

Desde el host, con los contenedores levantados:

```bash
# Estado de backend y motor
curl "http://localhost:8080/api/services.php?servicio=health"

# Detección sobre una imagen con ajustes
curl -F "file=@foto.jpg;type=image/jpeg" -F confianza=0.6 -F clases=person \
     "http://localhost:8080/api/services.php?servicio=detect"

# Error esperado: detect sin POST
curl -i "http://localhost:8080/api/services.php?servicio=detect"
```

---

## Notas

- **Persistencia:** el video, el reporte, cada frame y sus detecciones se guardan en MySQL. Ver [`db/README.md`](../db/README.md).
- **Flujo del frontend:** `subir_video` → varios `detect` con `reporte_id` → `finalizar_reporte`.
- **Nombre de frame:** `nombre_archivo` siempre es `frame.jpg`, porque así lo envía el frontend.
- **Límites de subida de PHP:** `upload_max_filesize` y `post_max_size` tienen los valores por defecto de la imagen oficial de PHP (2 MB). Los frames JPEG enviados por el frontend son mucho más pequeños, así que no hay problema con el flujo normal.
- **Sin autenticación:** cualquiera que alcance el puerto 8080 puede usar la API. Antes de exponer el sistema fuera de una red de confianza, hay que añadir controles de acceso.
- **Respuesta siempre JSON:** todas las respuestas, también las de error, salen con `Content-Type: application/json`.
