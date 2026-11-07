# Consulta BCRA

Página para consultar varios CUIT de una vez en la **Central de Deudores del BCRA**, usando la API pública oficial (`api.bcra.gob.ar`).

## Publicar en Vercel

Importar este repositorio en Vercel y aceptar. No hay que configurar nada ni poner claves. La carpeta `api/` es una función que hace la consulta al BCRA (el navegador no puede llamar directo a esa API).

## Cómo se usa

1. Elegir la categoría: **Proveedores**, **Agronomías**, **Productores**, **Grupos de siembra** o **Varios**. Cada una tiene su propia lista (al lado del nombre se ve cuántos CUIT tiene).
2. Pegar los CUIT, uno por renglón (con o sin guiones). Se puede poner un nombre al lado como referencia.
   - **Importar Excel**: se toma la columna con el CUIT y, si hay, la del nombre. Si el Excel tiene una columna «Categoría» (o «Tipo»/«Rubro») con Proveedor, Agronomía, Productor, Grupo de siembra o Varios, cada CUIT va a su lista. También sirve un Excel con una hoja por categoría (hojas llamadas «Proveedores», «Productores», etc.). Lo que no tiene categoría va a la categoría elegida. Los CUIT repetidos no se duplican.
3. Elegir si además se consultan los **cheques rechazados** y el **historial de 24 meses**.
   - **Pasar a dólares**: se usa el dólar del **Banco Nación, Divisas, tipo vendedor**. Se elige si se convierte con el **dólar de hoy** o con el **dólar de fin de cada mes** (el último día hábil del período que informa el BCRA; es lo más preciso, porque la deuda informada es de ese mes). Los dos se traen solos de www.bna.com.ar. Si no se pueden traer, o se quiere usar otro, se escriben a mano: el de hoy en su casilla, o el de cada mes en «Dólar por mes» (los cargados a mano quedan marcados en amarillo y no se pisan al actualizar).
4. Tocar **Consultar esta categoría** o **Consultar todas**. Se consultan de a uno, con una pequeña pausa para no saturar la API.
5. En la tabla se ve, por CUIT: categoría, nombre, último período, peor situación (1 Normal … 5 Irrecuperable), deuda total en pesos y en dólares, cantidad de entidades y cheques rechazados. Tocando un renglón se ve el detalle por banco.
   Si se consultaron varias categorías, arriba de la tabla se puede filtrar por una.
6. **Bajar en Excel** arma un archivo (de lo que se ve en la tabla, con la columna de categoría, los montos en dólares y el dólar usado) con el resumen, las deudas por entidad, los cheques rechazados y el historial.

Las listas de CUIT de cada categoría y los dólares cargados quedan guardados en el navegador para la próxima vez (otro navegador u otra PC empiezan vacíos).

## Archivos

- `index.html`, `styles.css`, `app.js`: la página.
- `api/bcra.js`: función de Vercel que consulta el BCRA.
- `api/bna.js`: función de Vercel que lee el dólar Divisas vendedor de la página del Banco Nación (de hoy y de fin de cada mes). El BNA no tiene una API: si cambia su página, el dólar se carga a mano.
- `vendor/xlsx.full.min.js`: SheetJS, para leer y generar Excel.
