<?php
declare(strict_types=1);

// Carga todo el código del backend. El punto de entrada (public/services.php) solo lo incluye.

require_once __DIR__ . '/config.php';

// Núcleo: respuestas, validación y conexión a la base de datos
require_once __DIR__ . '/nucleo/respuesta.php';
require_once __DIR__ . '/nucleo/validacion.php';
require_once __DIR__ . '/nucleo/basedatos.php';

// Almacenamiento de archivos en disco
require_once __DIR__ . '/almacenamiento.php';

// Repositorios: consultas SQL de cada tabla
require_once __DIR__ . '/repositorios/archivos.php';
require_once __DIR__ . '/repositorios/reportes.php';
require_once __DIR__ . '/repositorios/analisis.php';

// Servicios: un archivo por endpoint
require_once __DIR__ . '/servicios/salud.php';
require_once __DIR__ . '/servicios/videos.php';
require_once __DIR__ . '/servicios/motor.php';
require_once __DIR__ . '/servicios/reportes.php';
