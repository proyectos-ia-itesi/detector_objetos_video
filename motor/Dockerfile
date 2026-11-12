# Motor de IA: Python + FastAPI + YOLO (Ultralytics), versión CPU
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

WORKDIR /app

# Librerías del sistema que necesita OpenCV (dependencia de ultralytics)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Dependencias primero (aprovecha la caché de Docker).
# 1) torch CPU desde el índice de PyTorch (evita descargar los paquetes CUDA, de varios GB)
# 2) el resto desde PyPI; torch ya queda satisfecho y no se reinstala
COPY requirements.txt .
RUN pip install --no-cache-dir \
        torch==2.14.1+cpu \
        torchvision==0.29.1+cpu \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Código del motor
COPY app/ ./app/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
