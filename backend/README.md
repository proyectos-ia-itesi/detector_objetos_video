# Backend (`backend/`)

API de entrada del sistema. Es un único script PHP (`src/services.php`) que el frontend llama a través de `/api/`. Su función es validar la petición, reenviarla al motor de IA y devolver la respuesta envuelta en JSON. No hace inferencia ni guarda datos.

---

## Estructura

| Archivo | Qué contiene |
|---|---|
| `Dockerfile` | Imagen `php:8.3-apache`. Copia `src/` a `/var/www/html/` y ajusta permisos para Apache. |
| `src/services.php` | Punto de entrada único. Selecciona la función según el parámetro `servicio`. |

---

## Endpoints

Todos se llaman a través del frontend como `/api/services.php?servicio=…`.

### `GET ?servicio=health`

Comprueba el backend y el motor.

```json
{ "backend": "ok", "motor": "ok" }
```

`motor` vale `"no disponible"` si el motor no responde o no devuelve `200` en `/health` dentro de 5 segundos.

### `POST ?servicio=detect`

Reenvía una imagen al motor para detectar objetos.

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

`resultado` es exactamente la respuesta del motor. Si el motor rechaza la petición, `codigo_motor` tiene el código del motor (por ejemplo `400` o `422`) y `resultado` trae el campo `detail` con el motivo.

### Errores propios del backend

| Código | Cuándo |
|---|---|
| `400` | Falta el parámetro `servicio`, el servicio no existe o `file` no llegó / no se subió bien. |
| `405` | `detect` se llamó con un método distinto de `POST`. |
| `502` | El motor no respondió (error de conexión o timeout). |

---

## Configuración

| Variable | Por defecto | Descripción |
|---|---|---|
| `MOTOR_URL` | `http://motor:8000` | Dirección del motor dentro de la red de Docker. Se define en `docker-compose.yml`. |

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

- **Sin base de datos:** el backend todavía no escribe en MySQL. Ver [`db/README.md`](../db/README.md).
- **Límites de subida de PHP:** `upload_max_filesize` y `post_max_size` tienen los valores por defecto de la imagen oficial de PHP (2 MB). Los frames JPEG enviados por el frontend son mucho más pequeños, así que no hay problema con el flujo normal.
- **Sin autenticación:** cualquiera que alcance el puerto 8080 puede usar la API. Antes de exponer el sistema fuera de una red de confianza, hay que añadir controles de acceso.
- **Respuesta siempre JSON:** todas las respuestas, también las de error, salen con `Content-Type: application/json`.
