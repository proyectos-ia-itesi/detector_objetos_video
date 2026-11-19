<?php
declare(strict_types=1);

/**
 * Lee un ajuste numérico del formulario y comprueba su rango.
 * Si no es válido, responde 400.
 */
function leerNumero(string $campo, float $min, float $max): float
{
    $valor = $_POST[$campo] ?? null;
    if (!is_numeric($valor) || (float) $valor < $min || (float) $valor > $max) {
        responder(400, ['error' => "Ajuste no válido: $campo"]);
    }
    return (float) $valor;
}

/**
 * Nombre seguro para guardar en disco: conserva letras, números, puntos, guiones y guion bajo.
 * Ejemplo: "mi video (1).mp4" -> "mi_video_1.mp4"
 */
function nombreSeguro(string $nombre): string
{
    $base = basename(str_replace('\\', '/', $nombre));
    $base = preg_replace('/[^\pL\pN._-]+/u', '_', $base) ?? '';
    $base = trim($base, '._');
    $base = mb_substr($base, 0, 150);

    return $base !== '' ? $base : 'video';
}
