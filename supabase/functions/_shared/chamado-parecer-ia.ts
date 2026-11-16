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
//
// SÓ DEPOIS DAS HORAS (29/10/2026, Pablo: "a i.a só pode dar parecer quando
// o desenvolvedor concluir e informar as horas"): o parecer nasce na
// conclusão, com as horas que o dev informou (mig 20261029002400).
//
// SÓ AS HORAS GASTAS (30/10/2026, Pablo, SIS-2026-0787: 8 h gastas e o
// parecer cotando freelancer em 14 h e software house em 20 h): havendo
// horas gastas, os TRÊS perfis usam essas horas — a diferença de preço entre
// eles é só o valor/hora fixo. A I.A ainda devolve "horas" por perfil, mas
// aí elas são ignoradas; sem horas gastas, vale a estimativa dela. A tela
// refaz a mesma conta (src/lib/chamados/parecerHorasGastas.ts) e a mig
// 20261030000300 recalculou os pareceres já gravados.
//
// PELO ESCOPO ENTREGUE (09/11/2026, Pablo, sobre a integração PagFor a
// R$ 6.000: "da onde que o sistema da pagfor seria 6 mil só? a i.a tem que
// buscar contexto e reavaliar melhor"): SUBSTITUI a regra de 30/10 para o
// mercado. Quem conhece o ERP e usa I.A faz em 8 h o que um fornecedor não
// faz; preço de mercado pelas horas internas saía baixo em qualquer sistema.
// Freelancer e software house valem as horas que a I.A estima para entregar o
// mesmo escopo, nunca menos que as horas informadas. O "interno" segue nas
// horas informadas, e o card verde continua sendo o custo real.
//
// COMPLEXIDADE PESA NO PREÇO (29/10/2026, Pablo: "tem coisa que o
// desenvolvedor faz que leva 1h mas é de extrema importância e complexidade,
// e tem coisa que leva 1h mas é bem tranquilo"): o preço é
// horas × valor/hora × FATOR_COMPLEXIDADE[nível].
//
// SÓ O QUE O DEV NÃO CONTROLA (12/11/2026, aprovado pelo Iury depois da
// auditoria da Bonificação): o preço de novembro media as HORAS DIGITADAS
// pelo próprio dev (~R$ 500 por hora digitada, igual para todos), e chamado
// fechado pela PR, sem horas, valia R$ 0 — 10 de 13 do Eduardo e 6 de 23 do
// João, enquanto o Pablo (login fora da lista do fechamento automático)
// fechava tudo à mão e tinha tudo precificado. A reavaliação do mesmo dia
// passou a premiar a quantidade de PRs e os comentários que o dev escreve.
// Daqui em diante o preço sai SÓ do pedido (montarPromptDoPreco): sem horas
// informadas, sem PRs e sem histórico. Esses dados seguem na tela, como
// informação, e as horas continuam valendo para o CUSTO real (card verde).

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
  /** Horas que o dev informou ao concluir (mig 20261029002400). */
  horas_gastas?: number | string | null;
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

// ── PREÇO REALISTA (16/11/2026, Pablo, sobre o SIS-2026-0756 — pesquisa de
// permanência, 3/5 — cotado a R$ 16.200 freelancer e R$ 35.100 software
// house: "no máximo uns mil e poucos/dois mil", "18 mil e 35 mil é
// passamento", "tá puxando alto de mais assim pra vários chamados, DEIXA
// REALISTA"). Três coisas inflavam a conta ao mesmo tempo:
//   1. valor/hora de topo de faixa (R$ 300 e R$ 450/h);
//   2. horas da I.A "do zero, sem conhecer o ERP" (36 h e 52 h num formulário);
//   3. a complexidade contada DUAS vezes: já empurra as horas para cima e
//      ainda multiplicava o total (×1,5 no nível 3, ×2,5 no 5).
// Agora: o erro era de HORAS, não de valor/hora (Pablo, mesmo dia: "nenhum
// freelancer ia cobrar só 1280 por 16h, o problema real é: quem leva 16h pra
// fazer um formulário? no máximo 8h seria"). Valor/hora de freelancer de
// verdade (R$ 150/h; software house 1,5× = R$ 225/h), complexidade SEM
// multiplicar (fator 1 em todos os níveis) e um TETO DE HORAS por nível
// (TETO_HORAS_POR_COMPLEXIDADE): formulário médio (3/5) = até 8 h. Fica
// R$ 1.200 freelancer e R$ 1.800 software house, média R$ 1.500.
// A mig 20261116150000 refaz os pareceres já gravados com a mesma conta.

/** VALOR/HORA FIXO — o ÚNICO lugar a mudar no código. Mudou aqui? O recálculo
 *  dos pareceres já gravados é SQL (ver a mig 20261116150000, que repete estes
 *  números — o banco não lê este arquivo). Histórico: 200/320/165 (29/10),
 *  300/450/165 (05/11), 150/225/30 (16/11, "deixa realista" — o que caiu
 *  foram as horas, ver TETO_HORAS_POR_COMPLEXIDADE). */
export const VALOR_HORA_SENIOR = {
  freelancer: 150,
  software_house: 225,
  interno: 30,
} as const;

/** Multiplicador do preço pela complexidade. Desde 16/11/2026 é 1 em todos os
 *  níveis: a complexidade já pesa nas horas (e no teto delas, abaixo), e
 *  multiplicar o total de novo contava a mesma coisa duas vezes. Fica
 *  exportado e gravado em cada preço (fator_complexidade) para a tela e os
 *  pareceres antigos continuarem lendo o mesmo formato. */
export const FATOR_COMPLEXIDADE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
};

/** Máximo de horas que um perfil pode cobrar em cada nível de complexidade
 *  (16/11/2026). A I.A estima as horas; passou do teto, vale o teto. É o freio
 *  contra "36 h para um formulário" (formulário médio = até 8 h). A mig 20261116150000 repete estes números. */
export const TETO_HORAS_POR_COMPLEXIDADE: Record<number, number> = {
  1: 2,
  2: 4,
  3: 8,
  4: 16,
  5: 40,
};

/** Os três perfis de fornecedor, sempre nesta ordem. */
export const PERFIS = [
  { perfil: "freelancer", rotulo: "Freelancer (PJ)", valor_hora: VALOR_HORA_SENIOR.freelancer,
    embasamento: `Desenvolvedor PJ: valor/hora fixo de R$ ${VALOR_HORA_SENIOR.freelancer} (valor comum de freelancer experiente no Brasil).` },
  { perfil: "software_house", rotulo: "Software house / consultoria", valor_hora: VALOR_HORA_SENIOR.software_house,
    embasamento: `Software house: valor/hora fixo de R$ ${VALOR_HORA_SENIOR.software_house} (1,5× o freelancer, por gestão, impostos e margem).` },
  { perfil: "interno", rotulo: "Equipe interna (CLT, custo empresa)", valor_hora: VALOR_HORA_SENIOR.interno,
    embasamento: `Desenvolvedor CLT, custo empresa com encargos: valor/hora fixo de R$ ${VALOR_HORA_SENIOR.interno}.` },
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
  /** FATOR_COMPLEXIDADE do nível — valor = horas × valor_hora × fator. */
  fator_complexidade: number;
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

COMO ESTIMAR (seja REALISTA e enxuto — o erro mais comum é inflar):
1. Estime SÓ pelo pedido (assunto, tipo, módulo e descrição do solicitante), incluindo entendimento, implementação, testes e publicação. Você não recebe horas gastas, PRs nem comentários de quem desenvolveu: o mesmo pedido tem de dar o mesmo preço, seja quem for o desenvolvedor.
2. Estime as horas de um desenvolvedor competente que trabalha com ferramentas modernas (inclusive I.A) sobre um sistema já pronto, com banco, login, permissões e componentes de tela prontos para reaproveitar. Não some reuniões, gestão de projeto, "curva de aprendizado" nem margem de segurança: isso já está no valor/hora.
3. Referência de horas: texto/rótulo/ajuste trivial até 1 h; ajuste numa tela ou filtro 1 a 3 h; tela, formulário ou regra nova com banco 4 a 8 h; vários módulos, regras de acesso ou integração 8 a 16 h; só projeto grande de verdade (infraestrutura, migração de dados, sistema inteiro) passa disso, até 40 h.
4. Freelancer e software house fazem o MESMO escopo: as horas dos dois devem ser próximas (a software house no máximo uns 20% a mais). O interno, que já conhece o ERP, leva um pouco menos.

Perfis (use EXATAMENTE estes códigos). O valor/hora de cada um é FIXO, definido pela empresa — você NÃO escolhe valor/hora, só estima as HORAS que cada perfil levaria:
- "freelancer": freelancer PJ;
- "software_house": software house ou consultoria;
- "interno": desenvolvedor interno CLT, que já conhece o ERP.
Na "explicacao", cite as etapas concretas que sustentam as horas daquele perfil. Um ajuste simples continua sendo poucas horas; não infle o que o escopo não sustenta.

Complexidade de 1 a 5 — mede DIFICULDADE TÉCNICA, RISCO e IMPORTÂNCIA para a empresa. NÃO multiplica o preço: o preço é só horas × valor/hora, e cada nível tem um teto de horas (1 = 2 h, 2 = 4 h, 3 = 8 h, 4 = 16 h, 5 = 40 h).
1 = muito baixa (texto, rótulo, ajuste trivial, sem risco), 2 = baixa (ajuste numa tela, filtro simples), 3 = média (tela, formulário ou regra nova, mexe no banco), 4 = alta (vários módulos, regras de acesso, integração, risco real de quebrar algo em uso), 5 = muito alta (infraestrutura, segurança, migração de dados, alta disponibilidade, integração externa complexa, módulo ou sistema inteiro).

Se o chamado for dúvida/orientação ou vago, estime mesmo assim o esforço provável e diga nas premissas o que faltou.

Responda SÓ com JSON, sem texto fora dele, neste formato:
{
  "precos": [
    { "perfil": "freelancer", "horas": 10, "explicacao": "uma frase: de onde vêm essas horas (etapas) para um PJ" },
    { "perfil": "software_house", "horas": 12, "explicacao": "..." },
    { "perfil": "interno", "horas": 8, "explicacao": "..." }
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

export function montarPrompt(c: ChamadoParaParecer, entrega?: EntregaReal | null, historico?: string[] | null): string {
  const horasReais = Number(c.horas_gastas);
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
  // A descrição deixou de ter limite na abertura (10/11/2026): 20 mil caracteres
  // cobrem o texto colado inteiro sem estourar o contexto do modelo.
  linhas.push("", "Descrição:", corta(c.descricao, 20000) || "(sem descrição)");
  if (c.observacoes_solicitante?.trim()) linhas.push("", "Observações do solicitante:", corta(c.observacoes_solicitante, 1500));
  if (horasReais > 0) {
    linhas.push("", `Horas reais informadas pelo desenvolvedor ao concluir: ${horasReais.toLocaleString("pt-BR")} h (desenvolvedor sênior interno, que já conhece o ERP). Vale para o perfil "interno" e é o piso dos outros dois.`);
  }
  if (historico?.length) {
    linhas.push("", "HISTÓRICO DO CHAMADO (comentários e observações):", ...historico.slice(0, 40).map((t) => `- ${corta(t, 400)}`));
  }
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

/**
 * O prompt do PREÇO (12/11/2026, ver o cabeçalho): só o pedido. As horas
 * informadas, as PRs e o histórico ficam de fora mesmo que venham no chamado,
 * para nenhum dado escrito ou controlado por quem desenvolveu mexer no valor.
 */
export function montarPromptDoPreco(c: ChamadoParaParecer): string {
  return montarPrompt({ ...c, horas_gastas: null }, null, null);
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

export function montarSistemaChat(c: ChamadoParaParecer, p: ParecerParaChat): string {
  const faixas = PERFIS.map((x) => `- ${x.rotulo} ("${x.perfil}"): R$ ${x.valor_hora}/h fixo — ${x.embasamento}`).join("\n")
    + "\nA complexidade NÃO multiplica o preço (16/11/2026): ela limita as horas de cada perfil — " + Object.entries(TETO_HORAS_POR_COMPLEXIDADE).map(([n, h]) => `nível ${n} = até ${h} h`).join(", ")
    + ". Pareceres antigos podem ter um fator de complexidade gravado; os de agora têm fator 1.";
  return `Você é o consultor sênior de orçamento de software que escreveu o parecer abaixo sobre um chamado do ERP interno do Grupo Nascimento. Agora conversa com a gestão de Sistemas, que questiona os números.

Como responder:
- Defenda o parecer com argumentos concretos e verificáveis: quebre as horas por etapa (entender o pedido, banco/migration e regras de acesso, tela, testes, revisão e publicação, reuniões/ajustes com o solicitante), mostre a conta horas × valor/hora e por que aquele valor/hora está naquele ponto da faixa de mercado.
- Explique a diferença entre os perfis: fornecedor externo cobra a curva de aprendizado de um ERP grande com centenas de telas, reuniões, gestão de projeto, impostos, margem e garantia; a equipe interna já conhece o sistema e o custo-hora é o custo empresa (salário + encargos ~70-100% + benefícios).
- Os valores gravados são FIXOS e definitivos: explique e justifique ESSES números. Não proponha preço, horas ou valor/hora diferentes, não refaça a conta com outros números e não diga que "daria outro valor". Se a pessoa discordar, explique o raciocínio por trás das horas gravadas.
- O valor/hora de cada perfil é a tabela fixa da empresa (abaixo), não uma escolha sua: diga isso e mostre por que é coerente com o mercado comum no Brasil.
- A complexidade não multiplica a conta: ela limita as horas que cada perfil pode cobrar (teto por nível, abaixo). Se o parecer gravado tiver fator diferente de 1, é de antes de 16/11/2026.
- O preço sai SÓ do pedido do solicitante: horas gastas, PRs e comentários de quem desenvolveu não entram, para o mesmo pedido valer o mesmo com qualquer desenvolvedor. Diga isso se perguntarem por que as horas informadas não mudam o valor (o valor/hora da software house já embute gestão, impostos e margem).
- O preço é o de MERCADO para contratar o resultado, realista e enxuto, não o tempo que a equipe interna levou.
- Não invente fonte, pesquisa ou estatística com nome e número exato que você não tem. Pode citar as referências de mercado de forma geral (tabelas de freelancer, propostas de software house, custo CLT de dev no Brasil em 2026).
- O parecer gravado não muda — diga isso se pedirem para alterar.
- Português do Brasil, direto, frases curtas. Markdown simples (listas, **negrito**, tabela pequena quando ajudar). Valores em R$.

Valor/hora fixo usado no parecer (Brasil, 2026):
${faixas}

CHAMADO:
${montarPromptDoPreco(c)}

PARECER GRAVADO (o preço de cada perfil = horas × valor/hora; pareceres antigos × fator de complexidade):
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
export function validarParecer(bruto: unknown, horasReais?: number | string | null): { ok: true; parecer: Parecer } | { ok: false; erro: string } {
  if (!bruto || typeof bruto !== "object") return { ok: false, erro: "A I.A não devolveu um JSON válido." };
  const b = bruto as Record<string, unknown>;
  const lista = Array.isArray(b.precos) ? b.precos as Record<string, unknown>[] : [];
  const reais = Number(horasReais);

  // A complexidade vem antes: ela multiplica o preço de cada perfil.
  const nivel = Math.round(num(b.complexidade_nivel));
  if (!(nivel >= 1 && nivel <= 5)) return { ok: false, erro: "A I.A não deu um nível de complexidade de 1 a 5." };
  const fator = FATOR_COMPLEXIDADE[nivel];
  const teto = TETO_HORAS_POR_COMPLEXIDADE[nivel];

  const precos: PrecoParecer[] = [];
  for (const ref of PERFIS) {
    const item = lista.find((p) => p && String(p.perfil ?? "").trim() === ref.perfil);
    if (!item) return { ok: false, erro: `A I.A não estimou o perfil "${ref.rotulo}".` };
    // Horas informadas: exatas no interno, piso no mercado (09/11/2026).
    const estimadas = num(item.horas);
    const horasBrutas = !(reais > 0) ? estimadas
      : ref.perfil === "interno" ? reais
      : Math.max(reais, estimadas > 0 ? estimadas : 0);
    if (!(horasBrutas > 0)) {
      return { ok: false, erro: `Horas inválidas para "${ref.rotulo}".` };
    }
    // Teto por complexidade (16/11/2026): passou, vale o teto.
    const horas = arred(limita(horasBrutas, 0.5, teto), 1);
    // Valor/hora da tabela fixa: o que a I.A mandar em valor_hora é ignorado.
    const valor_hora = ref.valor_hora;
    precos.push({
      perfil: ref.perfil,
      rotulo: ref.rotulo,
      valor_hora,
      horas,
      fator_complexidade: fator,
      valor: arred(horas * valor_hora * fator, 2),
      embasamento: ref.embasamento,
      explicacao: corta(String(item.explicacao ?? ""), 400),
    });
  }

  const justificativa = corta(String(b.complexidade_justificativa ?? ""), 1200);
  if (!justificativa) return { ok: false, erro: "A I.A não justificou a complexidade." };

  // A média é SÓ de mercado (freelancer e software house): o card do interno
  // virou o custo real (card verde) e, desde 12/11/2026, o preço nunca tem
  // horas informadas — a média de 3 perfis punha custo nosso no "valor de
  // mercado" (16/11/2026).
  const base = precos.filter((p) => p.perfil !== "interno");
  const valor_medio = arred(base.reduce((s, p) => s + p.valor, 0) / base.length, 2);
  const horas_estimadas = arred(base.reduce((s, p) => s + p.horas, 0) / base.length, 1);
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
