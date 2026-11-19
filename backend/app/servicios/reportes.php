<?php
declare(strict_types=1);

/**
 * Cierra un reporte: guarda el resumen en la base de datos y escribe su archivo JSON
 * en DIRECTORIO_REPORTES. Si algo falla, no queda ni el JSON ni el cierre a medias.
 */
function servicioFinalizarReporte(): array
{
    $reporteId = (int) ($_POST['reporte_id'] ?? 0);
    $resumen = json_decode((string) ($_POST['resumen'] ?? ''), true);
    if ($reporteId <= 0 || !is_array($resumen)) {
        responder(400, ['error' => 'Faltan "reporte_id" o "resumen" válido']);
    }

    $ruta = null;
    try {
        $estado = transaccion(function (PDO $pdo) use ($reporteId, $resumen, &$ruta) {
            comprobarReporteEnCurso($pdo, $reporteId);
            $estado = cerrarReporte($pdo, $reporteId, $resumen);

            // Con los totales ya calculados se escribe el JSON y se guarda su ruta
            $completo = obtenerReporteCompleto($pdo, $reporteId);
            $ruta = guardarReporteJson($reporteId, $completo['clave_unica'], $completo);
            guardarRutaReporte($pdo, $reporteId, $ruta);

            return $estado;
        });
    } catch (Throwable $e) {
        if ($ruta !== null) {
            eliminarReporteJson($ruta);
        }
        error_log('Error al finalizar el reporte: ' . $e->getMessage());
        responder(503, ['error' => 'No se pudo guardar el reporte']);
    }

    return $estado;
}
