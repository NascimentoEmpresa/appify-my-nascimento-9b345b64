import { describe, expect, it } from "vitest";
import { diaEstaBloqueado } from "@/pages/malote/DiaPagamentoPicker";
import type { MaloteConfig, MaloteDiaBloqueado } from "@/hooks/useMaloteConfig";

// SIS-2026-0572: tipo "Folha" no Bloqueio de Dias — dia com classificações
// liberadas deixa de bloquear SÓ pra quem lança com uma delas; qualquer
// outra classificação (ou nenhuma, caso de rateio) continua bloqueada,
// mesma regra do malote_dia_esta_bloqueado(data, classificacao_id) no banco.

const CONFIG_PADRAO: MaloteConfig = {
  bloqueio_impedir_lancamento: true,
  bloqueio_fins_de_semana: true,
} as MaloteConfig;

function diaFolha(classificacaoIds: string[]): MaloteDiaBloqueado {
  return {
    id: "d1",
    data: "2026-10-05",
    tipo: "Folha",
    descricao: null,
    liberado: false,
    classificacao_ids: classificacaoIds,
  };
}

// 2026-10-05 é uma segunda-feira (dia útil) — isola o teste da regra de
// fim de semana, que é outro branch da mesma função.
const SEGUNDA_BLOQUEADA = new Date(2026, 9, 5);
const AGORA_ANTES = new Date(2026, 9, 1);

describe("diaEstaBloqueado — exceção por classificação (tipo Folha)", () => {
  it("bloqueia quem lança com uma classificação fora da lista liberada", () => {
    const dias = new Map([["2026-10-05", diaFolha(["salario-id"])]]);
    expect(
      diaEstaBloqueado(SEGUNDA_BLOQUEADA, CONFIG_PADRAO, dias, { classificacaoId: "outra-classificacao-id", agora: AGORA_ANTES })
    ).toBe(true);
  });

  it("libera quem lança com a classificação que está na lista liberada", () => {
    const dias = new Map([["2026-10-05", diaFolha(["salario-id"])]]);
    expect(
      diaEstaBloqueado(SEGUNDA_BLOQUEADA, CONFIG_PADRAO, dias, { classificacaoId: "salario-id", agora: AGORA_ANTES })
    ).toBe(false);
  });

  it("bloqueia despesa sem classificação no cabeçalho (rateio) mesmo com exceção configurada", () => {
    const dias = new Map([["2026-10-05", diaFolha(["salario-id"])]]);
    expect(diaEstaBloqueado(SEGUNDA_BLOQUEADA, CONFIG_PADRAO, dias, { classificacaoId: null, agora: AGORA_ANTES })).toBe(true);
  });

  it("bloqueia geral quando o dia não tem nenhuma classificação liberada (tipo Feriado/Recesso normal)", () => {
    const dias = new Map([["2026-10-05", diaFolha([])]]);
    expect(
      diaEstaBloqueado(SEGUNDA_BLOQUEADA, CONFIG_PADRAO, dias, { classificacaoId: "salario-id", agora: AGORA_ANTES })
    ).toBe(true);
  });

  it("liberado=true no dia libera pra qualquer classificação, exceção pontual vence a de classificação", () => {
    const dia = diaFolha(["salario-id"]);
    dia.liberado = true;
    const dias = new Map([["2026-10-05", dia]]);
    expect(
      diaEstaBloqueado(SEGUNDA_BLOQUEADA, CONFIG_PADRAO, dias, { classificacaoId: "outra-classificacao-id", agora: AGORA_ANTES })
    ).toBe(false);
  });

  it("permitirDiasBloqueados (despesa em Exceção) vence a checagem de classificação", () => {
    const dias = new Map([["2026-10-05", diaFolha(["salario-id"])]]);
    expect(
      diaEstaBloqueado(SEGUNDA_BLOQUEADA, CONFIG_PADRAO, dias, {
        classificacaoId: "outra-classificacao-id",
        permitirDiasBloqueados: true,
        agora: AGORA_ANTES,
      })
    ).toBe(false);
  });
});
