# Motor de IA (`motor/`)

Servicio que recibe imágenes y devuelve los objetos detectados en ellas. Usa **YOLO26x** de Ultralytics, ejecutado en CPU con PyTorch y expuesto con FastAPI.

Es el único servicio que hace inferencia; el backend le reenvía cada frame y los ajustes de detección.

---

## Cómo está armado

| Archivo | Qué contiene |
|---|---|
| `Dockerfile` | Imagen `python:3.12-slim`. Instala primero PyTorch CPU desde el índice oficial de PyTorch (evita bajar los paquetes CUDA de varios GB) y después `requirements.txt`. Incluye un `HEALTHCHECK`. |
| `requirements.txt` | `fastapi`, `uvicorn`, `python-multipart`, `torch`, `torchvision` y `ultralytics`, todas con versión fijada. |
| `app/main.py` | La API: carga del modelo en el arranque y los endpoints `/health` y `/detect`. |
| `models/` | Volumen montado en `/app/models`. Ahí van los pesos propios (`modelo.pt`) y la caché de los preentrenados. Está en `.gitignore`. |

### Decisiones de diseño

- **Carga única del modelo.** Se carga en el *lifespan* de FastAPI, una vez al arrancar, y se reutiliza en todas las peticiones.
- **Arranque tolerante a fallos.** Si el modelo no se puede cargar, el servicio sigue arriba: `/health` reporta `modelo_cargado: false` y `/detect` responde `503`.
- **Inferencia fuera del hilo principal.** `/detect` es una función síncrona; FastAPI la ejecuta en un hilo, así la inferencia no bloquea el servidor.
- **Entrada validada.** Se exige `Content-Type` de imagen, se limita el tamaño (`MAX_BYTES`), se comprueba que la imagen se pueda decodificar y que `tamano` sea múltiplo de 32.
- **Salida estable.** Las cajas se devuelven como enteros en píxeles de la imagen original y la confianza con 4 decimales.
- **Descarga de pesos en el volumen.** Ultralytics descarga los preentrenados en el directorio actual; el motor cambia temporalmente a `models/` para que queden en el volumen y no se descarguen en cada arranque.

---

## Selección del modelo

El motor elige el modelo en este orden:

1. **Pesos propios:** si existe `MODEL_PATH` (por defecto `motor/models/modelo.pt`), se usa ese archivo. Sirve para modelos entrenados con tus propias clases.
2. **Preentrenado:** si no existe, se usa `MODEL_NAME` (por defecto `yolo26x.pt`, entrenado con las 80 clases de COCO). Se descarga una vez y en los siguientes arranques no hace falta internet.

### Modelo actual

**`yolo26x.pt`** es la variante más grande de YOLO26, la familia más reciente disponible en la versión de Ultralytics que usa el proyecto (`ultralytics==8.4.211`). Es la de mayor precisión de las preentrenadas en COCO, a costa de ser la más lenta.

Medición de referencia en CPU (imagen de prueba de 810×1080 px, `tamano=640`): unos **0.84 s por frame** tras la primera petición. Con el máximo de 2400 frames y 4 peticiones en paralelo, un análisis completo puede tardar bastante; si es un problema, usa un modelo más pequeño.

### Modelos disponibles

| Modelo | Tamaño aprox. | Velocidad en CPU | Precisión | Uso recomendado |
|---|---|---|---|---|
| `yolo26n.pt` | pequeño | muy rápida | baja | pruebas, máquinas modestas |
| `yolo26s.pt` | pequeño | rápida | media | equilibrio |
| `yolo26m.pt` | medio | media | alta | equilibrio con más precisión |
| `yolo26l.pt` | grande | lenta | muy alta | si hay GPU |
| **`yolo26x.pt`** (actual) | muy grande | la más lenta | la más alta | máxima precisión |
| `yolo11n` … `yolo11x` | según tamaño | según tamaño | similar a YOLO26 del mismo tamaño | alternativa |
| `yolov8n` … `yolov8x` | según tamaño | según tamaño | menor | compatibilidad |

Todos reconocen las mismas 80 clases de COCO.

### Cambiar de modelo

Edita `MODEL_NAME` en `docker-compose.yml` y reinicia solo el motor (no hace falta reconstruir la imagen):

```bash
docker compose up -d motor
curl http://127.0.0.1:8000/health   # debe mostrar el nuevo "modelo"
```

### Usar pesos propios

Copia el archivo a `motor/models/modelo.pt` y reinicia el motor. Como `MODEL_PATH` tiene prioridad, se usará ese archivo aunque `MODEL_NAME` siga con el valor anterior.

---

## Variables de entorno

Se definen en `motor.environment` de `docker-compose.yml`.

| Variable | Por defecto | Descripción |
|---|---|---|
| `MODEL_PATH` | `/app/models/modelo.pt` | Pesos propios. Si existe, tienen prioridad sobre `MODEL_NAME`. |
| `MODEL_NAME` | `yolo26x.pt` | Modelo preentrenado de Ultralytics a usar como alternativa. |
| `CONF_MINIMA` | `0.25` | Confianza mínima por defecto si la petición no envía `confianza`. |
| `IMGSZ` | `640` | Tamaño de entrada por defecto si la petición no envía `tamano`. |
| `MAX_BYTES` | `10485760` (10 MB) | Tamaño máximo de una imagen aceptada. |
| `YOLO_CONFIG_DIR` | `/tmp/Ultralytics` | Configuración interna de Ultralytics (definida en el Dockerfile). |

---

## Endpoints

### `GET /health`

```json
{ "estado": "ok", "modelo_cargado": true, "modelo": "yolo26x.pt" }
```

### `POST /detect`

Multipart con el campo `file` (imagen) y, opcionalmente, los ajustes:

| Campo | Por defecto | Rango / formato | Efecto |
|---|---|---|---|
| `confianza` | `CONF_MINIMA` (0.25) | 0 a 1 | Confianza mínima de cada detección. Más alto = menos falsos positivos, pero puede perder objetos. |
| `iou` | 0.7 | 0 a 1 | Umbral de solapamiento para eliminar cajas duplicadas (NMS). Más alto = permite cajas más encimadas. |
| `tamano` | `IMGSZ` (640) | múltiplo de 32, hasta 1920 | Resolución con la que la red analiza la imagen. Más alto = mejor con objetos pequeños, pero más lento. |
| `max_det` | 300 | 1 a 1000 | Máximo de detecciones por imagen. |
| `clases` | vacío (todas) | nombres COCO separados por coma, p. ej. `person,car` | Solo devuelve esas clases. |

```bash
curl -F "file=@foto.jpg;type=image/jpeg" -F confianza=0.6 -F clases=person,car http://127.0.0.1:8000/detect
```

Respuesta:

```json
{
  "archivo": "foto.jpg",
  "ancho": 810,
  "alto": 1080,
  "tamano_bytes": 137419,
  "detecciones": [
    { "clase": "bus", "confianza": 0.9327, "x1": 22, "y1": 231, "x2": 805, "y2": 756 },
    { "clase": "person", "confianza": 0.9407, "x1": 48, "y1": 398, "x2": 245, "y2": 902 }
  ]
}
```

Códigos de respuesta:

| Código | Motivo |
|---|---|
| `200` | Detección correcta (la lista puede estar vacía). |
| `400` | El archivo no es una imagen, no se puede decodificar, `tamano` no es múltiplo de 32 o alguna clase no existe en el modelo. |
| `413` | La imagen supera `MAX_BYTES`. |
| `422` | Un ajuste está fuera de rango (por ejemplo, `confianza` mayor que 1). |
| `503` | El modelo no se pudo cargar al arrancar. |

---

## Trabajar con el motor sin Docker

```bash
cd motor
python -m venv .venv && source .venv/bin/activate
pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
MODEL_PATH=./models/modelo.pt uvicorn app.main:app --reload --port 8000
```

Si `MODEL_PATH` no existe, el motor descarga `MODEL_NAME` en `./models/`.

---

## Solución de problemas

- **El motor tarda en arrancar o queda `unhealthy`:** la primera vez instala dependencias y descarga el modelo. Revisa `docker compose logs motor`.
- **`modelo_cargado: false` en `/health`:** no se pudo descargar el modelo (sin internet). Copia los pesos manualmente a `motor/models/modelo.pt`.
- **`Motor: no disponible` desde el backend:** verifica que `dov-motor` esté `healthy`.
- **Análisis muy lento:** usa un modelo más pequeño (`yolo26m.pt` o `yolo26s.pt`) o baja el tamaño de análisis.
- **`libGL.so.1` al importar OpenCV fuera de Docker:** instala `libgl1` en tu sistema. El Dockerfile ya lo incluye.
