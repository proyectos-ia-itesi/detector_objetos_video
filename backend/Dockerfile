# Backend: PHP 8.3 + Apache
FROM php:8.3-apache

# Extensión PDO de MySQL para guardar los análisis en la base de datos
RUN docker-php-ext-install pdo_mysql

# Usuario de Apache con el mismo UID que el usuario del host (1000), para que los archivos
# escritos en backend/videos y backend/reports sean editables desde el host.
RUN usermod -u 1000 www-data && groupmod -g 1000 www-data

# Límites de subida de videos
COPY config/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

# Código del backend. Solo public/ es accesible por HTTP (DocumentRoot);
# app/ queda fuera, en /var/www/app, y no se puede descargar.
COPY app/ /var/www/app/
COPY public/ /var/www/html/

# Carpetas de videos y reportes (fuera de la web). Se montan desde backend/videos y backend/reports.
RUN mkdir -p /var/www/uploads /var/www/reports \
    && chown -R www-data:www-data /var/www/html /var/www/uploads /var/www/reports

EXPOSE 80
