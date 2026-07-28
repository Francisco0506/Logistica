# Cómo fluyen los documentos en SAP, y qué día sale la mercancía

Medido contra la base **productiva** el 28-jul-2026, solo con consultas de
lectura. Es el documento que contesta la pregunta que traía atorado al panel:
**¿qué tiene que cargar el despachador en la mañana?**

---

## La cadena

```
ORDEN DE VENTA          ENTREGA                    FACTURA
(ORDR)                  (ODLN)                     (OINV)
el cliente pide         sale del almacén           se cobra
      │                       │                        │
      └──── mismo día ────────┘                        │
              64%             └──── al día siguiente ──┘
                                        68%
```

En SAP el encadenado vive en las líneas, no en las cabeceras:

| Relación | Dónde se ve |
|---|---|
| La orden de venta se copió a una entrega | `RDR1.TargetType = 15` |
| La entrega nació de una orden de venta | `DLN1.BaseType = 17` |
| La entrega se copió a una factura | `DLN1.TargetType = 13` |
| La factura nació de una entrega | `INV1.BaseType = 15` |

**Las 1,217 entregas de 14 días nacen todas de una orden de venta.** No hay
entregas capturadas directas.

## Cuánto tarda cada paso (30 días)

**De orden de venta a entrega:**

| | Entregas | |
|---|---|---|
| el mismo día | 1,816 | **64%** |
| 1 día después | 367 | 13% |
| 2 días después | 271 | 10% |
| 3+ días | 343 | 13% |

**De entrega a factura:**

| | Entregas | |
|---|---|---|
| el mismo día | 581 | 22% |
| **1 día después** | **1,838** | **68%** |
| 2 días después | 217 | 8% |

## El ciclo de un día normal

Trazado con documentos reales del 27-jul (los que salieron el 28):

```
27-jul  09:20   Orden de venta 251041   COMIDAS PRO
27-jul  10:35   Entrega        265797   (queda ABIERTA)
28-jul  12:19   Factura        368361   (la entrega se CIERRA)
```

Y el patrón general del día:

| Momento | Qué pasa |
|---|---|
| **Día X, 10-11 am y 2-3 pm** | Almacén surte y captura las ENTREGAS |
| **Día X+1, 7-9 am** | Facturación las factura → se CIERRAN |
| **Día X+1, 9-10 am** | El camión sale con esa mercancía |

Las entregas del 27-jul se facturaron el 28 así: **184 renglones a las 7:00 y
135 a las 8:00**. Los camiones ese día salieron entre 7:46 y 9:33.

## Lo que esto significa para el despachador

**La entrega capturada hoy sale mañana.**

Por eso el panel se veía vacío en la mañana: pedía las entregas *de hoy*, que a
las 9 am apenas empiezan a existir (medido el 28-jul: 0 a las 09:49, 27 a las
10:48, 73 a la 1 pm). Lo que va a salir esa mañana se capturó **ayer**, y ya
está completo desde anoche.

**Regla: el despachador carga las entregas del último día con captura, no las de
hoy.** El lunes eso es el sábado, no el domingo.

### Por qué NO sirve filtrar por "abiertas"

Se consideró y se descartó con datos. La entrega nace abierta y se cierra al
facturarse, y eso pasa **a las 7-8 am del día siguiente — antes de que salga el
camión**. A las 8:30, cuando el despachador planea, lo que va a salir ya está
CERRADO.

| Antigüedad | Entregas | Siguen abiertas |
|---|---|---|
| hoy | 73 | 88% |
| ayer | 145 | 8% |
| 2-3 días | 54 | 0% |
| 8-30 días | 2,166 | 0.3% |
| 3-6 meses | 7,285 | 0.1% |

Filtrar por abiertas dejaría fuera justo lo que sí va a salir.

Sí sirve para otra cosa: **66 entregas llevan meses sin cerrar** —Pizza DePrizza
(8, todas del 26-may), Cervecería Regiomontana (4), una de febrero de 2025— y
son documentos olvidados que conviene revisar en SAP. No son reparto pendiente.

## Lo que SAP no dice

**No hay ningún campo que diga qué día sale la mercancía.** `DocDate` y
`DocDueDate` de la entrega son iguales en las 2,674 revisadas. La fecha de
salida se deduce del ciclo de arriba, no se lee.

Y la fecha comprometida de la orden de venta (`ORDR.DocDueDate`) tampoco sirve
para planear: de 30 días, 1,432 órdenes prometen +1 día y 452 prometen +2, pero
al cruzarlas contra la entrega real aparecen cientos entregadas **antes** de la
fecha prometida. No se respeta como compromiso operativo.

## Consultas de referencia

Todas son SELECT. Ninguna toca datos.

```sql
-- La cadena completa de una entrega
SELECT O.DocNum AS orden_venta, O.DocDate, O.CreateTS,
       D.DocNum AS entrega,     D.DocDate, D.CreateTS, D.DocStatus,
       I.DocNum AS factura,     I.DocDate, I.CreateTS
FROM ODLN D
JOIN DLN1 L      ON L.DocEntry = D.DocEntry
LEFT JOIN ORDR O ON O.DocEntry = L.BaseEntry  AND L.BaseType   = 17
LEFT JOIN OINV I ON I.DocEntry = L.TrgetEntry AND L.TargetType = 13
WHERE D.DocNum = ?

-- A qué hora se capturaron las entregas de un día
-- (CreateTS viene como HHMMSS en entero: /10000 da la hora)
SELECT CreateTS/10000 AS hora, COUNT(*)
FROM ODLN WHERE DocDate = ? GROUP BY CreateTS/10000 ORDER BY 1
```
