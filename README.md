# Mi Turno Extractor

Backend serverless para Vercel que:

1. recibe una `pdf_url` desde Typebot
2. descarga el PDF
3. extrae su texto
4. llama a OpenAI
5. intenta sincronizar los datos con Google Sheets
6. devuelve un JSON estructurado con los datos de planificación

## Requisitos

- Node 20+
- cuenta de Vercel
- `OPENAI_API_KEY`

## Instalar

```bash
npm install
```

## Variables de entorno

En Vercel configurá:

```bash
OPENAI_API_KEY=tu_api_key
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/...
```

## Desarrollo local

```bash
npm run dev
```

## Deploy

```bash
vercel
```

Después del primer deploy, el endpoint queda así:

```text
POST /api/extraer-planificacion
```

## Body esperado

```json
{
  "pdf_url": "https://s3.typebotstorage.com/public/tmp/typebots/.../archivo.pdf",
  "materia_name": "Inteligencia Artificial"
}
```

## Respuesta

```json
{
  "ok": true,
  "pdf_url": "https://...",
  "materia_name": "Inteligencia Artificial",
  "extracted": {
    "materia": "Inteligencia Artificial",
    "anio": 2026,
    "mes_inicio": 3,
    "mes_fin": 6,
    "dias_cursado": "1,3",
    "carga_horaria_total": 96,
    "carga_horaria_semanal": 6,
    "porc_regulariza": 75,
    "porc_promociona": 75,
    "cantidad_parciales": 2,
    "requiere_trabajo_final": "si",
    "nota_min_regular_parciales": 6,
    "nota_min_regular_trabajo": 6,
    "nota_min_promo_parciales": 7,
    "nota_min_promo_trabajo": 7,
    "usar_feriados": null,
    "clases_suspendidas_extra": null,
    "datos_faltantes": []
  },
  "google_sheets_sync": {
    "ok": true,
    "status": 200,
    "data": {
      "ok": true
    }
  }
}
```

## Apps Script

El endpoint intenta hacer un `POST` al webhook de Apps Script con esta acción:

```json
{
  "accion": "guardar_planificacion_extraida"
}
```

Tu Apps Script tiene que soportar esa acción para:

- crear o buscar la materia
- guardar `programa_pdf_url`
- guardar los campos extraídos

Si esa acción todavía no existe, el endpoint igual devuelve `extracted`, pero `google_sheets_sync` va a mostrar el error del Apps Script.

## Cómo conectarlo a Typebot

En el bloque `HTTP Request`:

- Method: `POST`
- URL: `https://tu-proyecto.vercel.app/api/extraer-planificacion`
- Headers:

```json
{
  "Content-Type": "application/json"
}
```

- Body:

```json
{
  "pdf_url": "{{programa_pdf_url}}",
  "materia_name": "{{materia}}"
}
```

Guardá variables como:

- `data.extracted.materia`
- `data.extracted.anio`
- `data.extracted.mes_inicio`
- `data.extracted.mes_fin`
- `data.extracted.dias_cursado`
- `data.extracted.carga_horaria_total`
- `data.extracted.carga_horaria_semanal`

## Recomendación de flujo

No guardes directo en Google Sheets al extraer.

Mejor:

1. Typebot sube PDF
2. Typebot llama a este endpoint
3. Typebot muestra los datos detectados
4. el estudiante confirma/corrige
5. recién ahí mandás todo a Apps Script para persistir

## Subir a GitHub

Como acá no tenés `gh` instalado, podés hacerlo así:

```bash
cd /Users/fran/miturno-extractor
git init
git add .
git commit -m "feat: add vercel extractor for academic PDF planning"
git branch -M main
git remote add origin <tu_repo_git>
git push -u origin main
```
