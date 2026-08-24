import { useState } from "react";
import * as XLSX from "xlsx";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { FileDown, FileSpreadsheet, ClipboardCopy, Check, Loader2 } from "lucide-react";
import { PdfDocumento, NAVY, NAVY_SUAVE } from "@/lib/pdf/PdfDocumento";
import {
  linhaDoTempo, linhaPlanilha, resumoGerencial, fmtDataHora, fmtData, bytesLegivel,
  type DadosDossie, type Mensagem,
} from "./dossie";
import {
  LABEL_GRAVIDADE, LABEL_RELACAO, LABEL_RESULTADO, LABEL_SITUACAO, LABEL_TIPO,
  LABEL_FREQUENCIA, LABEL_CONTRATO_SIT, LABEL_SIM_NAO, rotulo,
} from "./vocabulario";
import type { Anexo, Denuncia, Evento, Providencia } from "./metricas";

// =====================================================================
// EXPORTAÇÃO DO PROCEDIMENTO — PDF cronológico, Excel gerencial e o
// resumo para a planilha de controle.
//
// Os três saem dos MESMOS dados e da MESMA linha do tempo (dossie.ts): um
// procedimento de ética que se conta diferente conforme o formato não serve
// como prova de nada.
//
// DECISÕES QUE VALEM COMENTÁRIO
//   · O PDF tem duas versões. A completa leva nota interna, entrevista e
//     anexo sigiloso; a "para terceiros" não leva nada disso. Quem exporta
//     escolhe, e o próprio documento diz na capa qual das duas é — um PDF
//     que sai da empresa sem essa marca é um vazamento esperando acontecer.
//   · A identidade do denunciante só entra se quem exporta puder vê-la. A
//     visão v_canal_denuncia já devolve os campos em branco para quem não
//     tem `comite_etica_sigilo`, então isto aqui não precisa decidir nada:
//     o que não veio, não sai.
//   · O ZIP dos anexos NÃO é montado aqui. Os arquivos podem somar centenas
//     de MB de vídeo, e cada um já tem URL assinada na aba de anexos.
// =====================================================================

async function carregar(denunciaId: string): Promise<DadosDossie> {
  const [d, e, m, p, a] = await Promise.all([
    db.from("v_canal_denuncia").select("*").eq("id", denunciaId).single(),
    db.from("CANAL_DENUNCIA_EVENTO").select("*").eq("denuncia_id", denunciaId).order("created_at"),
    db.from("CANAL_DENUNCIA_MENSAGEM").select("*").eq("denuncia_id", denunciaId).order("created_at"),
    db.from("CANAL_DENUNCIA_PROVIDENCIA").select("*").eq("denuncia_id", denunciaId).order("ordem"),
    db.from("CANAL_DENUNCIA_ANEXO").select("*").eq("denuncia_id", denunciaId).order("created_at"),
  ]);
  if (d.error) throw d.error;
  return {
    denuncia: d.data as Denuncia,
    eventos: (e.data ?? []) as Evento[],
    mensagens: (m.data ?? []) as Mensagem[],
    providencias: (p.data ?? []) as Providencia[],
    anexos: (a.data ?? []) as Anexo[],
  };
}

/** Cabeçalho de cada bloco de leitura do PDF. */
function campo(pdf: PdfDocumento, rot: string, valor?: string | null) {
  const v = (valor ?? "").toString().trim();
  if (!v) return;
  pdf.paragrafo(rot.toUpperCase(), { negrito: true, tamanho: 7.5, cor: NAVY_SUAVE, espacoDepois: 0.5 });
  pdf.paragrafo(v, { tamanho: 9.5, espacoDepois: 3 });
}

function gerarPdf(dados: DadosDossie, completo: boolean) {
  const x = dados.denuncia;
  const pdf = new PdfDocumento(`Procedimento ${x.protocolo}`, x.id);

  // A capa diz o que este documento é. Um PDF de canal de ética circulando
  // sem esta linha não deixa ninguém saber se pode ou não ser encaminhado.
  pdf.paragrafo(
    completo
      ? "DOCUMENTO INTERNO E CONFIDENCIAL — contém notas de trabalho, entrevistas e anexos sigilosos. Restrito ao Comitê de Ética e à Presidência."
      : "DOCUMENTO CONFIDENCIAL — versão sem notas internas, entrevistas e anexos sigilosos.",
    { negrito: true, tamanho: 8.5, cor: [180, 40, 40], espacoDepois: 6 },
  );

  pdf.tituloSecao("Identificação", 13);
  campo(pdf, "Protocolo", x.protocolo);
  campo(pdf, "Situação", rotulo(LABEL_SITUACAO, x.status));
  campo(pdf, "Empresa", x.empresa_nome);
  campo(pdf, "Contrato informado", x.contrato_informado
    ? `${x.contrato_informado}${x.contrato_situacao ? ` (${rotulo(LABEL_CONTRATO_SIT, x.contrato_situacao)})` : ""}`
    : (x.contrato_situacao ? rotulo(LABEL_CONTRATO_SIT, x.contrato_situacao) : null));
  campo(pdf, "Contrato (leitura do Comitê)", x.contrato);
  campo(pdf, "Registrada em", fmtDataHora(x.created_at));
  campo(pdf, "Origem", x.origem);

  pdf.tituloSecao("Denunciante", 13);
  if (x.anonimo) {
    pdf.paragrafo("Relato anônimo. O canal não guarda identidade, IP nem qualquer dado que permita chegar a quem denunciou.",
      { tamanho: 9.5, espacoDepois: 3 });
  } else if (x.identidade_restrita) {
    pdf.paragrafo("A pessoa se identificou, mas quem gerou este documento não tem permissão para ver a identificação.",
      { tamanho: 9.5, espacoDepois: 3 });
  } else if (x.identificado) {
    campo(pdf, "Nome", x.nome_completo);
    campo(pdf, "CPF", x.cpf);
    campo(pdf, "E-mail", x.email);
    campo(pdf, "Telefone", [x.telefone_fixo, x.celular].filter(Boolean).join(" / "));
  } else {
    pdf.paragrafo("A pessoa optou por não se identificar, mas deixou e-mail para acompanhamento.",
      { tamanho: 9.5, espacoDepois: 3 });
  }
  campo(pdf, "Relação com o grupo", rotulo(LABEL_RELACAO, x.relacao));

  pdf.tituloSecao("O relato, como foi recebido", 13);
  pdf.paragrafo("Texto preservado exatamente como registrado. O sistema recusa qualquer alteração nele.",
    { tamanho: 8, cor: NAVY_SUAVE, espacoDepois: 3 });
  campo(pdf, "Tipo informado", rotulo(LABEL_TIPO, x.tipo_denuncia));
  campo(pdf, "Quando aconteceu", x.ocorrencia_data
    ? `${fmtData(x.ocorrencia_data)}${x.ocorrencia_hora ? ` às ${x.ocorrencia_hora}` : ""}${
        x.ocorrencia_frequencia ? ` · ${rotulo(LABEL_FREQUENCIA, x.ocorrencia_frequencia)}` : ""}`
    : null);
  campo(pdf, "Local", x.local_ocorrencia);
  campo(pdf, "Como soube", x.como_soube);
  campo(pdf, "Pessoa denunciada (segundo o denunciante)",
    x.denunciado_informado ? `${x.denunciado_informado}${x.denunciado_funcao ? ` — ${x.denunciado_funcao}` : ""}` : null);
  if (x.risco_imediato) campo(pdf, "⚠ Risco imediato", x.risco_imediato_detalhe || "Informado pelo denunciante.");
  if (x.retaliacao) campo(pdf, "⚠ Ameaça ou retaliação", x.retaliacao_detalhe || "Informada pelo denunciante.");
  campo(pdf, "Descrição dos fatos", x.descricao);
  campo(pdf, "Testemunhas", x.testemunhas);
  campo(pdf, "Evidências descritas", x.evidencias);
  campo(pdf, "Valor envolvido", x.valor_financeiro);
  campo(pdf, "Liderança ciente", x.lideranca_ciente
    ? `${rotulo(LABEL_SIM_NAO, x.lideranca_ciente)}${x.lideranca_ciente_quem ? ` — ${x.lideranca_ciente_quem}` : ""}` : null);
  campo(pdf, "Liderança envolvida", x.lideranca_envolvida
    ? `${rotulo(LABEL_SIM_NAO, x.lideranca_envolvida)}${x.lideranca_envolvida_quem ? ` — ${x.lideranca_envolvida_quem}` : ""}` : null);
  campo(pdf, "Liderança tentou ocultar", x.lideranca_ocultou
    ? `${rotulo(LABEL_SIM_NAO, x.lideranca_ocultou)}${x.lideranca_ocultou_quem ? ` — ${x.lideranca_ocultou_quem}` : ""}` : null);
  campo(pdf, "Sugestão do denunciante", x.sugestao);

  pdf.tituloSecao("Apuração", 13);
  campo(pdf, "Resumo do Comitê", x.resumo);
  campo(pdf, "Tipo classificado", x.tipo_classificado ? rotulo(LABEL_TIPO, x.tipo_classificado) : null);
  campo(pdf, "Gravidade", x.gravidade ? rotulo(LABEL_GRAVIDADE, x.gravidade) : null);
  campo(pdf, "Denunciado (confirmado)", x.denunciado_nome);
  campo(pdf, "Líder imediato", x.lider_nome);
  campo(pdf, "Diretoria / Setor / Unidade", [x.diretoria, x.setor, x.unidade, x.cidade].filter(Boolean).join(" · "));
  campo(pdf, "Responsável pela apuração", x.apuracao_responsavel);
  campo(pdf, "Primeira providência", fmtDataHora(x.primeira_providencia_em));
  campo(pdf, "Período da apuração", [fmtData(x.apuracao_inicio), fmtData(x.apuracao_fim)].join(" a "));
  campo(pdf, "Pendência atual", x.pendencia_atual);
  campo(pdf, "Evidências analisadas", x.evidencias_analise);

  if (dados.providencias.length) {
    pdf.tituloSecao("Providências", 13);
    for (const p of dados.providencias) {
      pdf.paragrafo(`${p.ordem}. ${p.descricao}`, { negrito: true, tamanho: 9.5, espacoDepois: 1 });
      pdf.paragrafo([
        `Situação: ${p.situacao}`,
        p.responsavel ? `Responsável: ${p.responsavel}` : null,
        p.prazo ? `Prazo: ${fmtData(p.prazo)}` : null,
        p.concluida_em ? `Concluída em ${fmtData(p.concluida_em)}` : null,
      ].filter(Boolean).join(" · "), { tamanho: 8.5, cor: NAVY_SUAVE, espacoDepois: 3 });
      if (p.observacao) pdf.paragrafo(p.observacao, { tamanho: 9, espacoDepois: 4 });
    }
  }

  pdf.tituloSecao("Resultado", 13);
  campo(pdf, "Resultado da apuração", x.resultado ? rotulo(LABEL_RESULTADO, x.resultado) : "Ainda em apuração");
  campo(pdf, "Medida principal", x.medida_principal);
  campo(pdf, "Medidas aplicadas", (x.medidas ?? []).join(", "));
  campo(pdf, "Recomendação do Comitê", x.recomendacao);
  campo(pdf, "Causa raiz", [x.causa_raiz, x.causa_raiz_detalhe].filter(Boolean).join(" — "));
  campo(pdf, "Ações corretivas", x.acoes_corretivas);
  campo(pdf, "Ações preventivas", x.acoes_preventivas);
  if (completo) campo(pdf, "Fundamentação do parecer", x.parecer_interno);
  campo(pdf, "Retorno dado ao denunciante", x.retorno_denunciante);

  if (x.decisao_final) {
    pdf.tituloSecao("Decisão da Presidência", 13);
    campo(pdf, "Decisão", x.decisao_final);
    campo(pdf, "Sobre a recomendação do Comitê", x.decisao_sobre_parecer);
    campo(pdf, "Fundamentação", x.decisao_fundamentacao);
    campo(pdf, "Medidas determinadas", x.decisao_medidas);
    campo(pdf, "Registrada por", `${x.decisao_por_nome ?? "—"} em ${fmtDataHora(x.decisao_em)}`);
  }

  // ---- o fio cronológico ----
  pdf.tituloSecao("Histórico cronológico", 13);
  pdf.paragrafo(
    "Cada linha traz data, hora e quem registrou. As mudanças de situação e de campo são gravadas automaticamente pelo sistema — não são digitadas.",
    { tamanho: 8, cor: NAVY_SUAVE, espacoDepois: 4 },
  );
  const linhas = linhaDoTempo(dados, completo);
  for (const l of linhas) {
    pdf.garantirEspaco(16);
    pdf.paragrafo(`${fmtDataHora(l.quando)}${l.autor ? ` · ${l.autor}` : ""}`,
      { tamanho: 7.5, cor: NAVY_SUAVE, espacoDepois: 0.5 });
    pdf.paragrafo(l.titulo, { negrito: true, tamanho: 9.5, espacoDepois: l.detalhe ? 1 : 4 });
    if (l.detalhe) pdf.paragrafo(l.detalhe, { tamanho: 9, espacoDepois: 4 });
  }

  const anexosVisiveis = dados.anexos.filter((a) => completo || !a.sensivel);
  pdf.tituloSecao("Anexos", 13);
  if (!anexosVisiveis.length) {
    pdf.paragrafo("Nenhum arquivo anexado a este procedimento.", { tamanho: 9.5 });
  } else {
    for (const a of anexosVisiveis) {
      pdf.paragrafo(
        `${a.nome_arquivo} — ${bytesLegivel(a.tamanho_bytes)} · ${a.categoria} · ${
          a.origem === "denunciante" ? "enviado pelo denunciante" : `juntado pelo ${a.origem}`
        }${a.sensivel ? " · SIGILOSO" : ""} · ${fmtDataHora(a.created_at)}`,
        { tamanho: 9, espacoDepois: 2 },
      );
    }
    const ocultos = dados.anexos.length - anexosVisiveis.length;
    if (ocultos > 0) {
      pdf.paragrafo(`${ocultos} anexo(s) sigiloso(s) não constam desta versão do documento.`,
        { tamanho: 8.5, cor: NAVY_SUAVE });
    }
  }

  pdf.salvar(`${x.protocolo}${completo ? "" : "-sem-sigilosos"}.pdf`);
}

function gerarExcel(dados: DadosDossie) {
  const x = dados.denuncia;
  const wb = XLSX.utils.book_new();

  // Aba 1: a linha da planilha de controle, em pé (rótulo | valor). Uma
  // denúncia só em formato de tabela larga seria ilegível.
  const resumo = linhaPlanilha(dados);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    Object.entries(resumo).map(([Campo, Valor]) => ({ Campo, Valor })),
  ), "Procedimento");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    linhaDoTempo(dados, true).map((l) => ({
      "Data e hora": fmtDataHora(l.quando),
      "Tipo": l.tipo,
      "Registro": l.titulo,
      "Detalhe": l.detalhe ?? "",
      "Responsável": l.autor ?? "",
    })),
  ), "Histórico");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    dados.providencias.map((p) => ({
      "#": p.ordem, "Providência": p.descricao, "Responsável": p.responsavel ?? "",
      "Prazo": fmtData(p.prazo), "Situação": p.situacao,
      "Concluída em": fmtData(p.concluida_em), "Observação": p.observacao ?? "",
    })),
  ), "Providências");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    dados.anexos.map((a) => ({
      "Arquivo": a.nome_arquivo, "Categoria": a.categoria, "Origem": a.origem,
      "Sigiloso": a.sensivel ? "Sim" : "Não", "Tamanho": bytesLegivel(a.tamanho_bytes),
      "Anexado em": fmtDataHora(a.created_at), "Descrição": a.descricao ?? "",
    })),
  ), "Anexos");

  XLSX.writeFile(wb, `${x.protocolo}.xlsx`);
}

export function ExportarDenuncia({ denunciaId }: { denunciaId: string }) {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiou, setCopiou] = useState(false);

  const rodar = async (acao: string, fn: (d: DadosDossie) => void) => {
    if (ocupado) return;
    setOcupado(acao);
    try {
      fn(await carregar(denunciaId));
    } catch (e) {
      toast({
        title: "Não foi possível exportar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setOcupado(null);
    }
  };

  const copiarResumo = () =>
    rodar("resumo", async (d) => {
      await navigator.clipboard.writeText(resumoGerencial(d));
      setCopiou(true);
      setTimeout(() => setCopiou(false), 2500);
      toast({ title: "Resumo copiado", description: "Cole na planilha de controle do Comitê." });
    });

  const Ic = ({ nome }: { nome: string }) =>
    ocupado === nome ? <Loader2 className="h-4 w-4 animate-spin" /> : null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" className="gap-1.5" disabled={!!ocupado}
              onClick={() => rodar("pdf", (d) => gerarPdf(d, true))}>
        <Ic nome="pdf" /><FileDown className="h-4 w-4" /> PDF completo
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" disabled={!!ocupado}
              onClick={() => rodar("pdf-limpo", (d) => gerarPdf(d, false))}>
        <Ic nome="pdf-limpo" /><FileDown className="h-4 w-4" /> PDF sem sigilosos
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" disabled={!!ocupado}
              onClick={() => rodar("xlsx", gerarExcel)}>
        <Ic nome="xlsx" /><FileSpreadsheet className="h-4 w-4" /> Excel
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" disabled={!!ocupado}
              onClick={copiarResumo}>
        {copiou ? <Check className="h-4 w-4 text-success" /> : <ClipboardCopy className="h-4 w-4" />}
        {copiou ? "Copiado" : "Resumo gerencial"}
      </Button>
    </div>
  );
}

/** Exportação da LISTA inteira — a base gerencial para filtro e acompanhamento. */
export function ExportarLista({ denuncias }: { denuncias: Denuncia[] }) {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState(false);

  const exportar = async () => {
    if (ocupado || !denuncias.length) return;
    setOcupado(true);
    try {
      const ids = denuncias.map((d) => d.id);
      // Providências e anexos de todas as denúncias de uma vez: uma consulta
      // por linha faria 300 idas ao banco para exportar 300 casos.
      const [p, a] = await Promise.all([
        db.from("CANAL_DENUNCIA_PROVIDENCIA").select("*").in("denuncia_id", ids),
        db.from("CANAL_DENUNCIA_ANEXO").select("*").in("denuncia_id", ids),
      ]);
      const provs = (p.data ?? []) as Providencia[];
      const anexos = (a.data ?? []) as Anexo[];

      const linhas = denuncias.map((d) => linhaPlanilha({
        denuncia: d, eventos: [], mensagens: [],
        providencias: provs.filter((x) => x.denuncia_id === d.id),
        anexos: anexos.filter((x) => x.denuncia_id === d.id),
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Denúncias");
      XLSX.writeFile(wb, `comite-etica-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast({
        title: "Não foi possível exportar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Button variant="outline" className="gap-1.5" onClick={exportar} disabled={ocupado || !denuncias.length}>
      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
      Exportar Excel
    </Button>
  );
}
