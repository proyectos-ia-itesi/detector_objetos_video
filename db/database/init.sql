-- Script de creación de la base de datos del detector de objetos en video
CREATE DATABASE IF NOT EXISTS deteccion_objetos
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE deteccion_objetos;

-- Videos subidos para analizar (el archivo está en el volumen del backend)
CREATE TABLE IF NOT EXISTS archivos (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    clave_unica     CHAR(36)         NOT NULL,
    nombre_original VARCHAR(255)     NOT NULL,
    nombre_guardado VARCHAR(255)     NOT NULL,
    ruta            VARCHAR(500)     NOT NULL,
    tamano_bytes    BIGINT UNSIGNED  NOT NULL,
    tipo_mime       VARCHAR(100)     NOT NULL,
    creado_en       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_archivos_clave (clave_unica)
) ENGINE=InnoDB;

-- Un reporte por cada análisis de un video, con los ajustes usados y su resumen
CREATE TABLE IF NOT EXISTS reportes (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    archivo_id          INT UNSIGNED     NOT NULL,
    fps                 DECIMAL(4,2)     NOT NULL,
    max_frames          INT UNSIGNED     NOT NULL,
    confianza           DECIMAL(3,2)     NOT NULL,
    iou                 DECIMAL(3,2)     NOT NULL,
    tamano              SMALLINT UNSIGNED NOT NULL,
    clases              VARCHAR(500)     NULL,
    modelo              VARCHAR(100)     NOT NULL DEFAULT 'yolo26x.pt',
    estado              ENUM('en_curso', 'completado') NOT NULL DEFAULT 'en_curso',
    frames_analizados   INT UNSIGNED     NOT NULL DEFAULT 0,
    total_detecciones   INT UNSIGNED     NOT NULL DEFAULT 0,
    resumen             JSON             NULL,
    ruta_archivo        VARCHAR(500)     NULL,
    creado_en           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizado_en       TIMESTAMP        NULL,
    CONSTRAINT fk_reportes_archivo
        FOREIGN KEY (archivo_id) REFERENCES archivos (id)
        ON DELETE CASCADE,
    INDEX idx_reportes_archivo (archivo_id)
) ENGINE=InnoDB;

-- Frames enviados al motor de IA
CREATE TABLE IF NOT EXISTS imagenes (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reporte_id      INT UNSIGNED     NULL,
    nombre_archivo  VARCHAR(255)     NOT NULL,
    instante_seg    DECIMAL(10,3)    NULL,
    tamano_bytes    INT UNSIGNED     NOT NULL,
    creado_en       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_imagenes_reporte
        FOREIGN KEY (reporte_id) REFERENCES reportes (id)
        ON DELETE CASCADE,
    INDEX idx_imagenes_reporte (reporte_id)
) ENGINE=InnoDB;

-- Objetos detectados en cada imagen
CREATE TABLE IF NOT EXISTS detecciones (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    imagen_id       INT UNSIGNED     NOT NULL,
    clase           VARCHAR(100)     NOT NULL,
    confianza       DECIMAL(5,4)     NOT NULL,
    x1              INT              NOT NULL,
    y1              INT              NOT NULL,
    x2              INT              NOT NULL,
    y2              INT              NOT NULL,
    creado_en       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_detecciones_imagen
        FOREIGN KEY (imagen_id) REFERENCES imagenes (id)
        ON DELETE CASCADE,
    INDEX idx_detecciones_imagen (imagen_id),
    INDEX idx_detecciones_clase (clase)
) ENGINE=InnoDB;

-- Usuario de la aplicación (solo acceso a esta base de datos)
CREATE USER IF NOT EXISTS 'dov_app'@'%' IDENTIFIED BY 'dov_app_pass';
GRANT SELECT, INSERT, UPDATE, DELETE ON deteccion_objetos.* TO 'dov_app'@'%';
FLUSH PRIVILEGES;
