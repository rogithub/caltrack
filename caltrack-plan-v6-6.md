# CalTrack — Plan de Proyecto v6

> API REST + MCP Server para tracking de calorías con AI Vision

---

## Visión General

El usuario toma una foto de su comida con cualquier cliente de AI (Claude, GPT-4o, Gemini, etc.). La AI estima las calorías y usa el MCP server para guardar el registro. El usuario puede preguntar en lenguaje natural cómo va su día, semana o cualquier rango y la AI consulta el historial via MCP.

El usuario nunca ve un endpoint, nunca hace un curl, nunca sabe que hay una API. Solo habla con la AI en su idioma.

El backend calcula BMR y TDEE usando la fórmula de Mifflin-St Jeor y los devuelve ya resueltos. La AI solo interpreta y comunica, no hace matemáticas.

**Sin AI en el backend. Sin ORM. Sin sobre-ingeniería.**

---

## Variables de Entorno

Un archivo `.env.example` documenta todo lo necesario para desplegar:

```
DATABASE_URL=postgresql://user:pass@host:5432/caltrack
PORT=3000
API_BASE_URL=https://caltrack.tudominio.com
```

---

## Consideraciones de Infraestructura

CalTrack corre en un cluster k3s casero. Pueden ocurrir interrupciones breves por cortes de luz u otras razones. K3s y ArgoCD manejan el reinicio automático del servicio, y el health check le dice a k8s cuándo el pod está listo para recibir tráfico después de un reinicio.

La AI es informada de esta situación directamente en la descripción del MCP server para que pueda comunicárselo amablemente al usuario en lugar de mostrar un error técnico:

```
Este es un servidor casero. Si no hay respuesta,
informa al usuario amablemente que puede haber una
interrupción temporal y que intente de nuevo en unos minutos.
```

---

## Discoverabilidad

### Para AIs
- `llms.txt` en la raíz del dominio — ya incluido
- OpenAPI schema en `/docs/json` — ya incluido

### Para buscadores
`robots.txt` le dice a Google qué indexar:

```
User-agent: *
Allow: /
Allow: /docs
Disallow: /meals
Disallow: /profile
Disallow: /auth
```

`sitemap.xml` con las URLs públicas:

```xml
<urlset>
  <url><loc>https://caltrack.tudominio.com/</loc></url>
  <url><loc>https://caltrack.tudominio.com/docs</loc></url>
</urlset>
```

`index.html` mínima en la raíz. Cuando alguien llega al dominio ve algo útil en lugar de un JSON vacío:

```html
<title>CalTrack — Calorie tracking for AI clients</title>
<meta name="description" content="Open source calorie tracker with MCP server and REST API. Works with Claude, ChatGPT and any AI Vision client.">
<meta property="og:title" content="CalTrack">
<meta property="og:description" content="Track calories with AI Vision. Free forever, self-hostable.">
```

### Para GitHub
El README es la pieza más importante de discoverabilidad. Google indexa GitHub extensamente y las AIs buscan proyectos open source ahí. El README incluirá descripción clara, palabras clave relevantes como "calorie tracker", "MCP server", "AI nutrition" y "self-hosted", instrucciones de uso y cómo configurar el MCP en Claude.ai.

---

CalTrack está diseñado para funcionar con cualquier cliente de AI, no solo Claude.

### MCP (Claude.ai web, móvil y Desktop)
El MCP server remoto vía HTTP/SSE es el método principal. El usuario agrega la URL en su configuración una sola vez y listo. Funciona desde el navegador, móvil y desktop sin instalar nada.

### OpenAPI Schema (ChatGPT y otros)
Fastify genera el schema OpenAPI automáticamente con `@fastify/swagger`. Disponible en:
- Documentación visual: `https://caltrack.tudominio.com/docs`
- Schema en JSON: `https://caltrack.tudominio.com/docs/json`

Para ChatGPT el usuario puede registrar la API como un GPT Action usando el schema JSON. El flujo es idéntico al MCP desde la perspectiva del usuario.

### `llms.txt`
Archivo estático en la raíz del dominio que las AIs leen para descubrir qué puede hacer el servicio, similar a `robots.txt` pero para modelos de lenguaje.

```
# CalTrack
Calorie tracking API with AI Vision support.
Register meals by photo, query history and get personalized nutrition context.

OpenAPI schema: https://caltrack.tudominio.com/docs/json
MCP server: https://caltrack.tudominio.com/mcp
```

---



**`uuidv7()` en lugar de `gen_random_uuid()`**
UUIDv7 incluye el timestamp en los primeros bits, lo que hace los IDs ordenables cronológicamente. Para la tabla `meals` que siempre se consulta por rango de fechas, el índice del primary key es secuencial en lugar de caótico, mejorando notablemente las queries de rango. Cambio mínimo en el SQL, beneficio real.

**AIO — Async I/O**
PostgreSQL 18 incluye un subsistema de I/O asíncrono que mejora el rendimiento de sequential scans, bitmap heap scans y vacuums automáticamente. No requiere configuración de nuestra parte, es una mejora gratuita.

**`RETURNING` con OLD y NEW**
PostgreSQL 18 soporta OLD y NEW en cláusulas RETURNING para INSERT, UPDATE, DELETE y MERGE. Elimina la necesidad de queries de seguimiento y reduce round trips. Útil en `PUT /profile` si en el futuro necesitamos devolver valores anteriores y nuevos en una sola operación.

---

## Decisiones de Diseño

### Idioma
No se maneja en el backend. La AI del usuario responde en el idioma que el usuario use. El backend solo devuelve datos técnicos: fechas, números, UUIDs. La AI traduce todo lo que el usuario ve.

### Timezone
Todas las fechas se almacenan en UTC siempre. No se guarda timezone del usuario. La responsabilidad de convertir "hoy" o "esta semana" al rango UTC correcto es de la AI, que conoce el contexto del usuario. Esto está especificado en la descripción del tool `get_meals`.

Ventaja: si el usuario viaja, sus registros históricos no se alteran. Un momento en el tiempo es un momento en el tiempo.

### Límite de registros
`@fastify/rate-limit` aplicado únicamente al endpoint `POST /auth/register` para evitar creación masiva de cuentas automatizadas. El resto de endpoints no lo necesitan porque ya están protegidos por API key.

```typescript
// Solo en /auth/register
rateLimit: {
  max: 5,
  timeWindow: '1 hour'
}
```

---

### Límite de consultas
`get_meals` acepta máximo 90 días por consulta y devuelve máximo 200 comidas. Esto mantiene los responses pequeños y compatibles con modelos gratuitos. Si se necesita más rango, se hacen dos consultas.

---

## Arquitectura

```
[Usuario habla con AI en su idioma]
       ↓
[AI Vision — lado del usuario]
       ↓  estima calorías y descripción
[MCP Server]  ←── tools: register, log_meal, get_meals, update_profile
       ↓  queries directas, todo UTC
[PostgreSQL — cluster k3s existente]
```

El MCP Server y la API REST son el mismo proceso Node. Se despliegan juntos en k3s vía ArgoCD. Cloudflare Tunnel expone el servicio.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| API + MCP Server | Node.js + TypeScript |
| Framework HTTP | Fastify |
| Driver PostgreSQL | `postgres` (npm) |
| Autenticación | API Keys propias |
| Deploy | k3s + ArgoCD |
| Exposición | Cloudflare Tunnel |

Sin ORM. Queries SQL directas.

---

## Modelo de Datos

Dos tablas. Nada más.

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuidv7(),
  email             TEXT UNIQUE NOT NULL,
  api_key           TEXT UNIQUE NOT NULL,
  -- perfil opcional
  weight_kg         NUMERIC(5,2),
  height_cm         NUMERIC(5,2),
  date_of_birth     DATE,
  biological_sex    TEXT CHECK (biological_sex IN ('male', 'female')),
  activity_level    TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  created_at        TIMESTAMPTZ DEFAULT NOW()  -- UTC
);

CREATE TABLE meals (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  user_id     UUID NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  calories    INTEGER NOT NULL,
  protein_g   NUMERIC(5,1),
  carbs_g     NUMERIC(5,1),
  fat_g       NUMERIC(5,1),
  eaten_at    TIMESTAMPTZ DEFAULT NOW(),  -- UTC siempre
  created_at  TIMESTAMPTZ DEFAULT NOW()   -- UTC siempre
);
```

La edad se calcula siempre en el momento con `EXTRACT(YEAR FROM AGE(date_of_birth))`. Nunca se guarda estática.

---

## Fórmula Mifflin-St Jeor

El backend calcula BMR y TDEE antes de devolver cualquier respuesta con historial. La AI recibe los números ya resueltos, no hace matemáticas.

```typescript
function calculateBMR(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: 'male' | 'female'
): number {
  const base = (10 * weightKg) + (6.25 * heightCm) - (5 * ageYears);
  return sex === 'male' ? base + 5 : base - 161;
}

const ACTIVITY_MULTIPLIERS = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9
};

function calculateTDEE(bmr: number, activityLevel: string): number {
  return bmr * ACTIVITY_MULTIPLIERS[activityLevel];
}
```

---

## Queries

Son exactamente 4:

```sql
-- Registrar usuario nuevo
INSERT INTO users (email, api_key)
VALUES ($1, $2)
RETURNING id, email, api_key;

-- Autenticar usuario por API key
SELECT id FROM users WHERE api_key = $1;

-- Guardar comida
INSERT INTO meals (user_id, description, calories, protein_g, carbs_g, fat_g)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- Consultar rango arbitrario (máximo 90 días, máximo 200 comidas)
SELECT * FROM meals
WHERE user_id = $1
AND eaten_at >= $2
AND eaten_at < $3
ORDER BY eaten_at ASC
LIMIT 200;

-- Obtener perfil completo con edad calculada
SELECT *,
  EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age
FROM users
WHERE id = $1;
```

---

## API REST

### Autenticación

Todas las rutas excepto `/auth/register` requieren:

```
Authorization: Bearer cal_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Endpoints

#### `GET /health`
Para k8s. Devuelve `200` cuando el pod está listo para recibir tráfico.

```json
{ "status": "ok" }
```

---

#### `POST /auth/register`

```json
// Request
{ "email": "usuario@ejemplo.com" }

// Response 201
{
  "api_key": "cal_a1b2c3d4...",
  "message": "Guarda esta key, no se puede recuperar"
}
```

---

#### `PUT /profile`
Todos los campos opcionales, solo actualiza los que se manden.

```json
// Request
{
  "weight_kg": 82.5,
  "height_cm": 175,
  "date_of_birth": "1990-06-15",
  "biological_sex": "male",
  "activity_level": "moderate"
}

// Response 200
{
  "weight_kg": 82.5,
  "height_cm": 175,
  "date_of_birth": "1990-06-15",
  "biological_sex": "male",
  "activity_level": "moderate",
  "bmr": 1820,
  "tdee": 2821
}
```

---

#### `POST /meals`

```json
// Request
{
  "description": "Tacos de birria x3 con consomé",
  "calories": 720,
  "protein_g": 38,
  "carbs_g": 65,
  "fat_g": 28
}

// Response 201
{ "id": "uuid", "description": "...", "calories": 720, "eaten_at": "2025-03-01T14:30:00Z" }
```

---

#### `GET /meals?from=2025-02-01T00:00:00Z&to=2025-03-01T00:00:00Z`

Ambos parámetros en UTC, requeridos. `from` inclusivo, `to` exclusivo. Máximo 90 días de rango. Máximo 200 comidas en respuesta.

```json
{
  "from": "2025-02-01T00:00:00Z",
  "to": "2025-03-01T00:00:00Z",
  "meals": [ ... ],
  "summary": {
    "total_meals": 87,
    "avg_daily_calories": 1820
  },
  "profile_context": {
    "bmr": 1820,
    "tdee": 2821,
    "avg_daily_deficit": 1001
  }
}
```

`profile_context` solo aparece si el perfil está completo. Si falta algún campo se omite sin error.

---

## MCP Server

### Autenticación en el MCP

El tool `register` es el único público, no requiere API key. Todos los demás requieren la API key en el header.

```json
{
  "mcpServers": {
    "caltrack": {
      "url": "https://caltrack.tudominio.com/mcp",
      "headers": {
        "Authorization": "Bearer cal_xxxxxxxx"
      }
    }
  }
}
```

### Tools

#### `register` ⟵ único tool público

```
Registra un nuevo usuario en CalTrack. Pide el email al usuario
y devuelve una API key que el usuario debe guardar en un lugar seguro.
```

```typescript
{ email: string }
```

Flujo típico:
```
Usuario: "Registrame en CalTrack"
AI: "¿Cuál es tu email?"
Usuario: "juan@gmail.com"
AI: [llama register(email: "juan@gmail.com")]
AI: "Listo, ya estás registrado. Tu API key es cal_xxxx,
     guárdala. ¿Quieres completar tu perfil para tener
     recomendaciones personalizadas?"
```

---

#### `log_meal`

```
Guarda una comida con su estimación de calorías y macros.
Estima los valores a partir de la descripción o foto del plato.
Los macros son opcionales, guarda aunque no estén disponibles.
```

```typescript
{
  description: string,
  calories: number,
  protein_g?: number,
  carbs_g?: number,
  fat_g?: number
}
```

---

#### `get_meals`

```
Consulta comidas en un rango de fechas UTC.
Máximo 90 días por consulta, máximo 200 comidas en respuesta.

IMPORTANTE: Todas las fechas están en UTC. Si el usuario pregunta
por "hoy", "esta semana" u otros rangos relativos, convierte primero
a UTC usando el timezone del contexto del usuario antes de llamar
este tool. Por ejemplo si el usuario está en UTC-6 y pregunta por
"hoy", from debe ser hoy a las 06:00:00Z y to mañana a las 06:00:00Z.

Si el perfil del usuario está completo, la respuesta incluye contexto
nutricional con BMR, TDEE y déficit/superávit promedio del período.

Glosario de campos en la respuesta:
- bmr: calorías que el cuerpo quema en reposo total (Basal Metabolic Rate)
- tdee: calorías totales que el cuerpo quema con actividad diaria (Total Daily Energy Expenditure)
- avg_daily_deficit: promedio diario de calorías por debajo del TDEE (negativo significa superávit)
- profile_context: solo aparece si el perfil del usuario está completo
- protein_g: proteína en gramos
- carbs_g: carbohidratos en gramos
- fat_g: grasa en gramos

Las estimaciones son aproximadas. Recuerda al usuario consultar
a su médico o nutriólogo para un plan personalizado.
```

```typescript
{
  from: string,  // ISO 8601 UTC: "2025-02-01T00:00:00Z"
  to: string     // ISO 8601 UTC: "2025-03-01T00:00:00Z"
}
```

---

#### `update_profile`

```
Actualiza el perfil del usuario. Todos los campos son opcionales.
Puede llamarse en cualquier momento, incluso en partes.
Si el perfil está completo, las consultas de historial incluirán
recomendaciones calóricas personalizadas con la fórmula Mifflin-St Jeor.
```

```typescript
{
  weight_kg?: number,
  height_cm?: number,
  date_of_birth?: string,        // "1990-06-15"
  biological_sex?: 'male' | 'female',
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
}
```

---

## Estructura del Proyecto

```
caltrack/
├── src/
│   ├── db/
│   │   ├── client.ts       # conexión postgres
│   │   └── queries.ts      # las 4 queries
│   ├── api/
│   │   ├── auth.ts         # POST /auth/register
│   │   ├── profile.ts      # PUT /profile
│   │   └── meals.ts        # POST /meals, GET /meals
│   ├── mcp/
│   │   └── server.ts       # tools: register, log_meal, get_meals, update_profile
│   ├── middleware/
│   │   └── auth.ts         # valida API key, inyecta user_id
│   ├── lib/
│   │   └── nutrition.ts    # Mifflin-St Jeor, TDEE, helpers
│   └── index.ts            # arranca Fastify
├── static/
│   ├── index.html          # página de presentación del proyecto
│   ├── llms.txt            # descubrimiento para AIs
│   ├── robots.txt          # instrucciones para buscadores
│   └── sitemap.xml         # URLs públicas para Google
├── migrations/
│   └── 001_init.sql
├── k8s/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── secret.yaml
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md                # cómo levantar local, configurar MCP y primer registro
```

---

## Fases de Desarrollo

### Fase 1 — Todo el backend (2-3 días)
- Setup Fastify + TypeScript
- `postgres` driver + migration SQL
- `nutrition.ts` con Mifflin-St Jeor y TDEE
- API REST completa con health check
- Archivos estáticos: `index.html`, `llms.txt`, `robots.txt`, `sitemap.xml`
- `@fastify/rate-limit` en endpoint de registro
- `@fastify/swagger` para OpenAPI automático en `/docs`
- `llms.txt` estático en la raíz
- MCP server con los 4 tools, sus descripciones y aviso de servidor casero
- `.env.example` documentado
- README con instrucciones de uso
- Pruebas manuales con Claude Desktop y Claude.ai web
- Docker + docker-compose

### Fase 2 — Deploy (medio día)
- Manifests k8s
- ArgoCD Application
- Verificar Cloudflare Tunnel

---

## Lo que no está y no hace falta ahora

- Regenerar API key
- Dashboard web
- Objetivos de peso (perder/ganar/mantener)

Se agrega cuando alguien lo pida.
