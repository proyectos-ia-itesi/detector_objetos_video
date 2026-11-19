-- Migración: ruta del archivo JSON de cada reporte.
-- Requiere 002_clave_unica_archivos.sql. Aplicar una sola vez:
--   docker exec -i dov-db mysql -uroot -p<root> deteccion_objetos < db/migrations/003_ruta_reportes.sql
-- En instalaciones nuevas no hace falta: database/init.sql ya incluye este cambio.
USE deteccion_objetos;

ALTER TABLE reportes
    ADD COLUMN ruta_archivo VARCHAR(500) NULL AFTER resumen;
