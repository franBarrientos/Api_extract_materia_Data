import OpenAI from "openai";
import pdf from "pdf-parse";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const GOOGLE_SHEETS_WEBHOOK_URL =
  process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
  "https://script.google.com/macros/s/AKfycbwk3Cf-kgsioXdcWtewHMNxB4cJj_rkCTFZK4nuEFBF4QOgf_o-Eqm8l3VarVF5rlzi/exec";

const SYSTEM_PROMPT = `
Sos un extractor académico. Recibís el texto de un programa/planificación de una materia universitaria.

Debés devolver SOLO JSON válido con esta estructura exacta:
{
  "materia": string|null,
  "anio": number|null,
  "mes_inicio": number|null,
  "mes_fin": number|null,
  "dias_cursado": string|null,
  "carga_horaria_total": number|null,
  "carga_horaria_semanal": number|null,
  "porc_regulariza": number|null,
  "porc_promociona": number|null,
  "cantidad_parciales": number|null,
  "requiere_trabajo_final": "si"|"no"|null,
  "nota_min_regular_parciales": number|null,
  "nota_min_regular_trabajo": number|null,
  "nota_min_promo_parciales": number|null,
  "nota_min_promo_trabajo": number|null,
  "usar_feriados": "si"|"no"|null,
  "clases_suspendidas_extra": number|null,
  "datos_faltantes": string[]
}

Reglas:
- anio debe ser siempre 2026.
- "dias_cursado" debe quedar como string con números de día de semana separados por coma:
  0=domingo, 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado.
- Si detectás texto tipo "lunes y miércoles", devolvé "1,3".
- Buscá activamente los días de cursado en el texto. Si aparecen expresiones como "lunes", "martes", "miércoles", "jueves", "viernes" o combinaciones, convertí eso a números separados por coma.
- Buscá activamente si la materia corresponde a "primer cuatrimestre", "1er cuatrimestre", "primer semestre", "segundo cuatrimestre", "2do cuatrimestre" o equivalentes.
- Si detectás primer cuatrimestre o equivalente, mes_inicio=3 y mes_fin=6.
- Si detectás segundo cuatrimestre o equivalente, mes_inicio=8 y mes_fin=11.
- Si el texto menciona meses concretos de inicio/fin, priorizá esos meses explícitos sobre la inferencia por cuatrimestre.
- Si no encontrás días de cursado con suficiente evidencia, usá "1,3".
- Si detectás valores de asistencia por porcentaje, usalos.
- Si no encontrás porcentajes, dejalos en null.
- Si el texto dice que hay que "aprobar" parciales teóricos-prácticos, parciales o sus recuperatorios para regularizar, pero no especifica una nota mínima numérica, asumí nota_min_regular_parciales=6.
- usar_feriados debe ser siempre "si".
- clases_suspendidas_extra debe ser 0 salvo que aparezca explícitamente otro número.
- datos_faltantes debe listar solo los campos que no pudieron extraerse con confianza.
- Respondé SOLO JSON, sin markdown.
`.trim();

function buildUserPrompt(text) {
  return `
Extraé los campos académicos del siguiente texto.

TEXTO DEL PDF:
${text}
`.trim();
}

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(body));
}

function inferQuarterMonths(text) {
  const normalizedText = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    /\b(1er|primer|primero)\s+cuatrimestre\b/.test(normalizedText) ||
    /\bprimer\s+semestre\b/.test(normalizedText)
  ) {
    return { mes_inicio: 3, mes_fin: 6 };
  }

  if (
    /\b(2do|segundo)\s+cuatrimestre\b/.test(normalizedText) ||
    /\bsegundo\s+semestre\b/.test(normalizedText)
  ) {
    return { mes_inicio: 8, mes_fin: 11 };
  }

  return null;
}

function inferRegularParcialMinimum(text) {
  const normalizedText = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const mentionsAprobarParciales =
    /aprobar\s+.*parcial/.test(normalizedText) ||
    /aprobar\s+dos\s+parciales/.test(normalizedText) ||
    /parciales?.*recuperatorios?/.test(normalizedText) ||
    /recuperatorios?.*parciales?/.test(normalizedText);

  const hasExplicitNumericRule =
    /nota\s+minima/.test(normalizedText) ||
    /calificacion\s+minima/.test(normalizedText) ||
    /\b[45678910]+\b\s*\(?\s*(seis|siete|ocho|nueve|diez)?\s*\)?/.test(normalizedText);

  if (mentionsAprobarParciales && !hasExplicitNumericRule) {
    return 6;
  }

  return null;
}

function normalizeExtractedData(extracted, sourceText) {
  const normalized = {
    ...extracted,
    anio: 2026,
    dias_cursado:
      typeof extracted?.dias_cursado === "string" && extracted.dias_cursado.trim() !== ""
        ? extracted.dias_cursado
        : "1,3",
    usar_feriados: "si",
    clases_suspendidas_extra:
      extracted?.clases_suspendidas_extra == null ? 0 : extracted.clases_suspendidas_extra,
  };

  const missing = new Set(Array.isArray(extracted?.datos_faltantes) ? extracted.datos_faltantes : []);
  missing.delete("anio");
  missing.delete("dias_cursado");
  missing.delete("usar_feriados");
  missing.delete("clases_suspendidas_extra");

  if (normalized.mes_inicio == null || normalized.mes_fin == null) {
    const inferredMonths = inferQuarterMonths(sourceText);
    if (inferredMonths) {
      if (normalized.mes_inicio == null) normalized.mes_inicio = inferredMonths.mes_inicio;
      if (normalized.mes_fin == null) normalized.mes_fin = inferredMonths.mes_fin;
    }
  }

  if (normalized.mes_inicio != null && normalized.mes_fin != null) {
    missing.delete("mes_inicio");
    missing.delete("mes_fin");
  }

  if (normalized.nota_min_regular_parciales == null) {
    const inferredMinimum = inferRegularParcialMinimum(sourceText);
    if (inferredMinimum != null) {
      normalized.nota_min_regular_parciales = inferredMinimum;
      missing.delete("nota_min_regular_parciales");
    }
  }

  return {
    ...normalized,
    datos_faltantes: Array.from(missing),
  };
}

async function syncWithGoogleSheets(pdfUrl, extracted, materiaName) {
  const payload = {
    accion: "guardar_planificacion_extraida",
    programa_pdf_url: pdfUrl,
    ...extracted,
    materia: materiaName || extracted.materia,
  };

  const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = { raw: rawText };
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
    payload,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const { pdf_url: pdfUrl, materia_name: materiaName } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return json(res, 500, {
        ok: false,
        error: "Falta configurar OPENAI_API_KEY en Vercel.",
      });
    }

    if (!pdfUrl) {
      return json(res, 400, {
        ok: false,
        error: "Falta pdf_url.",
      });
    }

    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      return json(res, 400, {
        ok: false,
        error: "No pude descargar el PDF desde la URL indicada.",
      });
    }

    const arrayBuffer = await pdfResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsed = await pdf(buffer);
    const text = (parsed.text || "").trim();

    if (!text) {
      return json(res, 400, {
        ok: false,
        error: "No pude extraer texto del PDF.",
      });
    }

    const response = await client.responses.create({
      model: "gpt-4.1",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(text.slice(0, 120000)) },
      ],
    });

    const outputText = response.output_text?.trim();
    if (!outputText) {
      return json(res, 500, {
        ok: false,
        error: "OpenAI devolvió una respuesta vacía.",
      });
    }

    let extracted;
    try {
      extracted = JSON.parse(outputText);
    } catch {
      return json(res, 500, {
        ok: false,
        error: "OpenAI no devolvió JSON válido.",
        raw: outputText,
      });
    }

    extracted = normalizeExtractedData(extracted, text);

    let googleSheetsSync = null;
    try {
      googleSheetsSync = await syncWithGoogleSheets(pdfUrl, extracted, materiaName);
    } catch (error) {
      googleSheetsSync = {
        ok: false,
        status: 500,
        data: {
          ok: false,
          error: error.message || "No se pudo sincronizar con Google Sheets.",
        },
      };
    }

    return json(res, 200, {
      ok: true,
      pdf_url: pdfUrl,
      materia_name: materiaName || null,
      extracted,
      google_sheets_sync: googleSheetsSync,
      debug: {
        extracted_text_chars: text.length,
        extracted_text_preview: text.slice(0, 1000),
      },
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error.message || "Error inesperado.",
    });
  }
}
