<?php
declare(strict_types=1);

/**
 * Guarda un frame analizado y sus detecciones (tablas `imagenes` y `detecciones`).
 * Debe llamarse dentro de una transacción. Las detecciones se insertan en lotes.
 * Devuelve el id de la imagen guardada.
 */
function guardarAnalisis(
    PDO $pdo,
    string $nombre,
    int $tamanoBytes,
    array $detecciones,
    ?int $reporteId,
    ?float $instante
): int {
    $pdo->prepare(
        'INSERT INTO imagenes (reporte_id, nombre_archivo, instante_seg, tamano_bytes) VALUES (?, ?, ?, ?)'
    )->execute([$reporteId, $nombre, $instante, $tamanoBytes]);
    $imagenId = (int) $pdo->lastInsertId();

    foreach (array_chunk($detecciones, 500) as $lote) {
        $marcadores = implode(',', array_fill(0, count($lote), '(?, ?, ?, ?, ?, ?, ?)'));
        $valores = [];
        foreach ($lote as $d) {
            array_push(
                $valores,
                $imagenId,
                (string) $d['clase'],
                (float) $d['confianza'],
                (int) $d['x1'],
                (int) $d['y1'],
                (int) $d['x2'],
                (int) $d['y2']
            );
        }
        $pdo->prepare(
            "INSERT INTO detecciones (imagen_id, clase, confianza, x1, y1, x2, y2) VALUES $marcadores"
        )->execute($valores);
    }

    return $imagenId;
}
