<?php
declare(strict_types=1);

/**
 * Responde en JSON y termina la ejecución.
 */
function responder(int $codigo, array $datos): never
{
    http_response_code($codigo);
    echo json_encode($datos, JSON_UNESCAPED_UNICODE);
    exit;
}
