# Base de datos: MySQL 8.4
FROM mysql:8.4

# Scripts en este directorio se ejecutan solo la primera vez (volumen vacío)
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

EXPOSE 3306
