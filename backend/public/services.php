<?php
// Punto de entrada único del backend: solo enruta la petición al servicio correspondiente.
// La lógica está en ../app/ (ver app/bootstrap.php).
//
// Uso: GET  /api/services.php?servicio=health
//      POST /api/services.php?servicio=subir_video        (multipart: file + ajustes)
//      POST /api/services.php?servicio=detect             (multipart: file [+ reporte_id, instante])
//      POST /api/services.php?servicio=finalizar_reporte  (form: reporte_id, resumen)
declare(strict_types=1);

require __DIR__ . '/../app/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

// servicio => [método HTTP requerido (null = cualquiera), función que atiende la petición]
$rutas = [
    'health'            => [null,   fn () => responder(200, servicioHealth())],
    'subir_video'       => ['POST', fn () => responder(200, servicioSubirVideo())],
    'detect'            => ['POST', fn () => responder(200, servicioDetect())],
    'finalizar_reporte' => ['POST', fn () => responder(200, servicioFinalizarReporte())],
    'cargar_modelo'     => ['POST', fn () => responder(200, servicioCargarModelo())],
];

$servicio = $_GET['servicio'] ?? '';

if (!isset($rutas[$servicio])) {
    responder(400, [
        'error' => 'Servicio no válido',
        'servicios' => array_keys($rutas),
    ]);
}

[$metodo, $atender] = $rutas[$servicio];
if ($metodo !== null && $_SERVER['REQUEST_METHOD'] !== $metodo) {
    responder(405, ['error' => "Use $metodo para \"$servicio\""]);
}

$atender();
