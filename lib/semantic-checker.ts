/**
 * TWK Semantic Checker
 * Análise via LLM (Claude) de coerência semântica entre campos.
 * Detecta o que regras determinísticas não conseguem:
 * - descrição não bate com tipo de cuisine
 * - endereço parece residencial em vez de comercial
 * - nome em idioma estranho ao país
 * - dados mutuamente inconsistentes
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface SemanticIssue {
  row_id:   unknown;
  fields:   string[];
  severity: 'critical' | 'warning' | 'info';
  category: 'incoherent' | 'suspicious' | 'language' | 'category' | 'other';
  finding:  string;
  evidence: string;
  suggested_action?: string;
}

export interface SemanticAuditResult {
  analyzed:   number;
  issues:     SemanticIssue[];
  summary:    string;
}

/**
 * Analisa um lote de registros (max 10) e retorna issues semânticas.
 * Usa Claude Haiku para custo baixo, máximo paralelismo.
 */
export async function analyzeSemanticConsistency(
  records: Array<Record<string, unknown>>,
  options: { tableName: string; focus?: string[] } = { tableName: 'records' }
): Promise<SemanticAuditResult> {
  if (!records.length) {
    return { analyzed: 0, issues: [], summary: 'Nenhum registro fornecido' };
  }

  // Limita campos enviados para reduzir tokens
  const focus = options.focus ?? ['restaurant_id','name','city','country','address_of_establishment',
    'establishment_type','restaurant_category','about_text','site_url','email_for_reservations',
    'telephone_of_the_establishment','price_range_id'];

  const condensed = records.slice(0, 20).map((r) => {
    const out: Record<string, unknown> = {};
    for (const f of focus) if (f in r) out[f] = r[f];
    return out;
  });

  const prompt = `Você é um auditor de qualidade de dados especializado em restaurantes premium.

Analise os ${condensed.length} registros abaixo da tabela ${options.tableName} e detecte INCONSISTÊNCIAS SEMÂNTICAS — problemas que regras de validação determinísticas não capturam:

1. Descrição/nome não bate com tipo de cuisine declarado
2. Endereço parece residencial (sem número, em rua pequena) em vez de comercial
3. Nome em idioma estranho ao país (ex: nome português num restaurante em Tokyo)
4. Categoria/establishment_type incoerente com o nome/descrição
5. Dados internamente contraditórios
6. about_text com baixa qualidade, spam, ou conteúdo placeholder
7. Email parecendo pessoal/gmail num restaurante premium (warning, não crítico)
8. Site_url apontando para domínio genérico (instagram.com, facebook.com) em vez de site próprio

Para cada problema encontrado, retorne JSON com este formato (sem markdown, apenas o JSON):

{
  "issues": [
    {
      "row_id": "<id do registro>",
      "fields": ["<campos envolvidos>"],
      "severity": "critical" | "warning" | "info",
      "category": "incoherent" | "suspicious" | "language" | "category" | "other",
      "finding": "Breve descrição do problema",
      "evidence": "Trecho específico que prova o problema",
      "suggested_action": "O que fazer (opcional)"
    }
  ],
  "summary": "Resumo geral em 1-2 frases"
}

REGISTROS:
${JSON.stringify(condensed, null, 2)}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content[0] as { text: string }).text;
    // Extrai JSON mesmo se vier com markdown
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;
    const parsed = JSON.parse(jsonStr.trim()) as { issues: SemanticIssue[]; summary: string };

    return {
      analyzed: condensed.length,
      issues: parsed.issues ?? [],
      summary: parsed.summary ?? 'Análise concluída',
    };
  } catch (err) {
    return {
      analyzed: condensed.length,
      issues: [],
      summary: `Erro na análise semântica: ${(err as Error).message}`,
    };
  }
}

/**
 * Analisa registros em lotes paralelos. Use para auditar tabela inteira.
 */
export async function batchSemanticAnalysis(
  rows: Array<Record<string, unknown>>,
  options: { tableName: string; batchSize?: number; concurrency?: number; focus?: string[] }
): Promise<SemanticAuditResult> {
  const batchSize = options.batchSize ?? 10;
  const concurrency = options.concurrency ?? 3;

  const batches: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));

  const allIssues: SemanticIssue[] = [];
  let totalAnalyzed = 0;
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map((b) => analyzeSemanticConsistency(b, options))
    );
    results.forEach((r) => {
      allIssues.push(...r.issues);
      totalAnalyzed += r.analyzed;
    });
  }

  return {
    analyzed: totalAnalyzed,
    issues: allIssues,
    summary: `Analisados ${totalAnalyzed} registros — ${allIssues.length} issues semânticas encontradas`,
  };
}
