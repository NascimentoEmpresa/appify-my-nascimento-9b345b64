// Arquivo: supabase/functions/_shared/chamado-parecer-ia.ts
//
// Regras do parecer da I.A sobre um Chamado de Sistemas (mig 20261029000900):
// prompt, leitura da resposta e a CONTA do preço. Fica fora do index.ts pelo
// mesmo motivo do _shared/novidade-ia.ts: é lógica pura, testada pelo Vitest
// (src/test/chamado-parecer-ia.test.ts) sem precisar de Deno nem de rede.
//
// A I.A estima HORAS e escolhe o VALOR/HORA dentro de uma faixa de mercado;
// a multiplicação e a média são feitas AQUI. Modelo de linguagem erra conta
// com frequência, e um preço que não bate com "horas × valor/hora" escrito
// do lado desmoraliza o parecer inteiro.

export interface ChamadoParaParecer {
  id: string;
  numero: string | null;
  assunto: string;
  tipo_solicitacao: string | null;
  descricao: string | null;
  categorias: string[] | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  ambiente: string | null;
  impacto_trabalho: string | null;
  urgencia: string | null;
  afeta_usuarios: number | null;
  observacoes_solicitante: string | null;
  definicao?: string | null;
}

/** Os três perfis de fornecedor, sempre nesta ordem. Faixas de valor/hora
 *  de referência (Brasil, 2026) — a I.A escolhe dentro delas e explica. */
export const PERFIS = [
  { perfil: "freelancer", rotulo: "Freelancer (PJ)", min: 60, max: 150 },
  { perfil: "software_house", rotulo: "Software house / consultoria", min: 120, max: 300 },
  { perfil: "interno", rotulo: "Equipe interna (CLT, custo empresa)", min: 50, max: 120 },
] as const;

export type PerfilCodigo = typeof PERFIS[number]["perfil"];

export const NIVEIS_COMPLEXIDADE: Record<number, string> = {
  1: "Muito baixa",
  2: "Baixa",
  3: "Média",
  4: "Alta",
  5: "Muito alta",
};

export interface PrecoParecer {
  perfil: PerfilCodigo;
  rotulo: string;
  valor_hora: number;
  horas: number;
  valor: number;
  embasamento: string;
  explicacao: string;
}

export interface Parecer {
  precos: PrecoParecer[];
  valor_medio: number;
  horas_estimadas: number;
  complexidade_nivel: number;
  complexidade_rotulo: string;
  complexidade_justificativa: string;
  premissas: string | null;
}

export const SYSTEM_PROMPT = `Você é um consultor sênior de orçamento de software no Brasil.
Recebe um chamado de desenvolvimento do ERP interno do Grupo Nascimento (empresa de terceirização de serviços) e dá um parecer de PREÇO e de COMPLEXIDADE.

Contexto técnico do ERP (para estimar horas): React 18 + Vite + TypeScript + shadcn/ui no front; Supabase/PostgreSQL com RLS, funções SQL e Edge Functions (Deno) no back; integrações com WhatsApp, Senior (RH), GitHub. Sistema maduro, com centenas de telas e padrões já prontos — telas parecidas com as existentes saem mais rápido que um projeto do zero.

Estime as HORAS de desenvolvimento para cada perfil de fornecedor, incluindo entendimento, implementação, testes e publicação. Fornecedor externo precisa de mais horas que a equipe interna (curva de aprendizado do sistema, reuniões, gestão de projeto).

Perfis (use EXATAMENTE estes códigos e escolha o valor/hora DENTRO da faixa):
- "freelancer": desenvolvedor freelancer pleno/sênior PJ — R$ 60 a R$ 150 por hora;
- "software_house": software house ou consultoria — R$ 120 a R$ 300 por hora;
- "interno": desenvolvedor interno CLT, custo-hora empresa com encargos — R$ 50 a R$ 120 por hora.

Complexidade de 1 a 5: 1 = muito baixa (texto, rótulo, ajuste trivial), 2 = baixa (ajuste numa tela, filtro simples), 3 = média (tela ou regra nova, mexe no banco), 4 = alta (vários módulos, regras de acesso, integração), 5 = muito alta (integração externa complexa, migração de dados, módulo inteiro).

Se o chamado for dúvida/orientação ou vago, estime mesmo assim o esforço provável e diga nas premissas o que faltou.

Responda SÓ com JSON, sem texto fora dele, neste formato:
{
  "precos": [
    { "perfil": "freelancer", "valor_hora": 100, "horas": 12, "embasamento": "faixa de mercado usada e por que esse valor", "explicacao": "uma frase sobre o que esse fornecedor entrega e por que custa isso" },
    { "perfil": "software_house", "valor_hora": 180, "horas": 16, "embasamento": "...", "explicacao": "..." },
    { "perfil": "interno", "valor_hora": 80, "horas": 10, "embasamento": "...", "explicacao": "..." }
  ],
  "complexidade_nivel": 3,
  "complexidade_justificativa": "2 a 4 frases: o que pesa (banco, telas, regras, integrações, risco)",
  "premissas": "1 a 3 frases: o que foi assumido e o que poderia mudar a estimativa"
}
Português do Brasil, frases curtas, sem markdown. Não invente funcionalidade que o chamado não pede.`;

const corta = (s: string | null | undefined, max: number) => {
  const t = String(s ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

export function montarPrompt(c: ChamadoParaParecer): string {
  const linhas = [
    `Chamado ${c.numero ?? ""}`.trim(),
    `Assunto: ${corta(c.assunto, 300)}`,
    `Tipo: ${c.tipo_solicitacao ?? "—"}`,
    `Categorias: ${(c.categorias ?? []).join(", ") || "—"}`,
    `Módulo: ${c.modulo_sistema === "outro" ? (c.modulo_sistema_outro || "outro") : (c.modulo_sistema ?? "—")}`,
    `Ambiente: ${c.ambiente ?? "—"}`,
    `Impacto no trabalho: ${c.impacto_trabalho ?? "—"}`,
    `Urgência: ${c.urgencia ?? "—"}`,
    `Usuários afetados: ${c.afeta_usuarios ?? "—"}`,
  ];
  if (c.definicao) linhas.push(`Definição da gestão: ${c.definicao}`);
  linhas.push("", "Descrição:", corta(c.descricao, 6000) || "(sem descrição)");
  if (c.observacoes_solicitante?.trim()) linhas.push("", "Observações do solicitante:", corta(c.observacoes_solicitante, 1500));
  return linhas.join("\n");
}

/** Tira o JSON da resposta mesmo com cerca ``` ou texto em volta. */
export function extrairJson(bruto: string): unknown | null {
  const t = String(bruto ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* segue */ }
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const limita = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const arred = (n: number, casas = 0) => Math.round(n * 10 ** casas) / 10 ** casas;

/**
 * Valida a resposta da I.A e faz a conta. Devolve o erro em texto (que vai
 * para a tela) quando a resposta não serve — nunca um parecer pela metade.
 */
export function validarParecer(bruto: unknown): { ok: true; parecer: Parecer } | { ok: false; erro: string } {
  if (!bruto || typeof bruto !== "object") return { ok: false, erro: "A I.A não devolveu um JSON válido." };
  const b = bruto as Record<string, unknown>;
  const lista = Array.isArray(b.precos) ? b.precos as Record<string, unknown>[] : [];

  const precos: PrecoParecer[] = [];
  for (const ref of PERFIS) {
    const item = lista.find((p) => p && String(p.perfil ?? "").trim() === ref.perfil);
    if (!item) return { ok: false, erro: `A I.A não estimou o perfil "${ref.rotulo}".` };
    const horasBrutas = num(item.horas);
    const vhBruto = num(item.valor_hora);
    if (!(horasBrutas > 0) || !(vhBruto > 0)) {
      return { ok: false, erro: `Horas ou valor/hora inválidos para "${ref.rotulo}".` };
    }
    const horas = arred(limita(horasBrutas, 0.5, 2000), 1);
    // Fora da faixa de referência, puxa para dentro: o embasamento escrito
    // cita a faixa, e um valor fora dela contradiz o próprio texto.
    const valor_hora = arred(limita(vhBruto, ref.min, ref.max));
    precos.push({
      perfil: ref.perfil,
      rotulo: ref.rotulo,
      valor_hora,
      horas,
      valor: arred(horas * valor_hora, 2),
      embasamento: corta(String(item.embasamento ?? ""), 500) || `Faixa de R$ ${ref.min} a R$ ${ref.max}/h.`,
      explicacao: corta(String(item.explicacao ?? ""), 400),
    });
  }

  const nivel = Math.round(num(b.complexidade_nivel));
  if (!(nivel >= 1 && nivel <= 5)) return { ok: false, erro: "A I.A não deu um nível de complexidade de 1 a 5." };
  const justificativa = corta(String(b.complexidade_justificativa ?? ""), 1200);
  if (!justificativa) return { ok: false, erro: "A I.A não justificou a complexidade." };

  const valor_medio = arred(precos.reduce((s, p) => s + p.valor, 0) / precos.length, 2);
  const horas_estimadas = arred(precos.reduce((s, p) => s + p.horas, 0) / precos.length, 1);
  const premissas = corta(String(b.premissas ?? ""), 800) || null;

  return {
    ok: true,
    parecer: {
      precos,
      valor_medio,
      horas_estimadas,
      complexidade_nivel: nivel,
      complexidade_rotulo: NIVEIS_COMPLEXIDADE[nivel],
      complexidade_justificativa: justificativa,
      premissas,
    },
  };
}
