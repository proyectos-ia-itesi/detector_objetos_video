<?php
// Punto de entrada único del backend.
// Uso: GET /api/services.php?servicio=health
//      POST /api/services.php?servicio=detect   (campo multipart "file")
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$motorUrl = getenv('MOTOR_URL') ?: 'http://motor:8000';

/**
 * Responde en JSON y termina la ejecución.
 */
function responder(int $codigo, array $datos): never
{
    http_response_code($codigo);
    echo json_encode($datos, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Comprueba el estado del backend y del motor de IA.
 */
function servicioHealth(string $motorUrl): array
{
    $ch = curl_init($motorUrl . '/health');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $respuesta = curl_exec($ch);
    $codigoHttp = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    return [
        'backend' => 'ok',
        'motor'   => ($respuesta !== false && $codigoHttp === 200) ? 'ok' : 'no disponible',
    ];
}

/**
 * Reenvía la imagen recibida al motor de IA y devuelve sus detecciones.
 */
function servicioDetect(string $motorUrl): array
{
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        responder(400, ['error' => 'Falta el archivo "file"']);
    }

    $archivo = $_FILES['file'];

    // Ajustes de detección opcionales; solo se reenvían los campos permitidos.
    $campos = [
        'file' => new CURLFile($archivo['tmp_name'], $archivo['type'], $archivo['name']),
    ];
    foreach (['confianza', 'iou', 'tamano', 'max_det', 'clases'] as $ajuste) {
        if (isset($_POST[$ajuste])) {
            $campos[$ajuste] = (string) $_POST[$ajuste];
        }
    }

    $ch = curl_init($motorUrl . '/detect');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $campos,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
    ]);
    $respuesta = curl_exec($ch);
    $codigoHttp = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($respuesta === false) {
        responder(502, ['error' => 'El motor de IA no respondió']);
    }

    return [
        'codigo_motor' => $codigoHttp,
        'resultado'    => json_decode($respuesta, true) ?? $respuesta,
    ];
}

// Selección de la función según el parámetro GET "servicio"
$servicio = $_GET['servicio'] ?? '';

switch ($servicio) {
    case 'health':
        responder(200, servicioHealth($motorUrl));

    case 'detect':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            responder(405, ['error' => 'Use POST para "detect"']);
        }
        responder(200, servicioDetect($motorUrl));

    default:
        responder(400, ['error' => 'Servicio no válido', 'servicios' => ['health', 'detect']]);
}
