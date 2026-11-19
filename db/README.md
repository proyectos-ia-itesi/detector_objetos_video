# Base de datos (`db/`)

Base de datos MySQL 8.4 para guardar los análisis. El esquema está definido en `init.sql`, pero el backend la escribe en cada análisis de frame (`servicio=detect`).

---

## Estructura

| Archivo | Qué contiene |
|---|---|
| `Dockerfile` | Imagen `mysql:8.4`. Copia `init.sql` a `/docker-entrypoint-initdb.d/01-init.sql`. |
| `init.sql` | Crea la base de datos, las tablas, el índice y el usuario de la aplicación. |

---

## Esquema

Base de datos: `deteccion_objetos` (utf8mb4, `utf8mb4_unicode_ci`). Relación entre tablas:

```
archivos (1) ──< reportes (1) ──< imagenes (1) ──< detecciones
```

Al borrar un archivo se borran sus reportes, sus frames y sus detecciones (`ON DELETE CASCADE`).

### Tabla `archivos`

Un registro por video subido. El archivo está en el volumen `videos-data` del backend.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `INT UNSIGNED`, clave primaria | Identificador. |
| `clave_unica` | `CHAR(36)`, única | UUID v4 que identifica el video; es también el nombre de su carpeta. |
| `nombre_original` | `VARCHAR(255)` | Nombre con el que se subió el video. |
| `nombre_guardado` | `VARCHAR(255)` | Nombre con el que quedó en disco (sin caracteres problemáticos). |
| `ruta` | `VARCHAR(500)` | Ruta completa, por ejemplo `/var/www/uploads/<clave_unica>/<nombre_guardado>`. |
| `tamano_bytes` | `BIGINT UNSIGNED` | Tamaño del video. |
| `tipo_mime` | `VARCHAR(100)` | Tipo detectado a partir del contenido, por ejemplo `video/mp4`. |
| `creado_en` | `TIMESTAMP` | Momento del registro. |

### Tabla `reportes`

Un registro por cada análisis de un video, con los ajustes usados y su resumen.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `INT UNSIGNED`, clave primaria | Identificador. |
| `archivo_id` | `INT UNSIGNED` | Video analizado. Clave foránea a `archivos(id)`. |
| `fps`, `max_frames` | `DECIMAL(4,2)`, `INT UNSIGNED` | Frames por segundo y tope de frames del análisis. |
| `confianza`, `iou` | `DECIMAL(3,2)` | Confianza mínima y umbral de solapamiento (0 a 1). |
| `tamano` | `SMALLINT UNSIGNED` | Tamaño de análisis. |
| `clases` | `VARCHAR(500)`, opcional | Clases filtradas, separadas por coma. Vacío = todas. |
| `estado` | `ENUM('en_curso', 'completado')` | Estado del análisis. |
| `frames_analizados`, `total_detecciones` | `INT UNSIGNED` | Calculados al cerrar el reporte. |
| `resumen` | `JSON`, opcional | Resumen del análisis (conteo máximo y apariciones por clase, y línea de tiempo). |
| `ruta_archivo` | `VARCHAR(500)`, opcional | Ruta del JSON del reporte en `backend/reports` (dentro del contenedor, `/var/www/reports/…`). |
| `creado_en`, `finalizado_en` | `TIMESTAMP` | Apertura y cierre del reporte. |

### Tabla `imagenes`

Frames enviados al motor (`imagenes`):

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `INT UNSIGNED`, clave primaria, autoincremental | Identificador. |
| `reporte_id` | `INT UNSIGNED`, opcional | Reporte al que pertenece el frame. |
| `nombre_archivo` | `VARCHAR(255)`, obligatorio | Nombre del archivo enviado (`frame.jpg`). |
| `instante_seg` | `DECIMAL(10,3)`, opcional | Segundo del video en que se tomó el frame. |
| `tamano_bytes` | `INT UNSIGNED`, obligatorio | Tamaño de la imagen. |
| `creado_en` | `TIMESTAMP`, por defecto la fecha actual | Momento del registro. |

### Tabla `detecciones`

Una fila por cada objeto detectado en una imagen.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `INT UNSIGNED`, clave primaria, autoincremental | Identificador. |
| `imagen_id` | `INT UNSIGNED`, obligatorio | Imagen a la que pertenece la detección. |
| `clase` | `VARCHAR(100)`, obligatorio | Nombre de la clase, por ejemplo `person`. |
| `confianza` | `DECIMAL(5,4)`, obligatorio | Confianza entre 0 y 1. |
| `x1`, `y1`, `x2`, `y2` | `INT`, obligatorios | Caja delimitadora en píxeles. |
| `creado_en` | `TIMESTAMP`, por defecto la fecha actual | Momento del registro. |

Relaciones e índices:

- `imagen_id` es clave foránea a `imagenes(id)` con **`ON DELETE CASCADE`**: al borrar una imagen se borran sus detecciones.
- `imagenes.reporte_id` es clave foránea a `reportes(id)` con **`ON DELETE CASCADE`**.
- Índice `idx_detecciones_imagen` sobre `imagen_id`, para obtener las detecciones de una imagen.
- Índice `idx_detecciones_clase` sobre `clase`, para consultas por tipo de objeto.

Ejemplo de consulta futura: cuántas veces aparece cada clase en todos los análisis.

```sql
SELECT clase, COUNT(*) AS apariciones
FROM detecciones
GROUP BY clase
ORDER BY apariciones DESC;
```

---

## Usuarios

| Usuario | Permisos | Uso |
|---|---|---|
| `root` | todos | Administración. Contraseña en `docker-compose.yml` (`MYSQL_ROOT_PASSWORD`). |
| `dov_app` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` sobre `deteccion_objetos.*` | Usuario que usará la aplicación. Se crea con `init.sql`. |

La contraseña de `dov_app` está en `init.sql`. Es solo para desarrollo; para un despliegue real hay que cambiarla y moverla a un secreto.

---

## Arranque y persistencia

- Los datos se guardan en el volumen `db-data`.
- `init.sql` se ejecuta **solo la primera vez**, cuando el volumen está vacío. Para volver a crear el esquema desde cero hay que borrar el volumen:

  ```bash
  docker compose down -v   # borra también db-data
  docker compose up --build
  ```

  Ojo: esto elimina todos los datos guardados.

- El puerto `3306` no se publica al host. Solo los contenedores de la red `app-net` pueden conectarse.

---

## Consultar la base de datos

```bash
# Entrar al cliente de MySQL dentro del contenedor
docker exec -it dov-db mysql -uroot -p deteccion_objetos
# contraseña: la de MYSQL_ROOT_PASSWORD en docker-compose.yml

# Comprobar las tablas
docker exec -it dov-db mysql -uroot -p -e "SHOW TABLES;" deteccion_objetos
```

---

## Migraciones

`database/init.sql` solo se ejecuta en un volumen vacío. Para una base de datos ya creada, aplica los cambios de `migrations/`, en orden y una sola vez:

```bash
docker exec -i dov-db mysql -uroot -p deteccion_objetos < db/migrations/001_archivos_reportes.sql
```

| Migración | Qué añade |
|---|---|
| `001_archivos_reportes.sql` | Tablas `archivos` y `reportes`; columnas `reporte_id` e `instante_seg` en `imagenes`. |
| `002_clave_unica_archivos.sql` | Columnas `clave_unica` (única) y `nombre_guardado` en `archivos`. |
| `003_ruta_reportes.sql` | Columna `ruta_archivo` en `reportes`. |

## Estado actual

- El backend guarda el video (`archivos`), el análisis (`reportes`), cada frame con su instante (`imagenes`) y sus objetos (`detecciones`).
- Todo se escribe en una transacción; si la base de datos no responde, el backend devuelve `503`.
