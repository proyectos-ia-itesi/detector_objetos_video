# Backend: PHP 8.3 + Apache
FROM php:8.3-apache

# Código de la API
COPY src/ /var/www/html/

# Permisos de lectura para Apache
RUN chown -R www-data:www-data /var/www/html

EXPOSE 80
