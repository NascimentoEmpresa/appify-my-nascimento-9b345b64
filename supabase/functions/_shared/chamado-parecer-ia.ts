// Arquivo: supabase/functions/_shared/chamado-parecer-ia.ts
//
// Regras do parecer da I.A sobre um Chamado de Sistemas (mig 20261029000900):
// prompt, leitura da resposta e a CONTA do preço. Fica fora do index.ts pelo
// mesmo motivo do _shared/novidade-ia.ts: é lógica pura, testada pelo Vitest
// (src/test/chamado-parecer-ia.test.ts) sem precisar de Deno nem de rede.
//
// A I.A estima só HORAS e COMPLEXIDADE; o VALOR/HORA é a tabela fixa
// VALOR_HORA_SENIOR abaixo, e a multiplicação e a média são feitas AQUI.
// Modelo de linguagem erra conta com frequência, e um preço que não bate com
// "horas × valor/hora" escrito do lado desmoraliza o parecer inteiro.
//
// Números FIXOS (29/10/2026, Pablo): "toda vez que clica em gerar de novo
// altera os valores, perdendo a credibilidade, e os valores estão baixos,
// aumenta, somos desenvolvedores seniors. Mantém os valores fixos gerados, só
// explica os valores e já era." Por isso: valor/hora deixou de vir da I.A
// (cada geração escolhia um ponto diferente da faixa), temperatura 0, o botão
// "Gerar de novo" saiu e parecer pronto não é refeito (ver a Edge).

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
  status?: string | null;
  created_at?: string | null;
  concluido_em?: string | null;
}

// ── A ENTREGA REAL (29/10/2026) ─────────────────────────────────────────
// A primeira versão só lia o TEXTO DE ABERTURA. O SIS-2026-0276 ("Pablo:
// esse chamado deu 3500 só, e 30 horas, mas deu MUITO mais trabalho... outras
// I.As avaliaram entre 80 e 200 mil") tem duas linhas de descrição e mais de
// 70 PRs: tirar o ERP da Supabase, cluster de alta disponibilidade em três
// provedores, réplica, backup, failover. A I.A não via nada disso. Agora ela
// recebe o histórico do GitHub gravado em CHAMADO_SISTEMA_EVENTO (meta canal
// github: pr_titulo/pr_url e, na conclusão por merge, commits/linhas/arquivos)
// e o período. Com entrega, o preço é do que FOI FEITO, não do que foi pedido.
export interface EventoGithub {
  created_at: string;
  meta: Record<string, unknown> | null;
}

export interface EntregaReal {
  total_prs: number;
  prs: string[];
  commits: number | null;
  linhas_adicionadas: number | null;
  arquivos_alterados: number | null;
  primeiro_pr_em: string | null;
  ultimo_pr_em: string | null;
  dias_de_trabalho: number | null;
}

const numMeta = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Junta os eventos do GitHub de um chamado: uma linha por PR (pela URL). */
export function resumirEntrega(eventos: EventoGithub[], c: Pick<ChamadoParaParecer, "created_at" | "concluido_em">): EntregaReal | null {
  const porPr = new Map<string, { titulo: string; em: string; commits: number | null; linhas: number | null; arquivos: number | null }>();
  for (const e of [...eventos].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const m = e.meta ?? {};
    const url = String(m.pr_url ?? "").trim();
    if (!url) continue;
    const atual = porPr.get(url) ?? { titulo: "", em: e.created_at, commits: null, linhas: null, arquivos: null };
    atual.titulo = String(m.pr_titulo ?? atual.titulo ?? "").trim() || atual.titulo;
    atual.commits = numMeta(m.pr_commits) ?? atual.commits;
    atual.linhas = numMeta(m.pr_linhas_adicionadas) ?? atual.linhas;
    atual.arquivos = numMeta(m.pr_arquivos_alterados) ?? atual.arquivos;
    porPr.set(url, atual);
  }
  if (!porPr.size) return null;

  const lista = [...porPr.values()];
  const soma = (k: "commits" | "linhas" | "arquivos") => {
    const vals = lista.map((p) => p[k]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const primeiro = lista[0].em;
  const ultimo = lista[lista.length - 1].em;
  const ini = Date.parse(c.created_at ?? primeiro);
  const fim = Date.parse(c.concluido_em ?? ultimo);
  return {
    total_prs: lista.length,
    prs: lista.map((p) => p.titulo || "(sem título)"),
    commits: soma("commits"),
    linhas_adicionadas: soma("linhas"),
    arquivos_alterados: soma("arquivos"),
    primeiro_pr_em: primeiro,
    ultimo_pr_em: ultimo,
    dias_de_trabalho: Number.isFinite(ini) && Number.isFinite(fim) && fim >= ini ? Math.max(1, Math.round((fim - ini) / 86_400_000)) : null,
  };
}

/** VALOR/HORA FIXO DE DESENVOLVEDOR SÊNIOR (Brasil, 2026) — o ÚNICO lugar a
 *  mudar no código. Ponto médio das faixas de sênior: freelancer PJ R$ 180–220,
 *  software house R$ 280–350, equipe interna (custo empresa com encargos)
 *  R$ 150–180. Mudou aqui? O recálculo dos pareceres já gravados é SQL (ver a
 *  mig 20261029001600, que repete estes números — o banco não lê este arquivo). */
export const VALOR_HORA_SENIOR = {
  freelancer: 200,
  software_house: 320,
  interno: 165,
} as const;

/** Os três perfis de fornecedor, sempre nesta ordem. */
export const PERFIS = [
  { perfil: "freelancer", rotulo: "Freelancer (PJ)", valor_hora: VALOR_HORA_SENIOR.freelancer,
    embasamento: `Desenvolvedor sênior PJ: valor/hora fixo de R$ ${VALOR_HORA_SENIOR.freelancer} (faixa de mercado de sênior: R$ 180 a R$ 220/h).` },
  { perfil: "software_house", rotulo: "Software house / consultoria", valor_hora: VALOR_HORA_SENIOR.software_house,
    embasamento: `Software house com time sênior: valor/hora fixo de R$ ${VALOR_HORA_SENIOR.software_house} (faixa de mercado: R$ 280 a R$ 350/h; inclui gestão de projeto, impostos, margem e garantia).` },
  { perfil: "interno", rotulo: "Equipe interna (CLT, custo empresa)", valor_hora: VALOR_HORA_SENIOR.interno,
    embasamento: `Desenvolvedor sênior CLT, custo empresa com encargos e benefícios: valor/hora fixo de R$ ${VALOR_HORA_SENIOR.interno} (faixa: R$ 150 a R$ 180/h).` },
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

Contexto técnico do ERP: React 18 + Vite + TypeScript + shadcn/ui no front; PostgreSQL com RLS, funções SQL e Edge Functions (Deno) no back, hoje num cluster próprio de alta disponibilidade (Patroni + PostgREST/GoTrue/Storage) em mais de um provedor; integrações com WhatsApp, Senior (RH), GitHub. Sistema grande e maduro, com centenas de telas e regras de acesso por usuário.

O QUE VOCÊ PRECIFICA: o valor de MERCADO para contratar esse trabalho no Brasil — quanto um cliente pagaria a um fornecedor para entregar o mesmo resultado. Não é o tempo que a equipe interna levou.

COMO ESTIMAR:
1. Se vier a seção "ENTREGA REAL", ela manda: o preço é do que FOI ENTREGUE, não do texto de abertura (que costuma ser curto). Leia os títulos das PRs para entender o escopo verdadeiro e pense no PROJETO equivalente contratado do zero: descoberta, arquitetura, implementação, testes, migração de dados, infraestrutura, documentação/runbook, acompanhamento em produção, correções. Cada PR mergeada de infraestrutura, banco, segurança ou arquitetura costuma representar de 4 a 16 horas de especialista; PR pequena de tela, de 1 a 4 horas. Muitas PRs ao longo de semanas = projeto grande, não chamado pequeno.
2. Sem entrega real (chamado novo), estime pelo pedido, incluindo entendimento, implementação, testes e publicação.
3. Pense também no "produto equivalente": se o chamado entrega um módulo ou sistema inteiro (ex.: recrutamento e seleção completo, migração de infraestrutura com alta disponibilidade e failover), compare com quanto o mercado cobra por esse sistema/projeto e NÃO subestime — projetos assim custam dezenas a centenas de milhares de reais numa software house.
4. Fornecedor externo precisa de mais horas que a equipe interna (curva de aprendizado de um ERP grande, reuniões, gestão de projeto).

Perfis (use EXATAMENTE estes códigos). Todos são de DESENVOLVEDOR SÊNIOR e o valor/hora de cada um é FIXO, definido pela empresa — você NÃO escolhe valor/hora, só estima as HORAS que cada perfil levaria:
- "freelancer": freelancer PJ sênior;
- "software_house": software house ou consultoria com time sênior;
- "interno": desenvolvedor sênior interno CLT, que já conhece o ERP.

Complexidade de 1 a 5: 1 = muito baixa (texto, rótulo, ajuste trivial), 2 = baixa (ajuste numa tela, filtro simples), 3 = média (tela ou regra nova, mexe no banco), 4 = alta (vários módulos, regras de acesso, integração), 5 = muito alta (infraestrutura, migração de dados, alta disponibilidade, integração externa complexa, módulo ou sistema inteiro).

Se o chamado for dúvida/orientação ou vago, estime mesmo assim o esforço provável e diga nas premissas o que faltou. Nas premissas, diga se o preço veio da entrega real ou só do pedido.

Responda SÓ com JSON, sem texto fora dele, neste formato:
{
  "precos": [
    { "perfil": "freelancer", "horas": 12, "explicacao": "uma frase: de onde vêm essas horas (etapas) para um sênior PJ" },
    { "perfil": "software_house", "horas": 16, "explicacao": "..." },
    { "perfil": "interno", "horas": 10, "explicacao": "..." }
  ],
  "complexidade_nivel": 3,
  "complexidade_justificativa": "2 a 4 frases: o que pesa (banco, telas, regras, integrações, risco)",
  "premissas": "1 a 3 frases: o que foi assumido e o que poderia mudar a estimativa"
}
Português do Brasil, frases curtas, sem markdown. Não cite valores em R$ nem valor/hora (a conta é feita depois, com a tabela fixa). Não invente funcionalidade que o chamado não pede.`;

const corta = (s: string | null | undefined, max: number) => {
  const t = String(s ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

export function montarPrompt(c: ChamadoParaParecer, entrega?: EntregaReal | null): string {
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
  if (entrega) {
    const n = (v: number | null, rot: string) => (v != null ? `${v.toLocaleString("pt-BR")} ${rot}` : null);
    const metricas = [n(entrega.commits, "commits"), n(entrega.linhas_adicionadas, "linhas adicionadas"), n(entrega.arquivos_alterados, "arquivos alterados")]
      .filter(Boolean).join(" · ");
    linhas.push(
      "",
      "ENTREGA REAL (histórico do GitHub do chamado):",
      `Status: ${c.status ?? "—"} · ${entrega.total_prs} PR(s)` +
        (entrega.dias_de_trabalho != null ? ` ao longo de ${entrega.dias_de_trabalho} dia(s) corridos` : ""),
      metricas
        ? `Métricas (parciais — só as PRs que concluíram o chamado registram): ${metricas}`
        : "Métricas de commits/linhas: não registradas.",
      "PRs:",
      ...entrega.prs.slice(0, 120).map((t) => `- ${corta(t, 200)}`),
    );
    if (entrega.prs.length > 120) linhas.push(`- … e mais ${entrega.prs.length - 120} PR(s)`);
  }
  return linhas.join("\n");
}

// ── Chat sobre o parecer ───────────────────────────────────────────────
// Pedido do Pablo (29/10/2026): "se eu perguntar 'da onde você tirou esse
// valor caro?' ela tem que argumentar perfeitamente". A I.A recebe o chamado
// E o parecer gravado, e defende os números com a conta (horas por etapa ×
// valor/hora da faixa) — mas reconhece quando a pergunta mostra um erro, e
// aí diz qual seria o número corrigido. O parecer gravado NÃO muda pelo chat.
// Desde os números fixos (29/10/2026, "só explica os valores e já era"), a
// I.A EXPLICA os números gravados e não propõe outros.
export interface ParecerParaChat {
  precos: unknown;
  valor_medio: number | null;
  horas_estimadas: number | null;
  complexidade_nivel: number | null;
  complexidade_rotulo: string | null;
  complexidade_justificativa: string | null;
  premissas: string | null;
}

export function montarSistemaChat(c: ChamadoParaParecer, p: ParecerParaChat, entrega?: EntregaReal | null): string {
  const faixas = PERFIS.map((x) => `- ${x.rotulo} ("${x.perfil}"): R$ ${x.valor_hora}/h fixo — ${x.embasamento}`).join("\n");
  return `Você é o consultor sênior de orçamento de software que escreveu o parecer abaixo sobre um chamado do ERP interno do Grupo Nascimento. Agora conversa com a gestão de Sistemas, que questiona os números.

Como responder:
- Defenda o parecer com argumentos concretos e verificáveis: quebre as horas por etapa (entender o pedido, banco/migration e regras de acesso, tela, testes, revisão e publicação, reuniões/ajustes com o solicitante), mostre a conta horas × valor/hora e por que aquele valor/hora está naquele ponto da faixa de mercado.
- Explique a diferença entre os perfis: fornecedor externo cobra a curva de aprendizado de um ERP grande com centenas de telas, reuniões, gestão de projeto, impostos, margem e garantia; a equipe interna já conhece o sistema e o custo-hora é o custo empresa (salário + encargos ~70-100% + benefícios).
- Os valores gravados são FIXOS e definitivos: explique e justifique ESSES números. Não proponha preço, horas ou valor/hora diferentes, não refaça a conta com outros números e não diga que "daria outro valor". Se a pessoa discordar, explique o raciocínio por trás das horas gravadas.
- O valor/hora de cada perfil é a tabela fixa da empresa para DESENVOLVEDOR SÊNIOR (abaixo), não uma escolha sua: diga isso e mostre por que é coerente com o mercado de sênior no Brasil.
- O preço é o de MERCADO para contratar o resultado com profissional sênior, não o tempo que a equipe interna levou. Se houver "ENTREGA REAL" abaixo, use as PRs para mostrar de onde vêm as horas.
- Não invente fonte, pesquisa ou estatística com nome e número exato que você não tem. Pode citar as referências de mercado de forma geral (tabelas de freelancer, propostas de software house, custo CLT de dev pleno/sênior no Brasil em 2026).
- O parecer gravado não muda — diga isso se pedirem para alterar.
- Português do Brasil, direto, frases curtas. Markdown simples (listas, **negrito**, tabela pequena quando ajudar). Valores em R$.

Valor/hora fixo de desenvolvedor sênior usado no parecer (Brasil, 2026):
${faixas}

CHAMADO:
${montarPrompt(c, entrega)}

PARECER GRAVADO (o preço de cada perfil = horas × valor/hora; valor médio = média dos três):
${JSON.stringify(p)}`;
}

/** Histórico do chat vindo do cliente: só papéis válidos, últimas 12, cortado. */
export function limparHistorico(h: unknown): { role: "user" | "assistant"; content: string }[] {
  return (Array.isArray(h) ? h : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
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
    if (!(horasBrutas > 0)) {
      return { ok: false, erro: `Horas inválidas para "${ref.rotulo}".` };
    }
    const horas = arred(limita(horasBrutas, 0.5, 6000), 1);
    // Valor/hora da tabela fixa: o que a I.A mandar em valor_hora é ignorado.
    const valor_hora = ref.valor_hora;
    precos.push({
      perfil: ref.perfil,
      rotulo: ref.rotulo,
      valor_hora,
      horas,
      valor: arred(horas * valor_hora, 2),
      embasamento: ref.embasamento,
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
