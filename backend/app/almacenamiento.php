<?php
declare(strict_types=1);

/**
 * Clave única (UUID v4) que identifica cada video guardado.
 */
function generarClaveUnica(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/**
 * Guarda el video subido en DIRECTORIO_VIDEOS/<clave_unica>/<nombre_seguro>.
 * Devuelve la ruta completa y el nombre con el que quedó guardado.
 */
function guardarVideo(array $archivo, string $claveUnica): array
{
    $nombre = nombreSeguro($archivo['name']);
    $carpeta = DIRECTORIO_VIDEOS . '/' . $claveUnica;

    if (!mkdir($carpeta, 0755, true)) {
        error_log('No se pudo crear la carpeta ' . $carpeta);
        responder(500, ['error' => 'No se pudo guardar el video']);
    }

    $ruta = $carpeta . '/' . $nombre;
    if (!move_uploaded_file($archivo['tmp_name'], $ruta)) {
        error_log('No se pudo mover el video a ' . $ruta);
        @rmdir($carpeta);
        responder(500, ['error' => 'No se pudo guardar el video']);
    }

    return ['ruta' => $ruta, 'nombre' => $nombre];
}

/**
 * Guarda el reporte de un análisis como JSON en DIRECTORIO_REPORTES.
 * El nombre incluye el id del reporte y la clave del video. Devuelve la ruta completa.
 */
function guardarReporteJson(int $reporteId, string $claveVideo, array $contenido): string
{
    $ruta = DIRECTORIO_REPORTES . "/reporte_{$reporteId}_{$claveVideo}.json";
    $json = json_encode($contenido, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($json === false || file_put_contents($ruta, $json) === false) {
        error_log('No se pudo escribir el reporte en ' . $ruta);
        throw new RuntimeException('No se pudo escribir el reporte');
    }

    return $ruta;
}

/**
 * Borra un reporte JSON. Se usa si no se puede registrar en la base de datos.
 */
function eliminarReporteJson(string $ruta): void
{
    @unlink($ruta);
}

/**
 * Borra un video y su carpeta. Se usa si no se puede registrar en la base de datos.
 */
function eliminarVideo(string $ruta): void
{
    @unlink($ruta);
    @rmdir(dirname($ruta));
}
