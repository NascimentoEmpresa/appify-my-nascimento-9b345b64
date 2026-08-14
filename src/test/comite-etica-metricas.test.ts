import { describe, it, expect } from "vitest";
import {
  type Denuncia, type RegraSla, antecedentesDe,
  concluida, contarPor, diasAtePrimeiraProvidencia, diasDeTratamento, diasRestantes,
  dentroDoSla, causaSistemica, gerouTreinamento, media, pct, procedente,
  regraDe, reincidencias, serieMensal, temMedidaDisciplinar, tipoEfetivo, vencida,
} from "@/pages/comite-etica/metricas";

// =====================================================================
// A conta dos indicadores do Comitê de Ética.
//
// É a parte que ninguém confere no olho: um erro de sinal em "dentro do
// SLA" ou uma reincidência contada antes da medida vira relatório errado
// para a diretoria sem nenhum sintoma na tela.
// =====================================================================

const SLAS: RegraSla[] = [
  { gravidade: "critica", dias: 10, dias_primeira_providencia: 1 },
  { gravidade: "alta", dias: 20, dias_primeira_providencia: 2 },
  { gravidade: "media", dias: 30, dias_primeira_providencia: 3 },
  { gravidade: "baixa", dias: 45, dias_primeira_providencia: 5 },
];

const DIA = 86_400_000;
const haDias = (n: number) => new Date(Date.now() - n * DIA).toISOString();

/** Denúncia mínima; cada teste sobrescreve só o que interessa. */
const nova = (over: Partial<Denuncia> = {}): Denuncia => ({
  id: Math.random().toString(36).slice(2), protocolo: "DEN-2026-00001", identificado: false,
  nome_completo: null, cpf: null, email: null, data_nascimento: null,
  telefone_fixo: null, celular: null,
  relacao: "colaborador", tipo_denuncia: "assedio_moral", local_ocorrencia: null,
  como_soube: "presenciei",
  lideranca_ciente: null, lideranca_envolvida: null, lideranca_ocultou: null,
  lideranca_ciente_quem: null, lideranca_envolvida_quem: null, lideranca_ocultou_quem: null,
  descricao: "relato", testemunhas: null, evidencias: null,
  valor_financeiro: null, sugestao: null,
  origem: "canal_web", tipo_classificado: null, gravidade: null, sigilo: null,
  denunciado_nome: null, denunciado_empregado_id: null,
  lider_nome: null, lider_empregado_id: null,
  diretoria: null, contrato: null, setor: null, unidade: null, cidade: null,
  apuracao_responsavel: null, apuracao_inicio: null, apuracao_fim: null,
  primeira_providencia_em: null,
  resultado: null, medidas: [], houve_recurso: false, recurso_resultado: null, recurso_data: null,
  causa_raiz: null, causa_raiz_detalhe: null, acoes_preventivas: null, acoes_corretivas: null,
  sla_dias_override: null,
  status: "nova", parecer_interno: null, retorno_denunciante: null,
  concluido_em: null, created_at: haDias(0), updated_at: haDias(0),
  ...over,
});

describe("situação e prazo", () => {
  it("só julgada e encerrada param o cronômetro", () => {
    expect(concluida(nova({ status: "nova" }))).toBe(false);
    expect(concluida(nova({ status: "investigacao" }))).toBe(false);
    expect(concluida(nova({ status: "aguardando_documentos" }))).toBe(false);
    expect(concluida(nova({ status: "julgada" }))).toBe(true);
    expect(concluida(nova({ status: "encerrada" }))).toBe(true);
  });

  it("o prazo vem da gravidade, e o override do caso vence a régua", () => {
    expect(regraDe(nova({ gravidade: "critica" }), SLAS).dias).toBe(10);
    expect(regraDe(nova({ gravidade: "baixa" }), SLAS).dias).toBe(45);
    expect(regraDe(nova({ gravidade: "critica", sla_dias_override: 3 }), SLAS).dias).toBe(3);
  });

  it("sem gravidade classificada cai no padrão de 30 dias", () => {
    expect(regraDe(nova({ gravidade: null }), SLAS).dias).toBe(30);
  });

  it("caso em aberto conta os dias até hoje, não até a última edição", () => {
    // Sem isso, processo esquecido há meses apareceria com 0 dias e nunca
    // entraria na fila de vencidos.
    const d = nova({ status: "investigacao", created_at: haDias(40), updated_at: haDias(38) });
    expect(diasDeTratamento(d)).toBe(40);
  });

  it("caso concluído conta até a conclusão", () => {
    const d = nova({ status: "encerrada", created_at: haDias(40), concluido_em: haDias(25) });
    expect(diasDeTratamento(d)).toBe(15);
  });

  it("vencida é só quem está em aberto e passou do prazo", () => {
    const atrasada = nova({ status: "investigacao", gravidade: "critica", created_at: haDias(15) });
    const noPrazo = nova({ status: "investigacao", gravidade: "baixa", created_at: haDias(15) });
    const fechadaTarde = nova({ status: "encerrada", gravidade: "critica", created_at: haDias(90), concluido_em: haDias(1) });

    expect(vencida(atrasada, SLAS)).toBe(true);
    expect(vencida(noPrazo, SLAS)).toBe(false);
    expect(vencida(fechadaTarde, SLAS)).toBe(false);   // já concluída não é "pendente vencida"
  });

  it("dias restantes fica negativo quando venceu e nulo quando concluída", () => {
    expect(diasRestantes(nova({ status: "investigacao", gravidade: "critica", created_at: haDias(14) }), SLAS)).toBe(-4);
    expect(diasRestantes(nova({ status: "encerrada" }), SLAS)).toBeNull();
  });

  it("dentro do SLA só responde para caso concluído", () => {
    expect(dentroDoSla(nova({ status: "investigacao" }), SLAS)).toBeNull();
    expect(dentroDoSla(nova({ status: "encerrada", gravidade: "alta", created_at: haDias(30), concluido_em: haDias(15) }), SLAS)).toBe(true);
    expect(dentroDoSla(nova({ status: "encerrada", gravidade: "alta", created_at: haDias(60), concluido_em: haDias(15) }), SLAS)).toBe(false);
  });

  it("tempo até a primeira providência é nulo enquanto não houve nenhuma", () => {
    expect(diasAtePrimeiraProvidencia(nova())).toBeNull();
    expect(diasAtePrimeiraProvidencia(nova({ created_at: haDias(10), primeira_providencia_em: haDias(7) }))).toBe(3);
  });
});

describe("classificação", () => {
  it("a leitura do comitê prevalece sobre o palpite do denunciante", () => {
    expect(tipoEfetivo(nova({ tipo_denuncia: "outro", tipo_classificado: "fraude" }))).toBe("fraude");
    expect(tipoEfetivo(nova({ tipo_denuncia: "outro", tipo_classificado: null }))).toBe("outro");
  });

  it("parcialmente procedente conta como procedente", () => {
    expect(procedente(nova({ resultado: "procedente" }))).toBe(true);
    expect(procedente(nova({ resultado: "parcialmente_procedente" }))).toBe(true);
    expect(procedente(nova({ resultado: "improcedente" }))).toBe(false);
    expect(procedente(nova({ resultado: null }))).toBe(false);
  });

  it("separa medida disciplinar de treinamento", () => {
    expect(temMedidaDisciplinar(nova({ medidas: ["treinamento"] }))).toBe(false);
    expect(temMedidaDisciplinar(nova({ medidas: ["treinamento", "suspensao"] }))).toBe(true);
    expect(gerouTreinamento(nova({ medidas: ["treinamento", "suspensao"] }))).toBe(true);
    expect(temMedidaDisciplinar(nova({ medidas: [] }))).toBe(false);
  });

  it("causa sistêmica é a que aponta para o sistema, não para a pessoa", () => {
    expect(causaSistemica(nova({ causa_raiz: "processo" }))).toBe(true);
    expect(causaSistemica(nova({ causa_raiz: "falha_lideranca" }))).toBe(true);
    expect(causaSistemica(nova({ causa_raiz: "comportamento_individual" }))).toBe(false);
    expect(causaSistemica(nova({ causa_raiz: null }))).toBe(false);
  });
});

describe("agregação", () => {
  it("campo em branco vira 'Não informado' em vez de sumir da conta", () => {
    const r = contarPor([nova({ setor: "Limpeza" }), nova({ setor: "" }), nova({ setor: null })], (d) => d.setor);
    expect(r.find((x) => x.chave === "__vazio__")?.total).toBe(2);
    expect(r.find((x) => x.chave === "Limpeza")?.total).toBe(1);
  });

  it("ordena do maior para o menor", () => {
    const r = contarPor(
      [nova({ contrato: "A" }), nova({ contrato: "B" }), nova({ contrato: "B" })],
      (d) => d.contrato);
    expect(r[0].chave).toBe("B");
  });

  it("a série mensal preenche mês vazio com zero", () => {
    // Buraco na série faria a linha de tendência ligar dois meses distantes
    // e sugerir queda que não houve.
    const s = serieMensal([nova({ created_at: haDias(0) })], 6);
    expect(s).toHaveLength(6);
    expect(s.every((x) => typeof x.total === "number")).toBe(true);
    expect(s[s.length - 1].total).toBe(1);
    expect(s[0].total).toBe(0);
  });

  it("média e porcentagem devolvem null sem amostra, em vez de NaN", () => {
    expect(media([])).toBeNull();
    expect(media([2, 4])).toBe(3);
    expect(pct(1, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
  });
});

describe("reincidência", () => {
  it("quem aparece uma vez só não é reincidente", () => {
    const r = reincidencias(
      [nova({ denunciado_empregado_id: 1, denunciado_nome: "Fulano" })],
      (d) => (d.denunciado_empregado_id ? `#${d.denunciado_empregado_id}` : ""),
      (d) => d.denunciado_nome ?? "—");
    expect(r).toHaveLength(0);
  });

  it("caso sem vínculo com o RH não entra na conta", () => {
    // Contar por nome digitado inflaria a reincidência com grafias diferentes.
    const r = reincidencias(
      [nova({ denunciado_nome: "Fulano" }), nova({ denunciado_nome: "Fulano" })],
      (d) => (d.denunciado_empregado_id ? `#${d.denunciado_empregado_id}` : ""),
      (d) => d.denunciado_nome ?? "—");
    expect(r).toHaveLength(0);
  });

  it("agrupa por id e conta procedentes", () => {
    const r = reincidencias(
      [
        nova({ denunciado_empregado_id: 7, denunciado_nome: "Fulano", resultado: "procedente" }),
        nova({ denunciado_empregado_id: 7, denunciado_nome: "Fulano", resultado: "improcedente" }),
        nova({ denunciado_empregado_id: 7, denunciado_nome: "Fulano", resultado: "parcialmente_procedente" }),
      ],
      (d) => `#${d.denunciado_empregado_id}`,
      (d) => d.denunciado_nome ?? "—");
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(3);
    expect(r[0].procedentes).toBe(2);
  });

  it("'pós-medida' conta só o que veio DEPOIS da medida aplicada", () => {
    // É o número que responde "as medidas estão sendo eficazes": um caso
    // anterior à punição não pode ser contado como recaída.
    const r = reincidencias(
      [
        nova({ denunciado_empregado_id: 9, created_at: haDias(90) }),                     // antes
        nova({ denunciado_empregado_id: 9, created_at: haDias(60), status: "encerrada",
               concluido_em: haDias(50), medidas: ["suspensao"] }),                       // a punição
        nova({ denunciado_empregado_id: 9, created_at: haDias(20) }),                      // recaída
      ],
      (d) => `#${d.denunciado_empregado_id}`,
      () => "Fulano");
    expect(r[0].total).toBe(3);
    expect(r[0].aposMedida).toBe(1);
  });

  it("antecedentes contam só o que veio ANTES do caso aberto", () => {
    const atual = nova({ denunciado_empregado_id: 4, created_at: haDias(10), setor: "Limpeza" });
    const todas = [
      atual,
      nova({ denunciado_empregado_id: 4, created_at: haDias(50), resultado: "procedente" }),  // antes
      nova({ denunciado_empregado_id: 4, created_at: haDias(2) }),                             // depois
    ];
    const a = antecedentesDe(atual, todas);
    const pessoa = a.find((x) => x.rotulo === "Este denunciado");
    expect(pessoa?.total).toBe(1);
    expect(pessoa?.procedentes).toBe(1);
  });

  it("antecedente de setor ignora diferença de caixa e espaço", () => {
    const atual = nova({ setor: "Limpeza", created_at: haDias(5) });
    const a = antecedentesDe(atual, [atual, nova({ setor: " LIMPEZA ", created_at: haDias(40) })]);
    expect(a.find((x) => x.rotulo === "Este setor")?.total).toBe(1);
  });

  it("sem vínculo nem lotação não há antecedente a mostrar", () => {
    const atual = nova({ created_at: haDias(5) });
    expect(antecedentesDe(atual, [atual, nova({ created_at: haDias(40) })])).toHaveLength(0);
  });

  it("sem medida disciplinar aplicada não existe recaída a medir", () => {
    const r = reincidencias(
      [
        nova({ denunciado_empregado_id: 9, created_at: haDias(60), status: "encerrada",
               concluido_em: haDias(50), medidas: ["orientacao"] }),
        nova({ denunciado_empregado_id: 9, created_at: haDias(20) }),
      ],
      (d) => `#${d.denunciado_empregado_id}`,
      () => "Fulano");
    expect(r[0].aposMedida).toBe(0);
  });
});
