<?php
declare(strict_types=1);

/**
 * Sube un video: lo guarda en disco y registra el archivo y un reporte abierto
 * con los ajustes del análisis. Si el registro falla, el video se borra del disco.
 */
function servicioSubirVideo(): array
{
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        responder(400, ['error' => 'Falta el archivo "file"']);
    }

    $archivo = $_FILES['file'];

    // El tipo se comprueba por el contenido del archivo, no por su extensión.
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($archivo['tmp_name']);
    if (!is_string($mime) || !str_starts_with($mime, 'video/')) {
        responder(400, ['error' => 'El archivo debe ser un video']);
    }

    // Ajustes del análisis (se guardan en el reporte)
    $clases = trim((string) ($_POST['clases'] ?? ''));
    $modelo = trim((string) ($_POST['modelo'] ?? ''));
    if ($modelo !== '' && !preg_match('/^[\w.-]{1,100}$/', $modelo)) {
        responder(400, ['error' => 'Ajuste no válido: modelo']);
    }
    $ajustes = [
        'fps'        => leerNumero('fps', 0.1, 30),
        'max_frames' => (int) leerNumero('max_frames', 1, 10000),
        'confianza'  => leerNumero('confianza', 0, 1),
        'iou'        => leerNumero('iou', 0, 1),
        'tamano'     => (int) leerNumero('tamano', 32, 1920),
        'clases'     => $clases === '' ? null : mb_substr($clases, 0, 500),
        // Si no se indica, se usa el modelo por defecto del motor (yolo26x.pt)
        'modelo'     => $modelo === '' ? 'yolo26x.pt' : $modelo,
    ];

    $claveUnica = generarClaveUnica();
    $guardado = guardarVideo($archivo, $claveUnica);

    try {
        $ids = transaccion(function (PDO $pdo) use ($archivo, $claveUnica, $guardado, $mime, $ajustes) {
            $archivoId = crearArchivo($pdo, [
                'clave_unica'     => $claveUnica,
                'nombre_original' => $archivo['name'],
                'nombre_guardado' => $guardado['nombre'],
                'ruta'            => $guardado['ruta'],
                'tamano_bytes'    => (int) $archivo['size'],
                'tipo_mime'       => $mime,
            ]);

            return [
                'archivo_id' => $archivoId,
                'reporte_id' => crearReporte($pdo, $archivoId, $ajustes),
            ];
        });
    } catch (Throwable $e) {
        eliminarVideo($guardado['ruta']);
        error_log('Error de base de datos: ' . $e->getMessage());
        responder(503, ['error' => 'No se pudo registrar el video en la base de datos']);
    }

    return $ids + ['clave_unica' => $claveUnica, 'nombre' => $guardado['nombre']];
}
