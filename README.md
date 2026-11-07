# Consulta BCRA

Página para consultar varios CUIT de una vez en la **Central de Deudores del BCRA**, usando la API pública oficial (`api.bcra.gob.ar`).

## Publicar en Vercel

Importar este repositorio en Vercel y aceptar. No hay que configurar nada ni poner claves. La carpeta `api/` es una función que hace la consulta al BCRA (el navegador no puede llamar directo a esa API).

## Cómo se usa

1. Pegar los CUIT, uno por renglón (con o sin guiones). Se puede poner un nombre al lado como referencia, o subir un Excel con una columna de CUIT (y, si tiene, una de nombre).
2. Elegir si además se consultan los **cheques rechazados** y el **historial de 24 meses**.
3. Tocar **Consultar en el BCRA**. Se consultan de a uno, con una pequeña pausa para no saturar la API.
4. En la tabla se ve, por CUIT: nombre, último período, peor situación (1 Normal … 5 Irrecuperable), deuda total, cantidad de entidades y cheques rechazados. Tocando un renglón se ve el detalle por banco.
5. **Bajar en Excel** arma un archivo con el resumen, las deudas por entidad, los cheques rechazados y el historial.

La lista de CUIT queda guardada en el navegador para la próxima vez.

## Archivos

- `index.html`, `styles.css`, `app.js`: la página.
- `api/bcra.js`: función de Vercel que consulta el BCRA.
- `vendor/xlsx.full.min.js`: SheetJS, para leer y generar Excel.
