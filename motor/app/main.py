"""Motor de IA: API de detección de objetos.

Por ahora el modelo es un marcador de posición. Cuando tengas el modelo
(por ejemplo YOLO), cárgalo en `cargar_modelo()` desde MODEL_PATH.
"""
import os

from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="Motor de detección de objetos")

MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/modelo.pt")
modelo = None


def cargar_modelo():
    """Carga el modelo de IA. Sustituir por la carga real cuando exista el archivo."""
    global modelo
    if os.path.exists(MODEL_PATH):
        # Ejemplo con ultralytics (agregar al requirements.txt si se usa):
        # from ultralytics import YOLO
        # modelo = YOLO(MODEL_PATH)
        modelo = "cargado"  # marcador de posición
    return modelo


@app.on_event("startup")
def al_iniciar():
    cargar_modelo()


@app.get("/health")
def health():
    return {
        "estado": "ok",
        "modelo_cargado": modelo is not None,
    }


@app.post("/detect")
async def detectar(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")

    contenido = await file.read()

    # Aquí va la inferencia real con el modelo.
    return {
        "archivo": file.filename,
        "tamano_bytes": len(contenido),
        "detecciones": [],
    }
