// =====================================================================
// PARECER I.A DA DENÚNCIA — os seis campos da planilha do Comitê
// (29/10/2026)
//
// O Comitê preenche, para cada caso, a planilha "entrada de pareceres"
// (modelo do Pablo, 00 MODELO entrada de pareceres.xlsx). Seis colunas dela
// são texto de redação, e cada uma vira um botão no card "Parecer I.A":
// a I.A escreve aquele campo para a denúncia aberta, no estilo da planilha —
// um parágrafo curto, formal, sem markdown — e a pessoa copia para a célula.
//
// Lógica pura, sem Deno nem React: a Edge denuncia-parecer-ia monta o pedido
// e confere a resposta daqui; o card lê a lista dos botões daqui; e
// src/test/denuncia-parecer-ia.test.ts testa as regras.
//
// Os exemplos de estilo abaixo são PARÁFRASES ANÔNIMAS das linhas já
// preenchidas da planilha, não as linhas em si: elas têm nomes de
// denunciados e vítimas de outros casos, e esses nomes não podem ir para a
// I.A dentro do pedido sobre um caso diferente.
// =====================================================================

export type IdCampoPlanilha =
  | "resumo_objetivo"
  | "resultado"
  | "medida_principal"
  | "pendencia_acompanhamento"
  | "decisao_presidencia"
  | "fundamentacao_presidencia";

export interface CampoPlanilha {
  id: IdCampoPlanilha;
  /** Nome exato da coluna na planilha — é o texto do botão. */
  rotulo: string;
  /** O que o campo é e como se escreve. */
  instrucao: string;
  /** Exemplo de estilo (anônimo). */
  exemplo: string;
  /** Campo da Presidência: sem decisão registrada, a resposta é proposta. */
  daPresidencia?: boolean;
  /** Tamanho máximo aceito da resposta, em caracteres. */
  max: number;
}

/** Vereditos com que o campo Resultado pode começar, na grafia da planilha. */
export const VEREDITOS = [
  "Procedente parcial",
  "Procedente",
  "Improcedente",
  "Inconclusivo",
  "Arquivada",
] as const;

/** Na ordem da planilha (e dos botões). */
export const CAMPOS_PLANILHA: CampoPlanilha[] = [
  {
    id: "resumo_objetivo",
    rotulo: "Resumo objetivo",
    instrucao:
      "Conte o caso para quem não leu o relato: o que foi relatado, quem é apontado (pelo nome, se o dossiê traz), quais episódios e o que surgiu depois na apuração. Em terceira pessoa, sem juízo de culpa (\"o relato atribui\", \"foi apontado\", \"informou\").",
    exemplo:
      "Relato de postura recorrente considerada agressiva e desrespeitosa por parte do gerente apontado em comunicações com as equipes de Sistemas e RH, especialmente diante de falhas do sistema. Foram apontados comentários depreciativos, acusações indiretas e cobranças públicas, com desgaste, constrangimento e desmotivação entre as áreas.",
    max: 1500,
  },
  {
    id: "resultado",
    rotulo: "Resultado",
    instrucao:
      `Comece OBRIGATORIAMENTE pelo veredito, exatamente uma destas grafias: ${VEREDITOS.join(", ")}. Depois do veredito, " - " e a justificativa curta: o que ficou confirmado, o que não ficou e, se for o caso, de quem é a competência ou o que ainda depende de apuração. Se a apuração ainda não permite veredito, use "Inconclusivo" e diga o que falta.`,
    exemplo:
      "Procedente parcial - confirmada a inadequação da forma de comunicação, sem elementos suficientes para caracterizar assédio moral, perseguição, discriminação ou infração disciplinar de maior gravidade.",
    max: 700,
  },
  {
    id: "medida_principal",
    rotulo: "Medida principal",
    instrucao:
      "A medida que responde pelo caso, em uma frase de ação: o que será aplicado ou encaminhado, a quem e com que caráter. Use a medida registrada na ficha e a recomendação do Comitê; se nada foi definido, proponha a medida que o dossiê sustenta e diga que é proposta.",
    exemplo:
      "Aplicação de ADVERTÊNCIA DISCIPLINAR ESCRITA ao colaborador apontado, com caráter educativo, preventivo e orientador.",
    max: 700,
  },
  {
    id: "pendencia_acompanhamento",
    rotulo: "Pendência atual/Acompanhamento",
    instrucao:
      "O que ainda falta fazer ou acompanhar, como uma sequência de ações separadas por ponto e vírgula, começando por verbo no infinitivo. Use as providências pendentes (destaque as de prazo estourado), a pendência atual da ficha e o que a medida exige comprovar.",
    exemplo:
      "Comprovar a ciência formal do colaborador e o registro da advertência em seu histórico funcional; acompanhar o período de 90 dias; registrar os feedbacks e a execução das ações de desenvolvimento e melhoria dos fluxos internos.",
    max: 1000,
  },
  {
    id: "decisao_presidencia",
    rotulo: "Decisão final da Presidência da Empresa",
    instrucao:
      "O que a Presidência decidiu: se acolheu, alterou ou rejeitou a recomendação do Comitê e o que determinou. Use a decisão registrada no dossiê.",
    exemplo:
      "A Presidência acolheu integralmente a recomendação do Comitê e determinou a advertência disciplinar escrita, o acompanhamento comportamental por 90 dias, o desenvolvimento das lideranças e o aperfeiçoamento dos fluxos de comunicação entre as áreas.",
    daPresidencia: true,
    max: 1000,
  },
  {
    id: "fundamentacao_presidencia",
    rotulo: "Fundamentação da decisão da Presidência da Empresa",
    instrucao:
      "Por que a decisão é essa: o que foi apurado, a gravidade, a conduta e a postura do envolvido, e por que a medida é proporcional. Use a fundamentação registrada; complete só com o que o dossiê sustenta.",
    exemplo:
      "A comunicação adotada ultrapassou o padrão esperado de um cargo de liderança e produziu desgaste entre equipes. Não se identificou intenção deliberada de humilhar ou perseguir, e o investigado reconheceu a inadequação de manifestações. A medida foi considerada proporcional, educativa e preventiva.",
    daPresidencia: true,
    max: 1500,
  },
];

export const campoPorId = (id: unknown): CampoPlanilha | undefined =>
  CAMPOS_PLANILHA.find((c) => c.id === id);

/** Prefixo obrigatório quando a Presidência ainda não decidiu. */
export const PREFIXO_PROPOSTA = "Proposta (não há decisão registrada da Presidência): ";

/** O pedido de UM campo. `decidida` = há decisão da Presidência no dossiê. */
export function montarPedidoCampo(campo: CampoPlanilha, decidida: boolean): string {
  const proposta = campo.daPresidencia && !decidida;
  return [
    `Escreva o campo "${campo.rotulo}" da planilha de pareceres do Comitê para esta denúncia.`,
    campo.instrucao,
    proposta
      ? `A Presidência AINDA NÃO registrou decisão neste caso. Escreva uma PROPOSTA, baseada na recomendação e na apuração do Comitê, começando exatamente por "${PREFIXO_PROPOSTA.trim()}".`
      : "",
    "Formato: UM parágrafo curto, objetivo e formal, em português do Brasil. Sem markdown, sem títulos, sem listas, sem aspas em volta e sem repetir o nome do campo. Só o texto que vai na célula.",
    "Use só o que está no dossiê. Se faltar informação para algum ponto, diga isso no próprio texto (ex.: \"não consta registro de...\") em vez de inventar.",
    `Exemplo de estilo (de outro caso, só para o tom — não copie o conteúdo): ${campo.exemplo}`,
  ].filter(Boolean).join("\n\n");
}

/** Deixa a resposta no formato da célula: um parágrafo, sem markdown, sem
 *  o rótulo na frente e sem aspas em volta. */
export function limparTextoCampo(texto: string, campo: CampoPlanilha): string {
  let t = String(texto ?? "");
  t = t.replace(/```[a-z]*\n?|```/gi, "");
  t = t.replace(/^\s*#{1,6}\s+/gm, "");           // títulos
  t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");  // marcadores de lista
  t = t.replace(/\*\*|__|`/g, "");                // negrito / código
  t = t.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // "Resultado: ..." / "**Resumo objetivo** — ..." → só o texto.
  const rotulo = campo.rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  t = t.replace(new RegExp(`^${rotulo}\\s*[:—–-]\\s*`, "i"), "");
  t = t.replace(/^["“”']+|["“”']+$/g, "").trim();
  return t;
}

/** Normaliza o veredito do Resultado para a grafia da planilha
 *  ("Parcialmente procedente" → "Procedente parcial") e confere que existe. */
export function vereditoDe(texto: string): string | null {
  const t = texto.trim();
  if (/^parcialmente\s+procedente/i.test(t)) return "Procedente parcial";
  if (/^procedente\s+em\s+parte/i.test(t)) return "Procedente parcial";
  for (const v of VEREDITOS) if (t.toLowerCase().startsWith(v.toLowerCase())) return v;
  return null;
}

export type CampoValidado = { ok: true; texto: string } | { ok: false; erro: string };

/** Limpa e confere a resposta da I.A para o campo. */
export function validarCampo(textoBruto: string, campo: CampoPlanilha, decidida: boolean): CampoValidado {
  let t = limparTextoCampo(textoBruto, campo);
  if (t.length < 20) return { ok: false, erro: "A I.A devolveu um texto curto demais. Tente de novo." };

  if (campo.id === "resultado") {
    const v = vereditoDe(t);
    if (!v) return { ok: false, erro: `O Resultado precisa começar pelo veredito (${VEREDITOS.join(", ")}). Tente de novo.` };
    // Reescreve o começo na grafia da planilha e garante o " - ".
    const resto = t.replace(/^(parcialmente\s+procedente|procedente\s+em\s+parte|procedente\s+parcial|procedente|improcedente|inconclusivo|arquivada)\s*[-—–:,.]?\s*/i, "");
    t = resto ? `${v} - ${resto}` : v;
  }

  if (campo.daPresidencia && !decidida && !/^proposta\b/i.test(t)) {
    // Sem decisão registrada o texto NÃO pode parecer decisão tomada.
    t = PREFIXO_PROPOSTA + t;
  }

  if (t.length > campo.max) {
    // Corta na última frase inteira que cabe.
    const corte = t.slice(0, campo.max);
    const fim = corte.lastIndexOf(". ");
    t = fim > campo.max * 0.6 ? corte.slice(0, fim + 1) : `${corte.trimEnd()}…`;
  }
  return { ok: true, texto: t };
}
