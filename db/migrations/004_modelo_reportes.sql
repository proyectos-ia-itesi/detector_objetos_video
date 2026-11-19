-- Migración: modelo de IA usado en cada reporte.
-- Requiere 003_ruta_reportes.sql. Aplicar una sola vez:
--   docker exec -i dov-db mysql -uroot -p<root> deteccion_objetos < db/migrations/004_modelo_reportes.sql
-- En instalaciones nuevas no hace falta: database/init.sql ya incluye este cambio.
USE deteccion_objetos;

ALTER TABLE reportes
    ADD COLUMN modelo VARCHAR(100) NOT NULL DEFAULT 'yolo26x.pt' AFTER clases;
