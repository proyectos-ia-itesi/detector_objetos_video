# Frontend: Apache (httpd) sirviendo HTML/JS estáticos
FROM httpd:2.4-alpine

# Configuración de Apache (incluye proxy /api/ -> backend)
COPY httpd.conf /usr/local/apache2/conf/httpd.conf

# Archivos de la web
COPY public/ /usr/local/apache2/htdocs/

EXPOSE 80
