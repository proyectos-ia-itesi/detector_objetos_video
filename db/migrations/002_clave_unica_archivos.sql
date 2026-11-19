-- Migración: clave única y nombre guardado para los videos.
-- Requiere 001_archivos_reportes.sql. Aplicar una sola vez:
--   docker exec -i dov-db mysql -uroot -p<root> deteccion_objetos < db/migrations/002_clave_unica_archivos.sql
-- En instalaciones nuevas no hace falta: database/init.sql ya incluye estos cambios.
USE deteccion_objetos;

-- 1) Columnas nuevas, primero admitiendo NULL para poder rellenar las filas existentes
ALTER TABLE archivos
    ADD COLUMN clave_unica     CHAR(36)     NULL AFTER id,
    ADD COLUMN nombre_guardado VARCHAR(255) NULL AFTER nombre_original;

-- 2) Filas existentes: se les asigna una clave y el nombre original como nombre guardado
UPDATE archivos
SET clave_unica = UUID(),
    nombre_guardado = nombre_original
WHERE clave_unica IS NULL;

-- 3) Obligatorias y únicas
ALTER TABLE archivos
    MODIFY clave_unica     CHAR(36)     NOT NULL,
    MODIFY nombre_guardado VARCHAR(255) NOT NULL,
    ADD UNIQUE KEY uq_archivos_clave (clave_unica);
