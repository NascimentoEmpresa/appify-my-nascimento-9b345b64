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

/** Os três perfis de fornecedor, sempre nesta ordem. Faixas de valor/hora
 *  de referência (Brasil, 2026) — a I.A escolhe dentro delas e explica.
 *  O teto subiu em 29/10/2026: infraestrutura, banco e alta disponibilidade
 *  são trabalho de especialista (SRE/DBA/arquiteto), que o teto antigo de
 *  dev pleno puxava para baixo. */
export const PERFIS = [
  { perfil: "freelancer", rotulo: "Freelancer (PJ)", min: 60, max: 220 },
  { perfil: "software_house", rotulo: "Software house / consultoria", min: 120, max: 380 },
  { perfil: "interno", rotulo: "Equipe interna (CLT, custo empresa)", min: 50, max: 160 },
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

Perfis (use EXATAMENTE estes códigos e escolha o valor/hora DENTRO da faixa; o topo da faixa é para especialista — infraestrutura, DBA, segurança, arquitetura):
- "freelancer": freelancer PJ pleno/sênior/especialista — R$ 60 a R$ 220 por hora;
- "software_house": software house ou consultoria — R$ 120 a R$ 380 por hora;
- "interno": profissional interno CLT, custo-hora empresa com encargos — R$ 50 a R$ 160 por hora.

Complexidade de 1 a 5: 1 = muito baixa (texto, rótulo, ajuste trivial), 2 = baixa (ajuste numa tela, filtro simples), 3 = média (tela ou regra nova, mexe no banco), 4 = alta (vários módulos, regras de acesso, integração), 5 = muito alta (infraestrutura, migração de dados, alta disponibilidade, integração externa complexa, módulo ou sistema inteiro).

Se o chamado for dúvida/orientação ou vago, estime mesmo assim o esforço provável e diga nas premissas o que faltou. Nas premissas, diga se o preço veio da entrega real ou só do pedido.

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
// aí diz qual seria o número corrigido. O parecer gravado NÃO muda pelo chat:
// para mudar, é o botão "Gerar de novo".
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
  const faixas = PERFIS.map((x) => `- ${x.rotulo} ("${x.perfil}"): R$ ${x.min} a R$ ${x.max}/h`).join("\n");
  return `Você é o consultor sênior de orçamento de software que escreveu o parecer abaixo sobre um chamado do ERP interno do Grupo Nascimento. Agora conversa com a gestão de Sistemas, que questiona os números.

Como responder:
- Defenda o parecer com argumentos concretos e verificáveis: quebre as horas por etapa (entender o pedido, banco/migration e regras de acesso, tela, testes, revisão e publicação, reuniões/ajustes com o solicitante), mostre a conta horas × valor/hora e por que aquele valor/hora está naquele ponto da faixa de mercado.
- Explique a diferença entre os perfis: fornecedor externo cobra a curva de aprendizado de um ERP grande com centenas de telas, reuniões, gestão de projeto, impostos, margem e garantia; a equipe interna já conhece o sistema e o custo-hora é o custo empresa (salário + encargos ~70-100% + benefícios).
- Seja honesto: se a pergunta mostra que a estimativa está alta ou baixa (por exemplo, o padrão já existe no sistema, ou o pedido é menor do que parece), reconheça, refaça a conta ali na resposta e diga o número que você daria agora. Não defenda erro.
- O preço é o de MERCADO para contratar o resultado, não o tempo que a equipe interna levou. Se houver "ENTREGA REAL" abaixo e o parecer gravado não refletir o tamanho do que foi entregue (muitas PRs, semanas de trabalho, infraestrutura, migração, módulo inteiro), diga isso com clareza, refaça a conta pelo escopo das PRs (4 a 16 h de especialista por PR de infraestrutura/banco/arquitetura; 1 a 4 h por PR pequena de tela) e compare com o preço de mercado do projeto ou sistema equivalente. Não ancore no número antigo.
- Não invente fonte, pesquisa ou estatística com nome e número exato que você não tem. Pode citar as referências de mercado de forma geral (tabelas de freelancer, propostas de software house, custo CLT de dev pleno/sênior no Brasil em 2026).
- O parecer gravado só muda pelo botão "Gerar de novo" na tela — diga isso se pedirem para alterar.
- Português do Brasil, direto, frases curtas. Markdown simples (listas, **negrito**, tabela pequena quando ajudar). Valores em R$.

Faixas de valor/hora usadas no parecer (Brasil, 2026):
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
    const vhBruto = num(item.valor_hora);
    if (!(horasBrutas > 0) || !(vhBruto > 0)) {
      return { ok: false, erro: `Horas ou valor/hora inválidos para "${ref.rotulo}".` };
    }
    const horas = arred(limita(horasBrutas, 0.5, 6000), 1);
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
