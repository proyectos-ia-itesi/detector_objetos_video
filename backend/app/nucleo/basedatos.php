<?php
declare(strict_types=1);

/**
 * Abre una conexión PDO con MySQL. Configuración por variables de entorno.
 */
function conectarBaseDatos(): PDO
{
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        getenv('DB_HOST') ?: 'db',
        getenv('DB_NAME') ?: 'deteccion_objetos'
    );

    return new PDO($dsn, getenv('DB_USER') ?: 'dov_app', getenv('DB_PASSWORD') ?: '', [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}

/**
 * Ejecuta varias escrituras en una transacción.
 * Si algo falla, deshace todo y relanza la excepción.
 */
function transaccion(callable $operacion): mixed
{
    $pdo = conectarBaseDatos();
    $pdo->beginTransaction();

    try {
        $resultado = $operacion($pdo);
        $pdo->commit();
        return $resultado;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/**
 * Ejecuta una operación de base de datos. Si falla, registra el error y responde 503.
 */
function conBaseDatos(callable $operacion): mixed
{
    try {
        return $operacion();
    } catch (Throwable $e) {
        error_log('Error de base de datos: ' . $e->getMessage());
        responder(503, ['error' => 'No se pudo acceder a la base de datos']);
    }
}
