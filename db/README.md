# Base de datos (`db/`)

Base de datos MySQL 8.4 para guardar los análisis. El esquema está definido en `init.sql`, pero **el backend todavía no escribe en ella**: por ahora el sistema funciona sin persistencia y los resultados solo se muestran en pantalla.

---

## Estructura

| Archivo | Qué contiene |
|---|---|
| `Dockerfile` | Imagen `mysql:8.4`. Copia `init.sql` a `/docker-entrypoint-initdb.d/01-init.sql`. |
| `init.sql` | Crea la base de datos, las tablas, el índice y el usuario de la aplicación. |

---

## Esquema

Base de datos: `deteccion_objetos` (utf8mb4, `utf8mb4_unicode_ci`).

### Tabla `imagenes`

Un registro por imagen enviada al motor.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `INT UNSIGNED`, clave primaria, autoincremental | Identificador. |
| `nombre_archivo` | `VARCHAR(255)`, obligatorio | Nombre original del archivo. |
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

## Estado actual y próximos pasos

- El esquema está creado y el usuario `dov_app` tiene los permisos necesarios.
- El backend no inserta datos todavía. Para conectarlo habría que añadir a `services.php` la inserción en `imagenes` y `detecciones` tras cada análisis, o, mejor, guardar un análisis completo (un video con sus frames) a partir de un nuevo endpoint.
- Un análisis de video produce muchas filas en `detecciones`; conviene guardar en lote en lugar de insertar una a una.
