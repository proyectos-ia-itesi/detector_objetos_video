<?php
declare(strict_types=1);

/**
 * Comprueba el estado del backend y del motor de IA.
 */
function servicioHealth(): array
{
    $ch = curl_init(urlMotor() . '/health');
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
