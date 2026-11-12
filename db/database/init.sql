-- Script de creación de la base de datos del detector de objetos en video
CREATE DATABASE IF NOT EXISTS deteccion_objetos
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE deteccion_objetos;

-- Imágenes enviadas al motor de IA
CREATE TABLE IF NOT EXISTS imagenes (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre_archivo  VARCHAR(255)     NOT NULL,
    tamano_bytes    INT UNSIGNED     NOT NULL,
    creado_en       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
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
