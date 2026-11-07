# Consulta BCRA

Página para consultar varios CUIT de una vez en la **Central de Deudores del BCRA**, usando la API pública oficial (`api.bcra.gob.ar`).

## Publicar en Vercel

Importar este repositorio en Vercel y aceptar. No hay que configurar nada ni poner claves. La carpeta `api/` es una función que hace la consulta al BCRA (el navegador no puede llamar directo a esa API).

## Cómo se usa

1. Elegir la categoría: **Proveedores**, **Agronomías**, **Productores**, **Grupos de siembra** o **Varios**. Cada una tiene su propia lista (al lado del nombre se ve cuántos CUIT tiene).
2. Pegar los CUIT, uno por renglón (con o sin guiones). Se puede poner un nombre al lado como referencia, o subir un Excel con una columna de CUIT (y, si tiene, una de nombre); el Excel se suma a la categoría elegida.
3. Elegir si además se consultan los **cheques rechazados** y el **historial de 24 meses**.
4. Tocar **Consultar esta categoría** o **Consultar todas**. Se consultan de a uno, con una pequeña pausa para no saturar la API.
5. En la tabla se ve, por CUIT: categoría, nombre, último período, peor situación (1 Normal … 5 Irrecuperable), deuda total, cantidad de entidades y cheques rechazados. Tocando un renglón se ve el detalle por banco.
   Si se consultaron varias categorías, arriba de la tabla se puede filtrar por una.
6. **Bajar en Excel** arma un archivo (de lo que se ve en la tabla, con la columna de categoría) con el resumen, las deudas por entidad, los cheques rechazados y el historial.

Las listas de CUIT de cada categoría quedan guardadas en el navegador para la próxima vez (otro navegador u otra PC empiezan vacíos).

## Archivos

- `index.html`, `styles.css`, `app.js`: la página.
- `api/bcra.js`: función de Vercel que consulta el BCRA.
- `vendor/xlsx.full.min.js`: SheetJS, para leer y generar Excel.
