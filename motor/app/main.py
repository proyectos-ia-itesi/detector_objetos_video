"""Motor de IA: API de detección de objetos con YOLO (Ultralytics).

Endpoints:
    GET  /health   estado del servicio, modelo en memoria y modelos disponibles
    POST /detect   recibe una imagen (campo multipart "file") y devuelve
                   las detecciones: clase, confianza y caja delimitadora.
                   Campo opcional "modelo" para elegir el modelo del análisis.

Modelos: se cargan bajo demanda y solo uno permanece en memoria a la vez
(el último usado), para no multiplicar el consumo de RAM.

Configuración por variables de entorno (ver README.md, sección del motor):
    MODEL_PATH     pesos propios (por defecto /app/models/modelo.pt). Si existe,
                   es el modelo por defecto y puede elegirse como "modelo.pt"
    MODEL_NAME     modelo preentrenado por defecto si MODEL_PATH no existe
                   (por defecto yolo26x.pt; se descarga una vez en MODELS_DIR)
    CONF_MINIMA    confianza mínima de las detecciones (por defecto 0.25)
    IMGSZ          tamaño de entrada de la red (por defecto 640)
    MAX_BYTES      tamaño máximo de la imagen en bytes (por defecto 10 MB)
"""
import io
import logging
import os
import threading
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

# Modelos que puede elegir el usuario: nombre que se envía -> origen para Ultralytics.
MODELOS_PREENTRENADOS = ["yolo26x.pt", "yolo26m.pt", "yolo26n.pt"]
ORIGENES = {nombre: nombre for nombre in MODELOS_PREENTRENADOS}
if os.path.exists(MODEL_PATH):
    ORIGENES[os.path.basename(MODEL_PATH)] = MODEL_PATH
    MODELO_POR_DEFECTO = os.path.basename(MODEL_PATH)
else:
    ORIGENES.setdefault(MODEL_NAME, MODEL_NAME)
    MODELO_POR_DEFECTO = MODEL_NAME

_modelos: dict[str, YOLO] = {}      # nombre -> modelo cargado (como máximo uno)
_bloqueo = threading.Lock()         # evita cargas simultáneas al cambiar de modelo


def _cargar(origen: str) -> YOLO:
    """Carga un modelo. Ultralytics descarga los preentrenados en el directorio actual,
    así que se cambia temporalmente a MODELS_DIR para que queden en el volumen."""
    anterior = os.getcwd()
    try:
        os.makedirs(MODELS_DIR, exist_ok=True)
        os.chdir(MODELS_DIR)
        return YOLO(origen)
    finally:
        os.chdir(anterior)


def obtener_modelo(nombre: str) -> YOLO:
    """Devuelve el modelo pedido. Si no está en memoria, libera el actual y lo carga.
    Lanza KeyError si el nombre no es válido y OSError/RuntimeError si no se puede cargar."""
    with _bloqueo:
        if nombre in _modelos:
            return _modelos[nombre]
        origen = ORIGENES[nombre]  # KeyError si el nombre no está permitido
        logger.info("Cargando modelo %s", origen)
        _modelos.clear()
        _modelos[nombre] = _cargar(origen)
        return _modelos[nombre]


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    # El modelo por defecto se carga al arrancar para que la primera petición sea rápida.
    try:
        obtener_modelo(MODELO_POR_DEFECTO)
    except Exception:
        logger.exception("No se pudo cargar el modelo %s", MODELO_POR_DEFECTO)
    yield


app = FastAPI(title="Motor de detección de objetos", lifespan=ciclo_de_vida)


@app.get("/health")
def health():
    return {
        "estado": "ok",
        "modelo_cargado": bool(_modelos),
        "modelo": next(iter(_modelos), None),
        "modelo_por_defecto": MODELO_POR_DEFECTO,
        "modelos_disponibles": list(ORIGENES),
    }


@app.post("/modelo")
def montar_modelo(modelo: str = Form(...)):
    """Carga un modelo en memoria sin analizar nada, para que el análisis no espere la carga."""
    if modelo not in ORIGENES:
        raise HTTPException(
            status_code=400,
            detail=f"Modelo no válido. Opciones: {', '.join(ORIGENES)}",
        )
    try:
        obtener_modelo(modelo)
    except Exception:
        logger.exception("No se pudo montar el modelo %s", modelo)
        raise HTTPException(status_code=503, detail="No se pudo montar el modelo")
    return {"modelo": modelo, "listo": True}


def ids_de_clases(texto: str, modelo: YOLO) -> list[int] | None:
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
    modelo: str = Form(""),
):
    """Detecta objetos en una imagen.

    Ajustes opcionales (campos del formulario):
        confianza  confianza mínima de cada detección (0 a 1)
        iou        umbral de solapamiento para eliminar cajas duplicadas (0 a 1)
        tamano     tamaño de entrada de la red (múltiplo de 32)
        max_det    máximo de detecciones por imagen
        clases     nombres separados por coma (p. ej. "person,car"); vacío = todas
        modelo     nombre del modelo (p. ej. "yolo26n.pt"); vacío = el por defecto
    """
    # Función síncrona: FastAPI la ejecuta en un hilo, así la inferencia
    # no bloquea el servidor.
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")

    nombre_modelo = modelo or MODELO_POR_DEFECTO
    if nombre_modelo not in ORIGENES:
        raise HTTPException(
            status_code=400,
            detail=f"Modelo no válido. Opciones: {', '.join(ORIGENES)}",
        )

    if tamano % 32 != 0:
        raise HTTPException(status_code=400, detail="El tamaño debe ser múltiplo de 32")

    contenido = file.file.read(MAX_BYTES + 1)
    if len(contenido) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="La imagen supera el tamaño máximo")

    try:
        imagen = Image.open(io.BytesIO(contenido)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="No se pudo leer la imagen")

    try:
        red = obtener_modelo(nombre_modelo)
    except Exception:
        logger.exception("No se pudo cargar el modelo %s", nombre_modelo)
        raise HTTPException(status_code=503, detail="El modelo no está cargado")

    resultados = red.predict(
        imagen,
        imgsz=tamano,
        conf=confianza,
        iou=iou,
        max_det=max_det,
        classes=ids_de_clases(clases, red),
        verbose=False,
    )

    detecciones = []
    for resultado in resultados:
        nombres = resultado.names
        cajas = resultado.boxes.xyxy.tolist()
        confianzas = resultado.boxes.conf.tolist()
        clases_detectadas = resultado.boxes.cls.tolist()
        for (x1, y1, x2, y2), confianza_caja, clase in zip(cajas, confianzas, clases_detectadas):
            detecciones.append({
                "clase": nombres[int(clase)],
                "confianza": round(confianza_caja, 4),
                "x1": int(x1),
                "y1": int(y1),
                "x2": int(x2),
                "y2": int(y2),
            })

    return {
        "archivo": file.filename,
        "modelo": nombre_modelo,
        "ancho": imagen.width,
        "alto": imagen.height,
        "tamano_bytes": len(contenido),
        "detecciones": detecciones,
    }
