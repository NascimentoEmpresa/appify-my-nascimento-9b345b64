// =====================================================================
// COMITÊ DE ÉTICA — o procedimento inteiro, em ordem
//
// Lógica pura da exportação: montar a linha do tempo, escrever o resumo
// gerencial e produzir a linha da planilha de controle. Sem React e sem
// Supabase de propósito — é o que os testes carregam, e é o que garante que
// o PDF, o Excel e o resumo contem a MESMA história.
//
// O requisito é "procedimento completo e organizado cronologicamente". Cada
// fonte (mudança de campo, mensagem, providência, anexo) tem sua própria
// tabela e seu próprio carimbo de tempo; aqui elas viram um fio só.
// =====================================================================

import {
  LABEL_CATEGORIA_ANEXO, LABEL_CAUSA, LABEL_DECISAO, LABEL_GRAVIDADE,
  LABEL_MEDIDA, LABEL_RECOMENDACAO, LABEL_RESULTADO, LABEL_SITUACAO,
  LABEL_TIPO, LABEL_TIPO_REGISTRO, rotulo,
} from "./vocabulario";
import type { Alerta, Anexo, Denuncia, Evento, Providencia } from "./metricas";

export interface Mensagem {
  id: string; autor: string; autor_nome?: string | null;
  mensagem: string; interna: boolean; tipo: string; created_at: string;
}

export interface DadosDossie {
  denuncia: Denuncia;
  eventos: Evento[];
  mensagens: Mensagem[];
  providencias: Providencia[];
  anexos: Anexo[];
  alertas?: Alerta[];
}

export interface LinhaTempo {
  quando: string;
  /** Agrupa visualmente e vira a cor/ícone no PDF. */
  tipo: "abertura" | "situacao" | "campo" | "mensagem" | "registro" | "providencia" | "anexo" | "decisao";
  titulo: string;
  detalhe?: string;
  autor?: string;
}

// ---------------------------------------------------------------- rótulos

/**
 * Nome legível de cada coluna da ficha no histórico. Sem isto, o dossiê
 * exportado diria "apuracao_responsavel: null → Ana" para quem não é do time
 * de desenvolvimento — que é justamente quem vai ler este documento.
 */
export const LABEL_CAMPO: Record<string, string> = {
  status: "Situação",
  resultado: "Resultado da apuração",
  gravidade: "Gravidade",
  sigilo: "Sigilo",
  titulo: "Assunto",
  resumo: "Resumo",
  origem: "Origem",
  tipo_classificado: "Tipo (classificação do Comitê)",
  denunciado_nome: "Denunciado",
  denunciado_empregado_id: "Denunciado (vínculo com o cadastro)",
  lider_nome: "Líder imediato",
  lider_empregado_id: "Líder (vínculo com o cadastro)",
  diretoria: "Diretoria",
  contrato: "Contrato",
  setor: "Setor",
  unidade: "Unidade / Filial",
  cidade: "Cidade",
  apuracao_responsavel: "Responsável pela apuração",
  apuracao_responsavel_id: "Responsável (usuário)",
  apuracao_inicio: "Início da apuração",
  apuracao_fim: "Conclusão da apuração",
  primeira_providencia_em: "Primeira providência",
  pendencia_atual: "Pendência atual",
  evidencias_analise: "Evidências analisadas",
  medidas: "Medidas aplicadas",
  medida_principal: "Medida principal",
  recomendacao: "Recomendação do Comitê",
  causa_raiz: "Causa raiz",
  causa_raiz_detalhe: "Detalhe da causa raiz",
  acoes_preventivas: "Ações preventivas",
  acoes_corretivas: "Ações corretivas",
  houve_recurso: "Houve recurso",
  recurso_resultado: "Resultado do recurso",
  recurso_data: "Data do recurso",
  sla_dias_override: "Prazo específico do caso",
  parecer_interno: "Fundamentação do parecer",
  retorno_denunciante: "Retorno ao denunciante",
  concluido_em: "Data de conclusão",
  decisao_final: "Decisão da Presidência",
  decisao_fundamentacao: "Fundamentação da decisão",
  decisao_sobre_parecer: "Decisão sobre a recomendação",
  decisao_medidas: "Medidas determinadas pela Presidência",
  decisao_em: "Data da decisão",
};

export const nomeCampo = (c: string) => LABEL_CAMPO[c] ?? c;

/** Traduz o valor cru guardado na coluna para o que a pessoa lê na tela. */
export function valorCampo(campo: string, valor: string | null): string {
  const v = (valor ?? "").trim();
  if (!v) return "vazio";
  switch (campo) {
    case "status":               return rotulo(LABEL_SITUACAO, v);
    case "resultado":            return rotulo(LABEL_RESULTADO, v);
    case "gravidade":            return rotulo(LABEL_GRAVIDADE, v);
    case "tipo_classificado":    return rotulo(LABEL_TIPO, v);
    case "causa_raiz":           return rotulo(LABEL_CAUSA, v);
    case "recomendacao":         return rotulo(LABEL_RECOMENDACAO, v);
    case "decisao_sobre_parecer":return rotulo(LABEL_DECISAO, v);
    case "medida_principal":     return rotulo(LABEL_MEDIDA, v);
    case "houve_recurso":        return v === "true" ? "Sim" : "Não";
    case "medidas":
      // text[] chega do Postgres como {a,b}. Cru, é ilegível no relatório.
      return v.replace(/^\{|\}$/g, "").split(",").filter(Boolean)
              .map((m) => rotulo(LABEL_MEDIDA, m.replace(/"/g, ""))).join(", ") || "vazio";
    default:                     return v;
  }
}

// ------------------------------------------------------------ linha do tempo

const dt = (s?: string | null) => (s ? new Date(s).getTime() : 0);

/**
 * Tudo o que aconteceu com o procedimento, em ordem.
 *
 * `incluirInternas` fica de fora quando o dossiê é para alguém de fora da
 * apuração: nota de trabalho e entrevista são registro interno, e um PDF que
 * sai da empresa não pode carregá-las por descuido.
 */
export function linhaDoTempo(d: DadosDossie, incluirInternas = true): LinhaTempo[] {
  const linhas: LinhaTempo[] = [];

  linhas.push({
    quando: d.denuncia.created_at,
    tipo: "abertura",
    titulo: `Denúncia registrada — ${d.denuncia.protocolo}`,
    detalhe: [
      d.denuncia.empresa_nome ? `Empresa: ${d.denuncia.empresa_nome}` : null,
      d.denuncia.contrato_informado ? `Contrato: ${d.denuncia.contrato_informado}` : null,
      `Tipo informado: ${rotulo(LABEL_TIPO, d.denuncia.tipo_denuncia)}`,
      d.denuncia.anonimo ? "Relato anônimo" : (d.denuncia.identificado ? "Denunciante identificado" : "Denunciante não identificado"),
    ].filter(Boolean).join(" · "),
  });

  for (const e of d.eventos) {
    linhas.push({
      quando: e.created_at,
      tipo: e.campo === "status" ? "situacao" : "campo",
      titulo: `${nomeCampo(e.campo)}: ${valorCampo(e.campo, e.de)} → ${valorCampo(e.campo, e.para)}`,
      detalhe: e.justificativa ?? undefined,
      autor: e.por_nome ?? undefined,
    });
  }

  for (const m of d.mensagens) {
    if (m.interna && !incluirInternas) continue;
    const ehRegistro = m.tipo !== "mensagem" && m.tipo !== "nota";
    linhas.push({
      quando: m.created_at,
      tipo: ehRegistro ? "registro" : "mensagem",
      titulo: ehRegistro
        ? rotulo(LABEL_TIPO_REGISTRO, m.tipo)
        : m.autor === "comite"
          ? (m.interna ? "Nota interna do Comitê" : "Mensagem do Comitê ao denunciante")
          : "Mensagem do denunciante",
      detalhe: m.mensagem,
      autor: m.autor_nome ?? undefined,
    });
  }

  for (const p of d.providencias) {
    linhas.push({
      quando: p.created_at,
      tipo: "providencia",
      titulo: `Providência: ${p.descricao}`,
      detalhe: [
        p.responsavel ? `Responsável: ${p.responsavel}` : null,
        p.prazo ? `Prazo: ${fmtData(p.prazo)}` : null,
        p.concluida_em ? `Concluída em ${fmtData(p.concluida_em)}` : null,
        p.observacao || null,
      ].filter(Boolean).join(" · "),
      autor: p.criado_por_nome ?? undefined,
    });
  }

  for (const a of d.anexos) {
    if (a.sensivel && !incluirInternas) continue;
    linhas.push({
      quando: a.created_at,
      tipo: "anexo",
      titulo: `Anexo: ${a.nome_arquivo}`,
      detalhe: [
        rotulo(LABEL_CATEGORIA_ANEXO, a.categoria),
        a.origem === "denunciante" ? "enviado pelo denunciante" : `juntado pelo ${a.origem}`,
        a.sensivel ? "sigiloso" : null,
        a.descricao || null,
      ].filter(Boolean).join(" · "),
      autor: a.autor_nome ?? undefined,
    });
  }

  if (d.denuncia.decisao_final) {
    linhas.push({
      quando: d.denuncia.decisao_em ?? d.denuncia.updated_at,
      tipo: "decisao",
      titulo: "Decisão da Presidência",
      detalhe: [
        d.denuncia.decisao_final,
        d.denuncia.decisao_sobre_parecer
          ? rotulo(LABEL_DECISAO, d.denuncia.decisao_sobre_parecer) : null,
        d.denuncia.decisao_medidas ? `Medidas determinadas: ${d.denuncia.decisao_medidas}` : null,
      ].filter(Boolean).join("\n"),
      autor: d.denuncia.decisao_por_nome ?? undefined,
    });
  }

  // Ordem estável: dois registros no mesmo instante (o gatilho grava vários
  // campos na mesma transação) precisam sair sempre na mesma sequência,
  // senão dois PDFs do mesmo caso saem diferentes.
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (dt(a.l.quando) - dt(b.l.quando)) || (a.i - b.i))
    .map(({ l }) => l);
}

// ------------------------------------------------------------------ formato

export function fmtData(iso?: string | null): string {
  const s = String(iso ?? "");
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  return isNaN(+d) ? s : d.toLocaleDateString("pt-BR");
}

export function fmtDataHora(iso?: string | null): string {
  const s = String(iso ?? "");
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export const bytesLegivel = (n?: number | null): string => {
  const v = Number(n ?? 0);
  if (!v) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
};

// -------------------------------------------------------- resumo gerencial

/**
 * O resumo gerencial do procedimento, para colar na planilha de controle.
 *
 * Escrito por regra, não por modelo de linguagem: é peça de um procedimento
 * de ética, e um resumo que "quase" descreve o caso é pior do que nenhum.
 * Aqui cada frase sai de um campo, e o que não está preenchido aparece como
 * pendência em vez de ser inventado.
 */
export function resumoGerencial(d: DadosDossie): string {
  const x = d.denuncia;
  const L: string[] = [];

  L.push(`PROTOCOLO ${x.protocolo} — ${rotulo(LABEL_SITUACAO, x.status)}`);
  L.push(`Registrada em ${fmtDataHora(x.created_at)} · Origem: ${x.origem ?? "canal web"}`);
  if (x.empresa_nome) {
    L.push(`Empresa: ${x.empresa_nome}${x.contrato_informado ? ` · Contrato: ${x.contrato_informado}` : ""}`);
  }
  L.push("");

  L.push(`ASSUNTO: ${x.titulo || "não classificado"}`);
  L.push(`Tipo: ${rotulo(LABEL_TIPO, x.tipo_classificado || x.tipo_denuncia)} · Gravidade: ${
    x.gravidade ? rotulo(LABEL_GRAVIDADE, x.gravidade) : "não classificada"}`);
  if (x.risco_imediato) L.push("⚠ RISCO IMEDIATO informado pelo denunciante.");
  if (x.retaliacao) L.push("⚠ AMEAÇA OU RETALIAÇÃO informada pelo denunciante.");
  L.push("");

  L.push("RESUMO:");
  L.push(x.resumo?.trim() || "(resumo objetivo ainda não redigido pelo Comitê)");
  L.push("");

  if (x.ocorrencia_data || x.local_ocorrencia) {
    L.push(`OCORRÊNCIA: ${fmtData(x.ocorrencia_data)}${x.ocorrencia_hora ? ` às ${x.ocorrencia_hora}` : ""}${
      x.local_ocorrencia ? ` — ${x.local_ocorrencia}` : ""}`);
  }
  if (x.denunciado_nome || x.denunciado_informado) {
    L.push(`DENUNCIADO: ${x.denunciado_nome || x.denunciado_informado}${
      x.denunciado_funcao ? ` (${x.denunciado_funcao})` : ""}`);
  }
  L.push(`RESPONSÁVEL PELA APURAÇÃO: ${x.apuracao_responsavel || "não designado"}`);
  L.push("");

  const pendentes = d.providencias.filter((p) => p.situacao === "pendente" || p.situacao === "em_andamento");
  L.push(`PROVIDÊNCIAS: ${d.providencias.length} registrada(s), ${pendentes.length} em aberto.`);
  for (const p of pendentes.slice(0, 5)) {
    L.push(`  · ${p.descricao}${p.prazo ? ` (prazo ${fmtData(p.prazo)})` : ""}${
      p.responsavel ? ` — ${p.responsavel}` : ""}`);
  }
  if (x.pendencia_atual) L.push(`PENDÊNCIA ATUAL: ${x.pendencia_atual}`);
  L.push("");

  L.push(`EVIDÊNCIAS: ${d.anexos.length} arquivo(s) anexado(s).`);
  if (x.evidencias_analise) L.push(`Análise: ${x.evidencias_analise}`);
  L.push("");

  if (x.resultado) {
    L.push(`RESULTADO: ${rotulo(LABEL_RESULTADO, x.resultado)}`);
    if (x.medida_principal) L.push(`Medida principal: ${rotulo(LABEL_MEDIDA, x.medida_principal)}`);
    if ((x.medidas ?? []).length) {
      L.push(`Medidas: ${(x.medidas ?? []).map((m) => rotulo(LABEL_MEDIDA, m)).join(", ")}`);
    }
    if (x.recomendacao) L.push(`Recomendação do Comitê: ${rotulo(LABEL_RECOMENDACAO, x.recomendacao)}`);
    if (x.causa_raiz) L.push(`Causa raiz: ${rotulo(LABEL_CAUSA, x.causa_raiz)}`);
  } else {
    L.push("RESULTADO: apuração em andamento.");
  }
  L.push("");

  if (x.decisao_final) {
    L.push(`DECISÃO DA PRESIDÊNCIA (${fmtData(x.decisao_em)}): ${
      x.decisao_sobre_parecer ? rotulo(LABEL_DECISAO, x.decisao_sobre_parecer) : ""}`);
    L.push(x.decisao_final);
    if (x.decisao_medidas) L.push(`Medidas determinadas: ${x.decisao_medidas}`);
  } else if (x.status === "aguardando_presidencia") {
    L.push("DECISÃO DA PRESIDÊNCIA: aguardando.");
  }

  if (x.concluido_em) L.push(`\nCONCLUÍDO EM ${fmtDataHora(x.concluido_em)}`);

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ----------------------------------------------------------- linha da planilha

/**
 * Uma denúncia como uma linha da planilha de controle do Comitê. As chaves
 * viram o cabeçalho do Excel, e a ordem delas é a ordem das colunas.
 */
export function linhaPlanilha(d: DadosDossie): Record<string, string | number> {
  const x = d.denuncia;
  const pendentes = d.providencias.filter((p) => p.situacao === "pendente" || p.situacao === "em_andamento");
  return {
    "Protocolo": x.protocolo,
    "Empresa": x.empresa_nome ?? "",
    "Contrato": x.contrato || x.contrato_informado || "",
    "Registrada em": fmtDataHora(x.created_at),
    "Origem": x.origem ?? "",
    "Situação": rotulo(LABEL_SITUACAO, x.status),
    "Assunto": x.titulo ?? "",
    "Tipo": rotulo(LABEL_TIPO, x.tipo_classificado || x.tipo_denuncia),
    "Gravidade": x.gravidade ? rotulo(LABEL_GRAVIDADE, x.gravidade) : "",
    "Risco imediato": x.risco_imediato ? "Sim" : "Não",
    "Retaliação": x.retaliacao ? "Sim" : "Não",
    "Anônima": x.anonimo ? "Sim" : "Não",
    "Denunciado": x.denunciado_nome || x.denunciado_informado || "",
    "Função do denunciado": x.denunciado_funcao ?? "",
    "Setor": x.setor ?? "",
    "Unidade": x.unidade ?? "",
    "Cidade": x.cidade ?? "",
    "Data da ocorrência": fmtData(x.ocorrencia_data),
    "Responsável pela apuração": x.apuracao_responsavel ?? "",
    "Primeira providência": fmtData(x.primeira_providencia_em),
    "Início da apuração": fmtData(x.apuracao_inicio),
    "Conclusão da apuração": fmtData(x.apuracao_fim),
    "Providências": d.providencias.length,
    "Providências em aberto": pendentes.length,
    "Pendência atual": x.pendencia_atual ?? "",
    "Anexos": d.anexos.length,
    "Resultado": x.resultado ? rotulo(LABEL_RESULTADO, x.resultado) : "",
    "Medida principal": x.medida_principal ? rotulo(LABEL_MEDIDA, x.medida_principal) : "",
    "Medidas": (x.medidas ?? []).map((m) => rotulo(LABEL_MEDIDA, m)).join(", "),
    "Recomendação": x.recomendacao ? rotulo(LABEL_RECOMENDACAO, x.recomendacao) : "",
    "Causa raiz": x.causa_raiz ? rotulo(LABEL_CAUSA, x.causa_raiz) : "",
    "Ações corretivas": x.acoes_corretivas ?? "",
    "Ações preventivas": x.acoes_preventivas ?? "",
    "Decisão da Presidência": x.decisao_final ?? "",
    "Data da decisão": fmtData(x.decisao_em),
    "Decisão sobre o parecer": x.decisao_sobre_parecer ? rotulo(LABEL_DECISAO, x.decisao_sobre_parecer) : "",
    "Última movimentação": fmtDataHora(x.ultima_movimentacao_em),
    "Concluída em": fmtDataHora(x.concluido_em),
  };
}
