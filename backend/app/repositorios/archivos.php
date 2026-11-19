<?php
declare(strict_types=1);

/**
 * Inserta un video en la tabla `archivos`. Devuelve su id.
 */
function crearArchivo(PDO $pdo, array $datos): int
{
    $pdo->prepare(
        'INSERT INTO archivos (clave_unica, nombre_original, nombre_guardado, ruta, tamano_bytes, tipo_mime)
         VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([
        $datos['clave_unica'],
        mb_substr($datos['nombre_original'], 0, 255),
        $datos['nombre_guardado'],
        $datos['ruta'],
        $datos['tamano_bytes'],
        $datos['tipo_mime'],
    ]);

    return (int) $pdo->lastInsertId();
}
