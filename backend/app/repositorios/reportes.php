<?php
declare(strict_types=1);

/**
 * Abre un reporte para un video con los ajustes del análisis. Devuelve su id.
 */
function crearReporte(PDO $pdo, int $archivoId, array $ajustes): int
{
    $pdo->prepare(
        'INSERT INTO reportes (archivo_id, fps, max_frames, confianza, iou, tamano, clases, modelo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $archivoId,
        $ajustes['fps'],
        $ajustes['max_frames'],
        $ajustes['confianza'],
        $ajustes['iou'],
        $ajustes['tamano'],
        $ajustes['clases'],
        $ajustes['modelo'],
    ]);

    return (int) $pdo->lastInsertId();
}

/**
 * Comprueba que el reporte existe y sigue abierto. Si no, responde 400.
 */
function comprobarReporteEnCurso(PDO $pdo, int $reporteId): void
{
    $stmt = $pdo->prepare('SELECT estado FROM reportes WHERE id = ?');
    $stmt->execute([$reporteId]);
    $estado = $stmt->fetchColumn();

    if ($estado === false) {
        responder(400, ['error' => 'El reporte no existe']);
    }
    if ($estado !== 'en_curso') {
        responder(400, ['error' => 'El reporte ya está cerrado']);
    }
}

/**
 * Datos completos de un reporte para escribir su archivo JSON: ajustes, video y resumen.
 */
function obtenerReporteCompleto(PDO $pdo, int $reporteId): array
{
    $stmt = $pdo->prepare(
        'SELECT r.id AS reporte_id, r.estado, r.fps, r.max_frames, r.confianza, r.iou, r.tamano, r.clases, r.modelo,
                r.frames_analizados, r.total_detecciones, r.resumen, r.creado_en, r.finalizado_en,
                a.clave_unica, a.nombre_original, a.nombre_guardado, a.tamano_bytes, a.tipo_mime
         FROM reportes r
         JOIN archivos a ON a.id = r.archivo_id
         WHERE r.id = ?'
    );
    $stmt->execute([$reporteId]);
    $fila = $stmt->fetch();
    $fila['resumen'] = json_decode((string) $fila['resumen'], true);

    return $fila;
}

/**
 * Guarda la ruta del archivo JSON del reporte.
 */
function guardarRutaReporte(PDO $pdo, int $reporteId, string $ruta): void
{
    $pdo->prepare('UPDATE reportes SET ruta_archivo = ? WHERE id = ?')->execute([$ruta, $reporteId]);
}

/**
 * Cierra un reporte guardando su resumen. Los totales se calculan con lo que realmente
 * se guardó en la base de datos. Devuelve el estado final del reporte.
 */
function cerrarReporte(PDO $pdo, int $reporteId, array $resumen): array
{
    $pdo->prepare(
        "UPDATE reportes r
         SET r.estado = 'completado',
             r.resumen = ?,
             r.frames_analizados = (SELECT COUNT(*) FROM imagenes i WHERE i.reporte_id = r.id),
             r.total_detecciones = (
                 SELECT COUNT(*) FROM detecciones d
                 JOIN imagenes i ON i.id = d.imagen_id
                 WHERE i.reporte_id = r.id),
             r.finalizado_en = NOW()
         WHERE r.id = ?"
    )->execute([json_encode($resumen, JSON_UNESCAPED_UNICODE), $reporteId]);

    $stmt = $pdo->prepare(
        'SELECT id AS reporte_id, estado, frames_analizados, total_detecciones FROM reportes WHERE id = ?'
    );
    $stmt->execute([$reporteId]);

    return $stmt->fetch();
}
