"""Motor de IA: API de detección de objetos con YOLO (Ultralytics).

Endpoints:
    GET  /health   estado del servicio y del modelo
    POST /detect   recibe una imagen (campo multipart "file") y devuelve
                   las detecciones: clase, confianza y caja delimitadora.

Configuración por variables de entorno (ver README.md, sección del motor):
    MODEL_PATH     ruta a los pesos propios (por defecto /app/models/modelo.pt)
    MODEL_NAME     modelo preentrenado a usar si MODEL_PATH no existe
                   (por defecto yolo26x.pt; se descarga una vez en MODELS_DIR)
    CONF_MINIMA    confianza mínima de las detecciones (por defecto 0.25)
    IMGSZ          tamaño de entrada de la red (por defecto 640)
    MAX_BYTES      tamaño máximo de la imagen en bytes (por defecto 10 MB)
"""
import io
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

logger = logging.getLogger("motor")

MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/modelo.pt")
MODEL_NAME = os.getenv("MODEL_NAME", "yolo26x.pt")
MODELS_DIR = os.path.dirname(MODEL_PATH) or "."
CONF_MINIMA = float(os.getenv("CONF_MINIMA", "0.25"))
IMGSZ = int(os.getenv("IMGSZ", "640"))
MAX_BYTES = int(os.getenv("MAX_BYTES", str(10 * 1024 * 1024)))

modelo: YOLO | None = None
modelo_origen: str | None = None  # ruta o nombre del modelo cargado


def cargar_modelo() -> YOLO | None:
    """Carga el modelo YOLO una sola vez al arrancar.

    Prioridad: MODEL_PATH (pesos propios) -> MODEL_NAME (preentrenado).
    Si no se puede cargar, el servicio arranca igualmente y /detect
    responde 503; así /health sigue informando el problema.
    """
    global modelo, modelo_origen

    if os.path.exists(MODEL_PATH):
        origen = MODEL_PATH
    else:
        logger.warning("No existe %s; se usa el modelo preentrenado %s",
                       MODEL_PATH, MODEL_NAME)
        origen = MODEL_NAME

    # Ultralytics descarga los pesos preentrenados en el directorio actual.
    # Cambiamos temporalmente a MODELS_DIR para que queden en el volumen.
    anterior = os.getcwd()
    try:
        os.makedirs(MODELS_DIR, exist_ok=True)
        os.chdir(MODELS_DIR)
        modelo = YOLO(origen)
        modelo_origen = origen
        logger.info("Modelo cargado: %s", origen)
    except Exception:
        logger.exception("No se pudo cargar el modelo %s", origen)
        modelo = None
        modelo_origen = None
    finally:
        os.chdir(anterior)

    return modelo


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    cargar_modelo()
    yield


app = FastAPI(title="Motor de detección de objetos", lifespan=ciclo_de_vida)


@app.get("/health")
def health():
    return {
        "estado": "ok",
        "modelo_cargado": modelo is not None,
        "modelo": modelo_origen,
    }


def ids_de_clases(texto: str) -> list[int] | None:
    """Convierte 'person,car' en los índices de clase del modelo.

    Cadena vacía = todas las clases (devuelve None).
    """
    nombres = [n.strip().lower() for n in texto.split(",") if n.strip()]
    if not nombres:
        return None

    por_nombre = {nombre.lower(): idx for idx, nombre in modelo.names.items()}
    desconocidas = [n for n in nombres if n not in por_nombre]
    if desconocidas:
        raise HTTPException(
            status_code=400,
            detail=f"Clases no reconocidas por el modelo: {', '.join(desconocidas)}",
        )
    return [por_nombre[n] for n in nombres]


@app.post("/detect")
def detectar(
    file: UploadFile = File(...),
    confianza: float = Form(CONF_MINIMA, ge=0.0, le=1.0),
    iou: float = Form(0.7, ge=0.0, le=1.0),
    tamano: int = Form(IMGSZ, ge=32, le=1920),
    max_det: int = Form(300, ge=1, le=1000),
    clases: str = Form(""),
):
    """Detecta objetos en una imagen.

    Ajustes opcionales (campos del formulario):
        confianza  confianza mínima de cada detección (0 a 1)
        iou        umbral de solapamiento para eliminar cajas duplicadas (0 a 1)
        tamano     tamaño de entrada de la red (múltiplo de 32)
        max_det    máximo de detecciones por imagen
        clases     nombres separados por coma (p. ej. "person,car"); vacío = todas
    """
    # Función síncrona: FastAPI la ejecuta en un hilo, así la inferencia
    # no bloquea el servidor.
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")

    if modelo is None:
        raise HTTPException(status_code=503, detail="El modelo no está cargado")

    if tamano % 32 != 0:
        raise HTTPException(status_code=400, detail="El tamaño debe ser múltiplo de 32")

    contenido = file.file.read(MAX_BYTES + 1)
    if len(contenido) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="La imagen supera el tamaño máximo")

    try:
        imagen = Image.open(io.BytesIO(contenido)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="No se pudo leer la imagen")

    resultados = modelo.predict(
        imagen,
        imgsz=tamano,
        conf=confianza,
        iou=iou,
        max_det=max_det,
        classes=ids_de_clases(clases),
        verbose=False,
    )

    detecciones = []
    for resultado in resultados:
        nombres = resultado.names
        cajas = resultado.boxes.xyxy.tolist()
        confianzas = resultado.boxes.conf.tolist()
        clases = resultado.boxes.cls.tolist()
        for (x1, y1, x2, y2), confianza, clase in zip(cajas, confianzas, clases):
            detecciones.append({
                "clase": nombres[int(clase)],
                "confianza": round(confianza, 4),
                "x1": int(x1),
                "y1": int(y1),
                "x2": int(x2),
                "y2": int(y2),
            })

    return {
        "archivo": file.filename,
        "ancho": imagen.width,
        "alto": imagen.height,
        "tamano_bytes": len(contenido),
        "detecciones": detecciones,
    }
