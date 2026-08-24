import { describe, it, expect } from "vitest";
import {
  linhaDoTempo, linhaPlanilha, resumoGerencial, nomeCampo, valorCampo,
  bytesLegivel, fmtData, type DadosDossie, type Mensagem,
} from "@/pages/comite-etica/dossie";
import {
  SITUACAO, SITUACOES_CONCLUIDAS, RECOMENDACAO, DECISAO_SOBRE_PARECER,
} from "@/pages/comite-etica/vocabulario";
import {
  concluida, diasParado, parada, regraDe, vencida,
  type Anexo, type Denuncia, type Evento, type Providencia, type RegraSla,
} from "@/pages/comite-etica/metricas";

// ------------------------------------------------------------------ fixtures

const denuncia = (extra: Partial<Denuncia> = {}): Denuncia => ({
  id: "d1", protocolo: "DEN-2026-00042", identificado: true, anonimo: false,
  nome_completo: "Mariana Ferreira", cpf: null, email: "m@x.com",
  data_nascimento: null, telefone_fixo: null, celular: null,
  relacao: "colaborador", tipo_denuncia: "assedio_moral",
  local_ocorrencia: "Refeitório", como_soube: "vitima",
  lideranca_ciente: "sim", lideranca_envolvida: "nao", lideranca_ocultou: "nao",
  lideranca_ciente_quem: null, lideranca_envolvida_quem: null, lideranca_ocultou_quem: null,
  titulo: "Assédio moral — contrato SMED",
  descricao: "Relato original preservado.", testemunhas: null, evidencias: null,
  valor_financeiro: null, sugestao: null,
  empresa_id: "e1", empresa_nome: "Nascimento",
  contrato_informado: "Hospital Central", contrato_situacao: "selecionado",
  ocorrencia_data: "2026-08-10", ocorrencia_hora: "por volta das 9h",
  ocorrencia_frequencia: "recorrente",
  risco_imediato: false, risco_imediato_detalhe: null,
  retaliacao: false, retaliacao_detalhe: null,
  denunciado_informado: "O encarregado do turno", denunciado_funcao: "Encarregado",
  origem: "canal_web", tipo_classificado: "assedio_moral",
  gravidade: "alta", sigilo: "sigilosa",
  denunciado_nome: "João Silva", denunciado_empregado_id: 10,
  lider_nome: null, lider_empregado_id: null,
  diretoria: null, contrato: "SMED", setor: "Operações", unidade: null, cidade: "Canoas",
  apuracao_responsavel: "Ana Costa", apuracao_responsavel_id: "u1",
  apuracao_inicio: "2026-08-12", apuracao_fim: null,
  primeira_providencia_em: "2026-08-11T10:00:00Z",
  resumo: "Encarregado expõe a equipe em público de forma reiterada.",
  pendencia_atual: "Aguardando escala de trabalho.",
  evidencias_analise: null,
  resultado: null, medidas: [], medida_principal: null, recomendacao: null,
  houve_recurso: false, recurso_resultado: null, recurso_data: null,
  causa_raiz: null, causa_raiz_detalhe: null,
  acoes_preventivas: null, acoes_corretivas: null, sla_dias_override: null,
  decisao_final: null, decisao_em: null, decisao_fundamentacao: null,
  decisao_sobre_parecer: null, decisao_medidas: null, decisao_por_nome: null,
  status: "investigacao", justificativa_mudanca: null,
  parecer_interno: null, retorno_denunciante: null,
  concluido_em: null,
  created_at: "2026-08-10T08:00:00Z",
  ultima_movimentacao_em: "2026-08-12T09:00:00Z",
  updated_at: "2026-08-12T09:00:00Z",
  ...extra,
});

const evento = (e: Partial<Evento> = {}): Evento => ({
  id: "ev1", denuncia_id: "d1", campo: "status", de: "nova", para: "triagem",
  por_nome: "Ana Costa", justificativa: "Triagem inicial.",
  created_at: "2026-08-11T08:00:00Z", ...e,
});

const mensagem = (m: Partial<Mensagem> = {}): Mensagem => ({
  id: "m1", autor: "comite", autor_nome: "Ana Costa",
  mensagem: "Pode informar o dia exato?", interna: false, tipo: "mensagem",
  created_at: "2026-08-11T12:00:00Z", ...m,
});

const providencia = (p: Partial<Providencia> = {}): Providencia => ({
  id: "p1", denuncia_id: "d1", ordem: 1, descricao: "Entrevistar testemunhas",
  responsavel: "Ana Costa", responsavel_user_id: "u1", prazo: "2026-08-20",
  concluida_em: null, situacao: "pendente", observacao: null,
  criado_por_nome: "Ana Costa", created_at: "2026-08-12T08:00:00Z", ...p,
});

const anexo = (a: Partial<Anexo> = {}): Anexo => ({
  id: "a1", denuncia_id: "d1", origem: "denunciante", categoria: "evidencia",
  nome_arquivo: "print.png", storage_path: "d1/denunciante/x-print.png",
  mime_type: "image/png", tamanho_bytes: 2_100_000, sensivel: true,
  descricao: null, autor_nome: null, created_at: "2026-08-10T08:01:00Z", ...a,
});

const dossie = (extra: Partial<DadosDossie> = {}): DadosDossie => ({
  denuncia: denuncia(), eventos: [evento()], mensagens: [mensagem()],
  providencias: [providencia()], anexos: [anexo()], ...extra,
});

const SLAS: RegraSla[] = [
  { gravidade: "baixa", dias: 45, dias_primeira_providencia: 5, dias_sem_movimentacao: 15 },
  { gravidade: "media", dias: 30, dias_primeira_providencia: 3, dias_sem_movimentacao: 10 },
  { gravidade: "alta", dias: 15, dias_primeira_providencia: 2, dias_sem_movimentacao: 5 },
  { gravidade: "critica", dias: 7, dias_primeira_providencia: 1, dias_sem_movimentacao: 2 },
];

// ------------------------------------------------------------------- fluxo

describe("fluxo de situações", () => {
  it("tem as 11 situações pedidas pelo Comitê", () => {
    expect(SITUACAO).toHaveLength(11);
    for (const v of ["nova", "triagem", "investigacao", "aguardando_esclarecimentos",
                     "aguardando_documentos", "parecer_elaboracao", "aguardando_presidencia",
                     "aguardando_cumprimento", "concluida", "arquivada", "reaberta"]) {
      expect(SITUACAO.map((s) => s.value)).toContain(v);
    }
  });

  it("aguardando cumprimento de medida NÃO para o cronômetro do prazo", () => {
    // Era o defeito do modelo antigo: `julgada` contava como concluída, então
    // um caso decidido e não executado sumia da fila de atrasados.
    expect(SITUACOES_CONCLUIDAS).not.toContain("aguardando_cumprimento");
    expect(concluida(denuncia({ status: "aguardando_cumprimento" }))).toBe(false);
    expect(vencida(
      denuncia({ status: "aguardando_cumprimento", created_at: "2026-01-01T00:00:00Z" }),
      SLAS, new Date("2026-08-21T00:00:00Z"),
    )).toBe(true);
  });

  it("só concluída e arquivada param o cronômetro", () => {
    expect(SITUACOES_CONCLUIDAS).toEqual(["concluida", "arquivada"]);
    expect(concluida(denuncia({ status: "concluida" }))).toBe(true);
    expect(concluida(denuncia({ status: "arquivada" }))).toBe(true);
  });
});

describe("procedimento parado", () => {
  const hoje = new Date("2026-08-21T09:00:00Z");

  it("conta desde a última movimentação, não desde a abertura", () => {
    const d = denuncia({
      created_at: "2026-01-01T00:00:00Z",
      ultima_movimentacao_em: "2026-08-20T09:00:00Z",
    });
    // Aberta há meses, mas mexida ontem: não está parada.
    expect(diasParado(d, hoje)).toBe(1);
    expect(parada(d, SLAS, hoje)).toBe(false);
  });

  it("acusa o caso esquecido mesmo dentro do prazo total", () => {
    const d = denuncia({
      gravidade: "alta",
      created_at: "2026-08-15T09:00:00Z",
      ultima_movimentacao_em: "2026-08-15T09:00:00Z",
    });
    expect(vencida(d, SLAS, hoje)).toBe(false);   // 6 dias, prazo é 15
    expect(parada(d, SLAS, hoje)).toBe(true);     // 6 dias sem toque, limite é 5
  });

  it("caso concluído não fica parado", () => {
    const d = denuncia({ status: "concluida", ultima_movimentacao_em: "2026-01-01T00:00:00Z" });
    expect(diasParado(d, hoje)).toBeNull();
    expect(parada(d, SLAS, hoje)).toBe(false);
  });

  it("gravidade crítica tem menos paciência que baixa", () => {
    expect(regraDe(denuncia({ gravidade: "critica" }), SLAS).diasParado).toBe(2);
    expect(regraDe(denuncia({ gravidade: "baixa" }), SLAS).diasParado).toBe(15);
  });
});

// ------------------------------------------------------------- linha do tempo

describe("linha do tempo", () => {
  it("junta abertura, eventos, mensagens, providências e anexos em ordem", () => {
    const l = linhaDoTempo(dossie());
    expect(l[0].tipo).toBe("abertura");
    const quando = l.map((x) => new Date(x.quando).getTime());
    expect([...quando].sort((a, b) => a - b)).toEqual(quando);
  });

  it("a abertura traz empresa e contrato", () => {
    const [abertura] = linhaDoTempo(dossie());
    expect(abertura.detalhe).toContain("Nascimento");
    expect(abertura.detalhe).toContain("Hospital Central");
  });

  it("leva a justificativa da mudança de situação", () => {
    const l = linhaDoTempo(dossie());
    const mud = l.find((x) => x.tipo === "situacao");
    expect(mud?.titulo).toContain("Situação");
    expect(mud?.detalhe).toBe("Triagem inicial.");
    expect(mud?.autor).toBe("Ana Costa");
  });

  it("a versão sem sigilosos deixa nota interna e anexo sigiloso de fora", () => {
    const d = dossie({
      mensagens: [mensagem(), mensagem({ id: "m2", interna: true, mensagem: "Nota de trabalho." })],
    });
    const completa = linhaDoTempo(d, true);
    const limpa = linhaDoTempo(d, false);
    expect(JSON.stringify(completa)).toContain("Nota de trabalho.");
    expect(JSON.stringify(limpa)).not.toContain("Nota de trabalho.");
    // O anexo da fixture é sigiloso.
    expect(JSON.stringify(limpa)).not.toContain("print.png");
  });

  it("entrevista aparece tipada, não como mensagem comum", () => {
    const l = linhaDoTempo(dossie({
      mensagens: [mensagem({ tipo: "entrevista", interna: true, mensagem: "Ouvida a testemunha." })],
    }));
    const item = l.find((x) => x.tipo === "registro");
    expect(item?.titulo).toBe("Entrevista");
  });

  it("a decisão da Presidência fecha o fio", () => {
    const l = linhaDoTempo(dossie({
      denuncia: denuncia({
        decisao_final: "Aplicar advertência.",
        decisao_em: "2026-09-01T10:00:00Z",
        decisao_sobre_parecer: "aprovada",
        decisao_por_nome: "Presidência",
      }),
    }));
    expect(l.at(-1)?.tipo).toBe("decisao");
    expect(l.at(-1)?.detalhe).toContain("Aplicar advertência.");
  });

  it("dois registros no mesmo instante saem sempre na mesma ordem", () => {
    const d = dossie({
      eventos: [
        evento({ id: "e1", campo: "gravidade", de: null, para: "alta", created_at: "2026-08-11T08:00:00Z" }),
        evento({ id: "e2", campo: "setor", de: null, para: "Operações", created_at: "2026-08-11T08:00:00Z" }),
      ],
    });
    const a = linhaDoTempo(d).map((x) => x.titulo);
    const b = linhaDoTempo(d).map((x) => x.titulo);
    expect(a).toEqual(b);
  });
});

// -------------------------------------------------------------- tradução

describe("tradução dos campos do histórico", () => {
  it("troca o nome da coluna pelo nome de gente", () => {
    expect(nomeCampo("apuracao_responsavel")).toBe("Responsável pela apuração");
    expect(nomeCampo("decisao_sobre_parecer")).toBe("Decisão sobre a recomendação");
  });

  it("campo desconhecido não some — aparece cru", () => {
    expect(nomeCampo("coluna_nova_qualquer")).toBe("coluna_nova_qualquer");
  });

  it("traduz o valor, não só o nome do campo", () => {
    expect(valorCampo("status", "aguardando_cumprimento")).toBe("Aguardando cumprimento de medida");
    expect(valorCampo("gravidade", "critica")).toBe("Crítica");
    expect(valorCampo("houve_recurso", "true")).toBe("Sim");
  });

  it("desmonta o array do Postgres em vez de mostrar chaves", () => {
    expect(valorCampo("medidas", "{advertencia,treinamento}")).toBe("Advertência, Treinamento");
  });

  it("vazio vira 'vazio', não string em branco", () => {
    expect(valorCampo("setor", null)).toBe("vazio");
    expect(valorCampo("setor", "")).toBe("vazio");
  });
});

// ------------------------------------------------------- resumo gerencial

describe("resumo gerencial", () => {
  it("traz protocolo, empresa, contrato e situação", () => {
    const r = resumoGerencial(dossie());
    expect(r).toContain("DEN-2026-00042");
    expect(r).toContain("Nascimento");
    expect(r).toContain("Hospital Central");
    expect(r).toContain("Em apuração");
  });

  it("nunca inventa resumo — declara a lacuna", () => {
    const r = resumoGerencial(dossie({ denuncia: denuncia({ resumo: null }) }));
    expect(r).toContain("ainda não redigido");
  });

  it("destaca risco imediato e retaliação", () => {
    const r = resumoGerencial(dossie({
      denuncia: denuncia({ risco_imediato: true, retaliacao: true }),
    }));
    expect(r).toContain("RISCO IMEDIATO");
    expect(r).toContain("AMEAÇA OU RETALIAÇÃO");
  });

  it("conta as providências em aberto", () => {
    const r = resumoGerencial(dossie({
      providencias: [
        providencia({ id: "p1", situacao: "concluida" }),
        providencia({ id: "p2", ordem: 2, descricao: "Ouvir o denunciado", situacao: "pendente" }),
      ],
    }));
    expect(r).toContain("2 registrada(s), 1 em aberto");
    expect(r).toContain("Ouvir o denunciado");
  });

  it("diz que está em andamento quando não há resultado", () => {
    expect(resumoGerencial(dossie())).toContain("RESULTADO: apuração em andamento.");
  });

  it("avisa quando a Presidência ainda não decidiu", () => {
    const r = resumoGerencial(dossie({
      denuncia: denuncia({ status: "aguardando_presidencia" }),
    }));
    expect(r).toContain("DECISÃO DA PRESIDÊNCIA: aguardando.");
  });

  it("não vaza o nome do denunciante", () => {
    // O resumo vai para a planilha de controle, que circula mais do que a ficha.
    expect(resumoGerencial(dossie())).not.toContain("Mariana");
  });
});

// ------------------------------------------------------ linha da planilha

describe("linha da planilha", () => {
  it("tem as colunas que o Comitê pediu", () => {
    const l = linhaPlanilha(dossie());
    for (const c of ["Protocolo", "Empresa", "Contrato", "Situação", "Gravidade",
                     "Risco imediato", "Retaliação", "Anônima", "Responsável pela apuração",
                     "Providências em aberto", "Anexos", "Decisão da Presidência",
                     "Última movimentação"]) {
      expect(Object.keys(l)).toContain(c);
    }
  });

  it("traduz os códigos — a planilha é lida por gente", () => {
    const l = linhaPlanilha(dossie());
    expect(l["Situação"]).toBe("Em apuração");
    expect(l["Gravidade"]).toBe("Alta");
    expect(l["Risco imediato"]).toBe("Não");
  });

  it("conta anexos e providências", () => {
    const l = linhaPlanilha(dossie());
    expect(l["Anexos"]).toBe(1);
    expect(l["Providências"]).toBe(1);
    expect(l["Providências em aberto"]).toBe(1);
  });

  it("marca a denúncia anônima", () => {
    const l = linhaPlanilha(dossie({ denuncia: denuncia({ anonimo: true, email: null }) }));
    expect(l["Anônima"]).toBe("Sim");
  });
});

// ------------------------------------------------------------- vocabulário

describe("vocabulário novo", () => {
  it("recomendação cobre arquivamento, medida e reabertura", () => {
    const v = RECOMENDACAO.map((r) => r.value);
    expect(v).toContain("arquivamento");
    expect(v).toContain("aplicacao_medida");
    expect(v).toContain("reabertura");
  });

  it("a Presidência pode aprovar, alterar ou rejeitar", () => {
    expect(DECISAO_SOBRE_PARECER.map((d) => d.value))
      .toEqual(["aprovada", "alterada", "rejeitada"]);
  });
});

describe("formatação", () => {
  it("bytes viram tamanho legível", () => {
    expect(bytesLegivel(0)).toBe("—");
    expect(bytesLegivel(900)).toBe("900 B");
    expect(bytesLegivel(2_100_000)).toBe("2.0 MB");
  });

  it("data só-dia não escorrega para o dia anterior", () => {
    // "2026-08-10" sem hora vira meia-noite UTC e, em GMT-3, o dia 9.
    expect(fmtData("2026-08-10")).toBe("10/08/2026");
  });
});
