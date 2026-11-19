<?php
declare(strict_types=1);

// Configuración del backend. Los valores variables vienen de variables de entorno (ver docker-compose.yml).

/** Dirección del motor de IA dentro de la red de Docker. */
function urlMotor(): string
{
    return getenv('MOTOR_URL') ?: 'http://motor:8000';
}

/**
 * Carpeta donde se guardan los videos subidos.
 * Está fuera de DocumentRoot (/var/www/html): no es accesible por HTTP.
 */
const DIRECTORIO_VIDEOS = '/var/www/uploads';

/**
 * Carpeta donde se guardan los reportes (JSON) de cada análisis. También fuera de la web.
 */
const DIRECTORIO_REPORTES = '/var/www/reports';
