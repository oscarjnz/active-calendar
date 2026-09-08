# Cambio de cuatrimestre — detección y wizard de transición

Fecha: 2026-09-08

## Contexto

Active Calendar guarda `profile.term` (cuatrimestre actual, 1-12) y `profile.courses`
(materias del cuatrimestre actual, se sobrescribe cada vez que el estudiante lo edita en
Ajustes u onboarding). No existe hoy ningún mecanismo que detecte que un cuatrimestre
terminó ni que ayude al estudiante a avanzar al siguiente. El estudiante tiene que ir a
Ajustes y rehacer manualmente su selección de materias cada vez.

`time.ts` ya calcula `currentAcademicWeek()`, que devuelve `week: null` cuando la fecha
actual cae en receso (fuera del bloque de 15 semanas). Este proyecto usa esa señal como
disparador de un wizard de transición de cuatrimestre.

## Objetivo

1. Detectar automáticamente cuando el estudiante debería haber terminado su cuatrimestre
   (receso) y ofrecerle un wizard para avanzar.
2. Preguntar si dejó/reprobó alguna materia del cuatrimestre que terminó, o si tiene algún
   prerequisito pendiente para materias del cuatrimestre que sigue.
3. Si no dejó nada: avanzar automáticamente con la lista de materias obligatorias del
   siguiente cuatrimestre según el pensum.
4. Si dejó algo: dejarlo elegir manualmente (reusando el picker existente) qué materias
   lleva el cuatrimestre que entra, con las reprobadas pre-marcadas para repetir y avisos
   (no bloqueos) quandpo un prerequisito no está satisfecho.
5. Ampliar `pensum.ts` con datos de prerequisitos reales (del PDF oficial + las
   concentraciones que el usuario detalló) para poder calcular esos avisos.

## Fuera de alcance

- Prerequisitos "duros" (bloqueo real de selección): se decidió que sea solo advertencia,
  nunca bloqueo, porque el bootstrap de `completed_courses` (ver abajo) no puede reconstruir
  con certeza electivas de cuatrimestres pasados a estudiantes que ya llevan tiempo en la
  carrera antes de que este feature existiera.
- Reconciliar el posible duplicado entre `PENDGP3` ("Preparación para la Certificación
  CAPM/PMP", concentración Gestión de Proyectos, sin código oficial) e `IC4525` ("Seminario
  de Preparación al CAPM-PMI", concentración Electiva profesional, código real) — quedan
  como entradas separadas hasta que el usuario confirme si son la misma materia.
- Un flujo de graduación completo (`term > 12`): solo se evita que crashee: no se
  prellena core (no existe) y se muestra un texto de "ya casi terminas la malla".

## Datos: cambios en `pensum.ts`

### Limpieza de la concentración Emprendimiento

Los códigos `UNBE01`, `UNBE02`, `UNB303`, `UNB304`, `UNB305` eran placeholders inventados en
una sesión anterior. `UNBE01` ("Pensamiento y Acción Emprendedora") y `UNBE02` ("Taller de
Creatividad e Innovación para los Negocios") duplican materias que YA son obligatorias con
código real: `UNB101` (semestre 2) y `AD8220` (semestre 11) respectivamente. Se eliminan las
5 entradas viejas. La concentración Emprendimiento pasa a construirse sobre esas dos
materias core (sin volver a listarlas) más 3 electivas nuevas con código real:

| Código   | Nombre                                                  | Sem sugerido | Prereq |
|----------|----------------------------------------------------------|:---:|--------|
| AD7519   | Emprendimiento para la Creación de Nuevos Negocios       | 9   | —      |
| AD7521   | Gestión de Nuevos Negocios (Startups)                    | 10  | —      |
| AD7522   | Intraemprendimiento (Emprendimiento Corporativo)         | 11  | —      |

Ninguna trae prerequisito documentado por el usuario; no se inventa ninguno (aunque
lógicamente podrían encadenarse a `AD8220`, no hay una fuente que lo confirme).

### Concentraciones nuevas

**Investigación** (sobre `UNB200` "Metodología de la Investigación", ya core en sem 4; el
código "CGC-200" que mencionó el usuario no coincide con el PDF oficial del pensum, que dice
`UNB200`, así que se ignora esa mención y no se duplica la entrada):

| Código  | Nombre                        | Sem sugerido | Prereq |
|---------|--------------------------------|:---:|--------|
| RT1100  | Filosofía de la Ciencia        | 9   | —      |
| RT1130  | Estadística II                 | 10  | —      |
| RT1150  | Prácticas de la Investigación  | 11  | —      |

**Innovación + Desarrollo** (sobre `TI3111` "Fundamentos de Programación", ya core en sem 3):

| Código   | Nombre                     | Sem sugerido | Prereq | Nota |
|----------|----------------------------|:---:|--------|------|
| UNB300   | Estrategias de Innovación  | 9   | —      | código real |
| PENDIN1  | Pasantía en Innovación     | 10  | —      | sin código oficial (N/A en la fuente) |

**Gestión de Proyectos** (ninguna de sus 3 materias tiene código oficial asignado todavía):

| Código   | Nombre                                                    | Sem sugerido |
|----------|------------------------------------------------------------|:---:|
| PENDGP1  | Introducción a la Gestión de Proyectos (PMBOK)             | 9   |
| PENDGP2  | Gestión de Proyectos Ágiles                                | 10  |
| PENDGP3  | Preparación para la Certificación CAPM/PMP                 | 11  |

Los códigos `PENDxxx` son placeholders explícitos (nunca van a aparecer en un feed real de
Blackboard, así que jamás se autoderivan; solo sirven para que el estudiante los vea y elija
manualmente en el picker, tal como pidió el usuario — "ponlas todas, tengan o no tengan
código").

### Prerequisitos de las concentraciones existentes (Gestión de Software / Ciberseguridad)

Usando la lista que dio el usuario, con la convención: coma = AND (hace falta cada una),
"/" no se usó aquí pero se mantiene la misma convención que en el PDF oficial por
consistencia.

| Código  | Prereq (AND de grupos) |
|---------|-------------------------|
| TI3701  | TI3214 |
| TI3711  | TI3211 **y** TI3214 |
| TI3501  | TI3212 |
| TI3511  | TI3215 **y** TI3314 |
| TI3521  | TI3313 |
| TI3531  | TI3321 |
| TI3702  | TI3212 **y** TI3321 |
| TI3712  | TI3110 |
| TI3502  | TI3321 |
| TI3512  | TI3321 |
| TI3522  | TI3502 (depende de OTRA electiva del mismo track, no de una core) |
| TI3532  | TI3321 |

### Prerequisitos oficiales del pensum (obligatorias)

Extraídos del PDF (`pensum-tic-unibe.pdf`) por posición (x/y de cada celda), no por el texto
plano (que quedaba desordenado por el layout de dos tablas lado a lado). Convención: "/" en
el PDF = OR (basta aprobar una de las alternativas — el pensum no aclara si es AND u OR;
se asume OR porque es la interpretación menos restrictiva y el chequeo es solo advertencia,
nunca bloqueo).

```
EGC154: EGC153            TI3111: TI3110             TI3213: TI3111 o TI3210
EGL302: EGL301            EGC252: EGC155 o EGC156    TI3630: TI3111 o TI3121
TI3110: EGC153            EGC270: EGC170             EGC254: EGC253
TI3121: TI3120            EGL304: EGL303             IG1330: EGC154
EGC155: EGC154             TI3210: TI3110             TI3214: TI3213
EGC156: EGC153             TI3211: TI3111             TI3215: TI3211 o TI3213
EGC170: EGC154             EGC253: EGC252             TI3220: EGC271
EGL121: EGL120             EGC255: UNB202              TI3600: TI3630
EGL303: EGL302             EGC271: EGC252 o EGC270
TI3212: TI3211

II4212: EGC253 o UNB202    TI3314: TI3110              TI3500..530 (Electiva
II4440: IG1330             TI3323: TI3220               Profesional genérica): sin
TI3310: TI3110             TI3315: TI3313               prereq propio (se usan códigos
TI3311: TI3213 o TI3215    TI3316: TI3215               concretos de concentración)
TI3320: TI3220             TI3325: TI3322
TI3321: TI3121             TI3326: TI3323              TI3610: TI3600 o TI3631
TI3322: TI3121             TI3631: TI3312 o TI3322      TI3620: TI3631
TI3312: TI3311                o TI3324 o TI3630          TI3432: II4440
TI3313: TI3311             AD8220: AD8120               TI3433: TI3430
                                                          TI3621: TI3620
```

(Lista completa código→prereq se implementa en `pensum.ts`, no en este documento; la tabla
de arriba es la referencia de verificación. Todas las materias no listadas no tienen
prerequisito.)

### Estructura de datos

```ts
export type PrereqGroup = string[]; // OR dentro del grupo
export const PREREQS: Record<string, PrereqGroup[]> = {
  EGC154: [['EGC153']],
  EGC252: [['EGC155', 'EGC156']],       // "/" del PDF -> OR
  TI3711: [['TI3211'], ['TI3214']],     // "," del usuario -> AND
  TI3631: [['TI3312', 'TI3322', 'TI3324', 'TI3630']],
  // ...
};

/** true si `completed` (Set de códigos normalizados) satisface el prerequisito de `code`. */
export function prereqSatisfied(code: string, completed: Set<string>): boolean {
  const groups = PREREQS[normalizeCode(code)];
  if (!groups) return true; // sin prereq documentado
  return groups.every((g) => g.some((alt) => completed.has(normalizeCode(alt))));
}
```

## Schema (`schema.sql`, migración no destructiva)

```sql
alter table profiles add column if not exists completed_courses jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists term_wizard_resolved_for text;
```

- `completed_courses`: array de códigos normalizados (`string[]`) acumulado a través de
  cuatrimestres. Bootstrap (primera vez que es null/vacío y `profile.term` ya está seteado):
  todas las materias OBLIGATORIAS de `PENSUM` con `sem < profile.term`. **No** incluye
  materias del cuatrimestre actual (están en curso, no aprobadas) ni intenta adivinar
  electivas de cuatrimestres pasados (hueco conocido y aceptado — por eso el chequeo de
  prerequisito es advertencia, no bloqueo).
- `term_wizard_resolved_for`: id de receso (`"YYYY-B"`, bloque próximo) ya resuelto por el
  estudiante (avanzó de cuatrimestre o confirmó que no había terminado). Evita repreguntar en
  cada carga de página durante el mismo receso.

## `time.ts`: `currentRecesoId`

```ts
/** Id estable del receso actual ("YYYY-B", bloque que empieza al salir del receso), o null
 *  si no estamos en receso. Sirve para no repetir el wizard de cambio de cuatrimestre más
 *  de una vez por receso. */
export function currentRecesoId(now: Date = new Date()): string | null {
  const week = currentAcademicWeek(now);
  if (week.week !== null) return null;
  // bloque siguiente al actual (1->2->3->1, con año+1 al pasar de 3 a 1)
  const p = toSdqParts(now);
  const nextBlock = ((week.block % 3) + 1) as 1 | 2 | 3;
  const nextYear = week.block === 3 ? p.year + 1 : p.year;
  return `${nextYear}-${nextBlock}`;
}
```

## Backend (`index.ts`, `supabase.ts`)

- `POST /api/profile`: el body acepta dos campos nuevos, opcionales:
  `completed_courses?: string[]` y `term_wizard_resolved_for?: string | null`.
  `updateProfile()` en `supabase.ts` los persiste igual que los campos existentes. No hace
  falta un endpoint nuevo — el wizard termina con la misma llamada que ya usa el picker de
  Ajustes/onboarding.
- `GET /api/me`: sigue devolviendo `profile` completo (ya incluye los campos nuevos al
  agregarlos al schema/tipo `Profile`). El front decide si mostrar el banner comparando
  `term_wizard_resolved_for` contra `currentRecesoId()` (que se manda ya calculado en
  `window.__WEEK__` o similar, replicando cómo hoy se manda `week`).

## Frontend (`html.ts`)

### Banner automático

Se muestra cuando: `profile.term` está seteado, estamos en receso (`week.week === null` /
hay `recesoId`), y `profile.term_wizard_resolved_for !== recesoId`.

> "¿Terminaste el cuatrimestre {term}?" — botones **Sí** / **Ahora no**.
> "Ahora no" cierra el banner sin persistir nada (puede reaparecer en la próxima carga,
> mientras siga el mismo receso).

### Botón manual

En Ajustes, un botón "Cambié de cuatrimestre" dispara el mismo flujo pero saltando
directamente al paso 2 (al hacer clic ya está confirmando que terminó).

### Paso 2: materias dejadas/reprobadas

> "¿Dejaste, reprobaste, o te falta algún prerequisito pendiente en alguna de estas materias
> de {term actual}?" — checklist de `profile.courses` actuales, más una opción rápida
> "No, aprobé todas".

### Paso 3: picker reutilizado, ahora prereq-aware

Se calcula:
- `completedNew` = `Set(profile.completed_courses ?? bootstrap(profile))` ∪ códigos de
  `profile.courses` NO marcados como reprobados en el paso 2.
- `newTerm = profile.term + 1` (si `newTerm > 12`, ver "fuera de alcance").
- `prefill` = materias core de `PENSUM` con `sem === newTerm` ∪ las marcadas como reprobadas
  en el paso 2 (para repetirlas).

Se abre el `coursePicker()` YA EXISTENTE (el mismo de onboarding/Ajustes) con `prefill` y
`newTerm`, extendido para: por cada materia visible, si `!prereqSatisfied(code, completedNew)`
se le agrega un badge de aviso (⚠, con tooltip listando qué le falta) — nunca se oculta ni se
deshabilita la casilla.

### Guardar

Al confirmar el picker: `POST /api/profile` con
`{ term: newTerm, courses: [...seleccionadas], completed_courses: [...completedNew], term_wizard_resolved_for: recesoId }`.

## Casos borde

- `newTerm > 12`: no se prellena core (no existe), se muestra un mensaje de "ya casi
  terminas la malla" en vez de un picker con core vacío confuso; las reprobadas (si las hay)
  se siguen prellenando para repetir.
- Estudiante sin `profile.term`: no se evalúa el banner (nada que avanzar).
- Estudiante que nunca tuvo `completed_courses` y tampoco `profile.term` mayor a 1 (recién
  entra a la carrera): bootstrap da lista vacía, ningún aviso de prerequisito tiene sentido
  todavía (todo sin prereq documentado en sem 1, o el aviso es correcto: nada aprobado aún).

## Auto-revisión del spec

- Placeholders: ninguno pendiente; los códigos `PENDxxx` son placeholders **intencionales**
  documentados como tales, no huecos del spec.
- Consistencia interna: la sección de "fuera de alcance" (prereq como advertencia, no
  bloqueo) es coherente con la sección de bootstrap (que explica por qué no se puede
  garantizar precisión). El flujo del wizard (sección Frontend) es coherente con los campos
  de backend definidos arriba.
- Alcance: acotado a un solo subsistema (wizard de transición + datos de prerequisito);
  no requiere descomponerse en sub-proyectos.
- Ambigüedad: la única ambigüedad real que quedó (AND vs OR en "/") se resolvió explícitamente
  adoptando OR, documentado y justificado en la sección de datos.
