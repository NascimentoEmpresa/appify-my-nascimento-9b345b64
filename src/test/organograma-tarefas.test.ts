import { describe, expect, it } from "vitest";
import {
  diasDeAtraso, lerPlanilhaPops, periodicidadeDoTexto, resolvidaComAtraso, resumirPorPessoa, separarTarefas, situacaoDaTarefa, type TarefaItem,
} from "@/lib/organograma/tarefas";

const HOJE = "2026-11-10";
const tarefa = (x: Partial<TarefaItem> = {}): TarefaItem => ({ id: "1", titulo: "T", periodicidade: "diaria", vencimento: HOJE, status: "pendente", responsavel_nome: "Ana", user_id: "a", ...x });

describe("situação", () => {
  it("vencida, de hoje e próxima", () => {
    expect(situacaoDaTarefa(tarefa({ vencimento: "2026-11-09" }), HOJE)).toBe("vencida");
    expect(situacaoDaTarefa(tarefa(), HOJE)).toBe("hoje");
    expect(situacaoDaTarefa(tarefa({ vencimento: "2026-11-11" }), HOJE)).toBe("proxima");
  });
  it("resolvida não cobra, mesmo com data passada", () => {
    expect(situacaoDaTarefa(tarefa({ vencimento: "2026-11-01", status: "concluida" }), HOJE)).toBe("resolvida");
    expect(situacaoDaTarefa(tarefa({ vencimento: "2026-11-01", status: "nao_aplicavel" }), HOJE)).toBe("resolvida");
  });
  it("separa em grupos", () => {
    const s = separarTarefas([tarefa({ vencimento: "2026-11-01" }), tarefa(), tarefa({ status: "concluida" })], HOJE);
    expect([s.vencida.length, s.hoje.length, s.proxima.length, s.resolvida.length]).toEqual([1, 1, 0, 1]);
  });
  it("conta o atraso", () => {
    expect(diasDeAtraso("2026-11-07", HOJE)).toBe(3);
    expect(diasDeAtraso("2026-11-12", HOJE)).toBe(0);
  });
  it("concluída depois do prazo é atraso", () => {
    expect(resolvidaComAtraso(tarefa({ status: "concluida", vencimento: "2026-11-09", concluida_em: "2026-11-10T10:00:00Z" }))).toBe(true);
    expect(resolvidaComAtraso(tarefa({ status: "concluida", vencimento: "2026-11-10", concluida_em: "2026-11-10T10:00:00Z" }))).toBe(false);
  });
});

describe("resumo por pessoa", () => {
  const itens = [
    tarefa({ id: "1", vencimento: "2026-11-01" }),
    tarefa({ id: "2", status: "concluida", vencimento: "2026-11-05", concluida_em: "2026-11-05T12:00:00Z" }),
    tarefa({ id: "3", status: "concluida", vencimento: "2026-11-05", concluida_em: "2026-11-08T12:00:00Z" }),
    tarefa({ id: "4", status: "nao_aplicavel", vencimento: "2026-11-05" }),
    tarefa({ id: "5", user_id: "b", responsavel_nome: "Bruno" }),
  ];
  const r = resumirPorPessoa(itens, HOJE);
  it("quem tem vencida vem primeiro", () => expect(r.map((p) => p.nome)).toEqual(["Ana", "Bruno"]));
  it("conta cada situação", () => {
    expect(r[0]).toMatchObject({ vencidas: 1, hoje: 0, concluidas: 2 });
    expect(r[1]).toMatchObject({ vencidas: 0, hoje: 1, concluidas: 0 });
  });
  it("no prazo: só a concluída em dia, sobre concluídas e vencidas; não se aplica fica fora", () => expect(r[0].noPrazo).toBe(33));
  it("sem nada para medir não vira 0%", () => expect(r[1].noPrazo).toBeNull());
});

describe("planilha do Gerador de POPs", () => {
  it.each([["Diário", "diaria"], ["DIARIA", "diaria"], ["Semanal", "semanal"], ["quinzenal", "quinzenal"], ["Mensal", "mensal"], ["Anual", null], ["Sob demanda", null], ["", null]])(
    "%s → %s", (t, e) => expect(periodicidadeDoTexto(t)).toBe(e));

  const lin = (atividade: string, per: string, resp: string) => ["1", "ADM", "Financeiro", atividade, per, resp, "", "", "", "", "Alta", "", "", "", "", "Descrição"];
  const r = lerPlanilhaPops([["título"], ["cabeçalho"], lin("Conferir caixa", "Diário", "Supervisor / Encarregado"), lin("Plano", "Anual", "Gerente"), lin("Sem dono", "Mensal", ""), lin("", "Mensal", "Gerente")]);
  it("pula as duas linhas de cabeçalho e a linha sem atividade", () => expect(r.linhas).toHaveLength(1));
  it("lê as colunas e separa os cargos", () => {
    expect(r.linhas[0]).toEqual({ titulo: "Conferir caixa", area: "ADM", setor: "Financeiro", periodicidade: "diaria", cargos: ["Supervisor", "Encarregado"], criticidade: "Alta", descricao: "Descrição" });
  });
  it("diz o que ficou de fora e por quê", () => {
    expect(r.ignoradas.map((i) => i.atividade)).toEqual(["Plano", "Sem dono"]);
    expect(r.ignoradas[0].motivo).toContain("Anual");
  });
});
