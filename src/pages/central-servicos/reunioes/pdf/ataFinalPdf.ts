// PDF final da ata — gerado depois que o responsável preenche as respostas:
// pauta + respostas de cada tópico, com as assinaturas (livres/opcionais) no
// rodapé do documento. Assuntos fora da pauta entram como itens de pauta
// (reuniao_pauta.fora_pauta = true), marcados e com a classificação/tratativa.
import { PdfDocumento, fmtDataHoraPdf } from "@/lib/pdf/PdfDocumento";
import type { Reuniao, ReuniaoAssinatura, ReuniaoAssuntoForaPauta, ReuniaoComentario, ReuniaoPauta, ReuniaoResposta, Usuario } from "../types";
import { CLASSIFICACAO_ASSUNTO_LABEL, TRATATIVA_ASSUNTO_LABEL, nomeUsuario } from "../types";

function montarAtaFinalPdf(
  reuniao: Reuniao,
  pauta: ReuniaoPauta[],
  respostas: ReuniaoResposta[],
  assinaturas: ReuniaoAssinatura[],
  usuarios: Usuario[],
  comentarios: ReuniaoComentario[],
  assuntosForaPauta: ReuniaoAssuntoForaPauta[],
): PdfDocumento {
  const pdf = new PdfDocumento(reuniao.titulo, reuniao.id);
  pdf.tituloSecao("Ata de Reunião", 18);

  pdf.paragrafo(`Data e horário: ${fmtDataHoraPdf(reuniao.data_hora)}`, { negrito: true, tamanho: 10, espacoDepois: 1 });
  if (reuniao.tipo_local === "hibrido") {
    pdf.paragrafo(`Local: ${reuniao.local_ou_link}`, { tamanho: 10, espacoDepois: 1 });
    pdf.paragrafo(`Link: ${reuniao.link_online ?? "—"}`, { tamanho: 10, espacoDepois: 1 });
  } else {
    pdf.paragrafo(`${reuniao.tipo_local === "presencial" ? "Local" : "Link"}: ${reuniao.local_ou_link}`, { tamanho: 10, espacoDepois: 1 });
  }
  if (reuniao.objetivo) {
    pdf.paragrafo(`Objetivo: ${reuniao.objetivo}`, { tamanho: 10, espacoDepois: 3 });
  }

  pdf.y += 3;
  pdf.tituloSecao("Pauta e Respostas", 13);
  if (pauta.length === 0) {
    pdf.paragrafo("Nenhum tópico de pauta cadastrado.", { tamanho: 9.5 });
  } else {
    pauta.forEach((p, i) => {
      const resposta = respostas.find((r) => r.pauta_id === p.id);
      const assunto = p.fora_pauta ? assuntosForaPauta.find((a) => a.pauta_id === p.id) : undefined;
      pdf.garantirEspaco(24);
      pdf.paragrafo(`${i + 1}. ${p.titulo_topico}${p.fora_pauta ? " (Assunto fora da pauta)" : ""}`, { negrito: true, tamanho: 10.5, espacoDepois: 1 });
      if (p.descricao) pdf.paragrafo(p.descricao, { tamanho: 9, cor: [120, 120, 120], espacoDepois: 1.5 });
      if (assunto) {
        const detalhes = [
          `Classificação: ${CLASSIFICACAO_ASSUNTO_LABEL[assunto.classificacao]}`,
          `Tratativa: ${TRATATIVA_ASSUNTO_LABEL[assunto.tratativa]}`,
          assunto.responsavel_tratativa_user_id ? `Responsável: ${nomeUsuario(usuarios, assunto.responsavel_tratativa_user_id) ?? "—"}` : null,
          assunto.data_prevista ? `Data prevista: ${new Date(`${assunto.data_prevista}T00:00:00`).toLocaleDateString("pt-BR")}` : null,
          `Reunião futura necessária: ${assunto.reuniao_futura_necessaria ? "Sim" : "Não"}`,
        ].filter(Boolean).join(" · ");
        pdf.paragrafo(detalhes, { tamanho: 9, cor: [120, 120, 120], espacoDepois: 1.5 });
      }
      pdf.paragrafo(`Resposta: ${resposta?.texto_resposta || "—"}`, { tamanho: 9.5, espacoDepois: 1 });
      if (resposta?.encaminhamento) {
        pdf.paragrafo(`Encaminhamento: ${resposta.encaminhamento}`, { tamanho: 9.5, espacoDepois: 1 });
      }
      pdf.y += 3;
    });
  }

  pdf.y += 3;
  pdf.tituloSecao("Encaminhamentos", 13);
  if (comentarios.length === 0) {
    pdf.paragrafo("Nenhum encaminhamento registrado.", { tamanho: 9.5 });
  } else {
    comentarios.forEach((c) => {
      pdf.garantirEspaco(14);
      pdf.paragrafo(`${nomeUsuario(usuarios, c.autor_id) ?? "Usuário"} — ${fmtDataHoraPdf(c.created_at)}`, { negrito: true, tamanho: 9, espacoDepois: 1 });
      pdf.paragrafo(c.texto, { tamanho: 9.5, espacoDepois: 2 });
    });
  }

  pdf.y += 4;
  pdf.blocoAssinaturasColuna(
    "Diretoria e demais participantes",
    assinaturas.map((a) => ({ nome: nomeUsuario(usuarios, a.user_id) ?? "Usuário", created_at: a.created_at })),
  );

  return pdf;
}

export function exportarAtaFinalPdf(
  reuniao: Reuniao,
  pauta: ReuniaoPauta[],
  respostas: ReuniaoResposta[],
  assinaturas: ReuniaoAssinatura[],
  usuarios: Usuario[],
  comentarios: ReuniaoComentario[],
  assuntosForaPauta: ReuniaoAssuntoForaPauta[] = [],
) {
  const pdf = montarAtaFinalPdf(reuniao, pauta, respostas, assinaturas, usuarios, comentarios, assuntosForaPauta);
  pdf.salvar(`Ata-${reuniao.titulo.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`);
}

// Mesma geração, mas devolve um Blob em vez de disparar o download — usado
// ao encerrar a reunião pra subir automaticamente pro Storage e permitir o
// envio por e-mail feito pelo worker externo.
export function gerarAtaFinalPdfBlob(
  reuniao: Reuniao,
  pauta: ReuniaoPauta[],
  respostas: ReuniaoResposta[],
  assinaturas: ReuniaoAssinatura[],
  usuarios: Usuario[],
  comentarios: ReuniaoComentario[],
  assuntosForaPauta: ReuniaoAssuntoForaPauta[] = [],
): Blob {
  const pdf = montarAtaFinalPdf(reuniao, pauta, respostas, assinaturas, usuarios, comentarios, assuntosForaPauta);
  return pdf.doc.output("blob");
}
