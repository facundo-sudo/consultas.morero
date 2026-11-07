# Consulta BCRA

Página para consultar varios CUIT de una vez en la **Central de Deudores del BCRA**, usando la API pública oficial (`api.bcra.gob.ar`).

## Publicar en Vercel

Importar este repositorio en Vercel y aceptar. No hay que configurar nada ni poner claves. La carpeta `api/` es una función que hace la consulta al BCRA (el navegador no puede llamar directo a esa API).

## Cómo se usa

1. Elegir la categoría: **Proveedores**, **Agronomías**, **Productores**, **Grupos de siembra** o **Varios**. Cada una tiene su propia lista (al lado del nombre se ve cuántos CUIT tiene).
2. Cargar los CUIT en «Agregar o editar CUIT», uno por renglón (con o sin guiones). Se puede poner un nombre al lado como referencia.
   - Los CUIT de la categoría aparecen en una **lista con casillas**: se tildan los que se quieren consultar. Hay un buscador (por nombre o parte del CUIT) y botones «Marcar todos» / «Ninguno» (actúan sobre lo que se ve en la búsqueda). Lo tildado queda guardado; en cada solapa se ve cuántos hay tildados (por ejemplo, 2/10). Los CUIT nuevos entran sin tildar.
   - **Importar Excel**: se toma la columna con el CUIT y, si hay, la del nombre. Si el Excel tiene una columna «Categoría» (o «Tipo»/«Rubro») con Proveedor, Agronomía, Productor, Grupo de siembra o Varios, cada CUIT va a su lista. También sirve un Excel con una hoja por categoría (hojas llamadas «Proveedores», «Productores», etc.). Lo que no tiene categoría va a la categoría elegida. Los CUIT repetidos no se duplican.
3. Elegir si además se consultan los **cheques rechazados** y el **historial y gráfico de 24 meses** (vienen tildados).
   - **Pasar a dólares**: se usa el dólar del **Banco Nación, Divisas, tipo vendedor**. Se elige si se convierte con el **dólar de hoy** o con el **dólar de fin de cada mes** (el último día hábil del período que informa el BCRA; es lo más preciso, porque la deuda informada es de ese mes). Los dos se traen solos de www.bna.com.ar. Si no se pueden traer, o se quiere usar otro, se escriben a mano: el de hoy en su casilla, o el de cada mes en «Dólar por mes» (los cargados a mano quedan marcados en amarillo y no se pisan al actualizar).
4. Tocar **Consultar los tildados** (de la categoría elegida) o **Consultar los tildados de todas las categorías**. Se consultan de a uno, con una pequeña pausa para no saturar la API.
5. En la tabla se ve, por CUIT: categoría, nombre, último período, peor situación (1 Normal … 5 Irrecuperable), deuda total en pesos y en dólares, cantidad de entidades y cheques rechazados. Tocando un renglón se ve el detalle por banco, los cheques, el puntaje y la **evolución de 24 meses**: una grilla por mes (puntaje, cantidad de bancos y situación con colores) y un gráfico de barras de la deuda total de cada mes, coloreado por la peor situación (pasando el mouse se ve el monto en pesos y dólares).
   - **Puntaje propio** (1 a 999): lo calcula la página con los datos públicos del BCRA. **No es el score de Nosis** ni de otro buró (esos son privados y requieren contratar su servicio). Parte de la situación actual (1: 850, 2: 600, 3: 400, 4: 250, 5 o 6: 100), resta por meses en situación 2 o peor en los últimos 24 meses, cheques rechazados (más si no se pagaron), proceso judicial, refinanciaciones y recategorización, y suma un poco por cada mes en situación normal. Verde 750 o más, amarillo 550–749, naranja 350–549, rojo menos de 350.
   Si se consultaron varias categorías, arriba de la tabla se puede filtrar por una.
   - **Cuadro mensual** (debajo de la tabla, como la planilla de deudas bancarias): una fila por empresa y, por cada mes (6, 8, 12 o 24 meses), la deuda en **pesos**, el **equivalente en dólares** (dólar Banco Nación de ese mes, que se muestra arriba), la **variación contra la deuda del mes anterior** (en dólares) y, **al final**, una columna con el **porcentaje de la facturación aproximada** que representa la deuda del último mes. La facturación se escribe en la primera columna en dólares, por ejemplo «400/430 MILL» (se usa el número más alto, como en la planilla) y queda guardada; también se puede traer en el Excel importado con una columna «Facturación». Se ordena por la deuda del último mes. En la columna final, fondo amarillo: 50% o más de la facturación; rojo: 100% o más. Si falta el dólar del Banco Nación de algún mes, usa el de hoy y lo marca «(de hoy)». Para moverse, se arrastra el cuadro con el mouse. Necesita tildado «Historial y gráfico».
6. **Bajar en Excel** arma un archivo (de lo que se ve en la tabla, con la columna de categoría, el puntaje, los montos en dólares y el dólar usado) con el resumen, el **cuadro mensual** (con el mismo formato que la planilla), las deudas por entidad, los cheques rechazados y el historial.

**Nueva consulta** (al pie de los resultados y arriba, junto a los botones de consultar) borra los resultados, el buscador, el filtro por categoría y lo tildado, y vuelve al principio. Las listas de CUIT no se borran.

Si el dólar mensual del Banco Nación no se puede traer, la página muestra el motivo. Para ver qué respondió el banco, abrir `/api/bna?mes=AAAAMM&ver=1` en la página publicada (por ejemplo `/api/bna?mes=202609&ver=1`).

Las listas de CUIT de cada categoría y los dólares cargados quedan guardados en el navegador para la próxima vez (otro navegador u otra PC empiezan vacíos).

## Archivos

- `index.html`, `styles.css`, `app.js`: la página.
- `api/bcra.js`: función de Vercel que consulta el BCRA.
- `api/bna.js`: función de Vercel que lee el dólar Divisas vendedor de la página del Banco Nación (de hoy y de fin de cada mes). El BNA no tiene una API: si cambia su página, el dólar se carga a mano.
- `vendor/xlsx.full.min.js`: SheetJS, para leer y generar Excel.
