-- Migración para bases de datos ya creadas con el esquema anterior.
-- Aplicar una sola vez:
--   docker exec -i dov-db mysql -uroot -p<root> deteccion_objetos < db/migrations/001_archivos_reportes.sql
-- En instalaciones nuevas no hace falta: database/init.sql ya incluye estos cambios.
USE deteccion_objetos;

CREATE TABLE IF NOT EXISTS archivos (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre_original VARCHAR(255)     NOT NULL,
    ruta            VARCHAR(500)     NOT NULL,
    tamano_bytes    BIGINT UNSIGNED  NOT NULL,
    tipo_mime       VARCHAR(100)     NOT NULL,
    creado_en       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reportes (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    archivo_id          INT UNSIGNED     NOT NULL,
    fps                 DECIMAL(4,2)     NOT NULL,
    max_frames          INT UNSIGNED     NOT NULL,
    confianza           DECIMAL(3,2)     NOT NULL,
    iou                 DECIMAL(3,2)     NOT NULL,
    tamano              SMALLINT UNSIGNED NOT NULL,
    clases              VARCHAR(500)     NULL,
    estado              ENUM('en_curso', 'completado') NOT NULL DEFAULT 'en_curso',
    frames_analizados   INT UNSIGNED     NOT NULL DEFAULT 0,
    total_detecciones   INT UNSIGNED     NOT NULL DEFAULT 0,
    resumen             JSON             NULL,
    creado_en           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizado_en       TIMESTAMP        NULL,
    CONSTRAINT fk_reportes_archivo
        FOREIGN KEY (archivo_id) REFERENCES archivos (id)
        ON DELETE CASCADE,
    INDEX idx_reportes_archivo (archivo_id)
) ENGINE=InnoDB;

ALTER TABLE imagenes
    ADD COLUMN reporte_id   INT UNSIGNED  NULL AFTER id,
    ADD COLUMN instante_seg DECIMAL(10,3) NULL AFTER nombre_archivo,
    ADD INDEX idx_imagenes_reporte (reporte_id),
    ADD CONSTRAINT fk_imagenes_reporte
        FOREIGN KEY (reporte_id) REFERENCES reportes (id)
        ON DELETE CASCADE;
