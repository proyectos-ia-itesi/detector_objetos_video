<?php
declare(strict_types=1);

/**
 * Envía una petición POST al motor de IA. Devuelve [código HTTP, cuerpo decodificado].
 * Si el motor no responde, responde 502.
 */
function reenviarAlMotor(string $ruta, array $campos, int $timeout): array
{
    $ch = curl_init(urlMotor() . $ruta);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $campos,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
    ]);
    $respuesta = curl_exec($ch);
    $codigoHttp = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($respuesta === false) {
        responder(502, ['error' => 'El motor de IA no respondió']);
    }

    return [$codigoHttp, json_decode($respuesta, true) ?? $respuesta];
}

/**
 * Monta un modelo en el motor antes de analizar, para que el análisis no espere la carga.
 * La primera vez puede tardar, porque el motor descarga el modelo si no lo tiene.
 */
function servicioCargarModelo(): array
{
    $modelo = trim((string) ($_POST['modelo'] ?? ''));
    if (!preg_match('/^[\w.-]{1,100}$/', $modelo)) {
        responder(400, ['error' => 'Falta el campo "modelo" válido']);
    }

    [$codigoHttp, $resultado] = reenviarAlMotor('/modelo', ['modelo' => $modelo], 180);

    return ['codigo_motor' => $codigoHttp, 'resultado' => $resultado];
}

/**
 * Reenvía un frame al motor, guarda el resultado y devuelve sus detecciones.
 * Si llega reporte_id, el frame queda ligado a ese reporte con su instante de video.
 */
function servicioDetect(): array
{
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        responder(400, ['error' => 'Falta el archivo "file"']);
    }

    $archivo = $_FILES['file'];

    $reporteId = null;
    $instante = null;
    if (isset($_POST['reporte_id'])) {
        $reporteId = (int) $_POST['reporte_id'];
        $instante = leerNumero('instante', 0, 1e7);
        conBaseDatos(fn () => comprobarReporteEnCurso(conectarBaseDatos(), $reporteId));
    }

    // Solo se reenvían los ajustes permitidos; el resto de campos se ignora.
    $campos = [
        'file' => new CURLFile($archivo['tmp_name'], $archivo['type'], $archivo['name']),
    ];
    foreach (['confianza', 'iou', 'tamano', 'max_det', 'clases', 'modelo'] as $ajuste) {
        if (isset($_POST[$ajuste])) {
            $campos[$ajuste] = (string) $_POST[$ajuste];
        }
    }

    [$codigoHttp, $resultado] = reenviarAlMotor('/detect', $campos, 60);

    // Solo se guardan los análisis correctos. Si la base de datos falla, se avisa
    // con error en lugar de perder el resultado en silencio.
    $imagenId = null;
    if ($codigoHttp === 200 && is_array($resultado)) {
        $imagenId = conBaseDatos(fn () => transaccion(fn (PDO $pdo) => guardarAnalisis(
            $pdo,
            $archivo['name'],
            (int) $archivo['size'],
            $resultado['detecciones'] ?? [],
            $reporteId,
            $instante
        )));
    }

    return [
        'codigo_motor' => $codigoHttp,
        'imagen_id'    => $imagenId,
        'resultado'    => $resultado,
    ];
}
