import { describe, it, expect } from "vitest";
import {
  MENU, addMeses, contaAvanco, corDoStatus, ehDiaUtil, etapaDoStatus,
  explicaStatus, faltaPara, idsDoAnalista, mesLegivel, mesPadrao,
  ordemDoStatus, pct, podeAgir, prazoDoMes, proximoStatus,
  STATUS_TODOS, type Acao, type StatusPonto,
} from "@/lib/conferenciaPonto/conferencia";

// A Conferência de Ponto veio do Flask, onde o poder saía do SETOR da pessoa
// e existia um perfil ADMIN que furava tudo. Aqui cada ação é um menu
// liberado por usuário. O que estes testes travam é justamente isso: sem a
// chave certa, nenhuma ação passa — não importa o status.

/** Um `can()` de mentira: libera só os menus da lista. */
const com = (...menus: string[]) => (m: string) => menus.includes(m);
const ninguem = () => false;
const tudo = () => true;

describe("proximoStatus — o caminho feliz", () => {
  it("percorre Operacional → RH → valor → pago", () => {
    expect(proximoStatus("Pendente Operacional", "aprovar")).toBe("Pendente RH");
    expect(proximoStatus("Pendente RH", "confirmar")).toBe("Conferido RH");
    expect(proximoStatus("Conferido RH", "informar_valor")).toBe("Liberado Financeiro");
    expect(proximoStatus("Liberado Financeiro", "marcar_pago")).toBe("Pago");
  });

  it("não deixa informar valor antes de confirmar", () => {
    // Liberar direto de "Pendente RH" pularia a conferência que dá nome ao
    // sistema — e o valor liberado é o que vira pagamento.
    expect(proximoStatus("Pendente RH", "informar_valor")).toBeNull();
    expect(proximoStatus("Pendente Operacional", "informar_valor")).toBeNull();
  });

  it("não deixa pagar o que não foi liberado", () => {
    expect(proximoStatus("Conferido RH", "marcar_pago")).toBeNull();
    expect(proximoStatus("Pendente RH", "marcar_pago")).toBeNull();
  });

  it("pago é o fim da linha", () => {
    for (const acao of ["aprovar", "confirmar", "informar_valor", "marcar_pago"] as Acao[]) {
      expect(proximoStatus("Pago", acao)).toBeNull();
    }
  });
});

describe("proximoStatus — devolução", () => {
  it("devolve uma casa, não para o começo", () => {
    expect(proximoStatus("Conferido RH", "devolver_op")).toBe("Devolvido Operacional");
    expect(proximoStatus("Liberado Financeiro", "devolver_rh")).toBe("Devolvido RH");
  });

  it("devolvido volta a ser trabalho de quem recebeu", () => {
    expect(proximoStatus("Devolvido Operacional", "aprovar")).toBe("Pendente RH");
    expect(proximoStatus("Devolvido RH", "confirmar")).toBe("Conferido RH");
  });

  it("não devolve o que ainda não saiu da mão de ninguém", () => {
    expect(proximoStatus("Pendente Operacional", "devolver_op")).toBeNull();
    expect(proximoStatus("Pendente RH", "devolver_rh")).toBeNull();
  });
});

describe("podeAgir — a permissão manda", () => {
  it("sem chave nenhuma, nada anda", () => {
    for (const acao of ["aprovar", "confirmar", "informar_valor", "marcar_pago"] as Acao[]) {
      expect(podeAgir("Pendente Operacional", acao, ninguem)).toBe(false);
      expect(podeAgir("Conferido RH", acao, ninguem)).toBe(false);
    }
  });

  it("cada chave abre só a sua ação", () => {
    expect(podeAgir("Pendente Operacional", "aprovar", com(MENU.aprovar))).toBe(true);
    // Quem aprova não confirma a própria aprovação: é o ponto de ter duas
    // permissões separadas em vez de uma de "mexer no ponto".
    expect(podeAgir("Pendente RH", "confirmar", com(MENU.aprovar))).toBe(false);
    expect(podeAgir("Pendente RH", "confirmar", com(MENU.confirmar))).toBe(true);
  });

  it("quem informa o valor não é necessariamente quem paga", () => {
    expect(podeAgir("Conferido RH", "informar_valor", com(MENU.valor))).toBe(true);
    expect(podeAgir("Liberado Financeiro", "marcar_pago", com(MENU.valor))).toBe(false);
    expect(podeAgir("Liberado Financeiro", "marcar_pago", com(MENU.pagar))).toBe(true);
  });

  it("a permissão não vence o status: chave certa, hora errada, não passa", () => {
    expect(podeAgir("Pendente Operacional", "marcar_pago", com(MENU.pagar))).toBe(false);
    expect(podeAgir("Pago", "informar_valor", tudo)).toBe(false);
  });

  it("devolver é poder de quem recebeu, não de quem mandou", () => {
    // Só devolve ao Operacional quem confirma; só devolve ao RH quem paga.
    expect(podeAgir("Conferido RH", "devolver_op", com(MENU.confirmar))).toBe(true);
    expect(podeAgir("Conferido RH", "devolver_op", com(MENU.aprovar))).toBe(false);
    expect(podeAgir("Liberado Financeiro", "devolver_rh", com(MENU.pagar))).toBe(true);
    expect(podeAgir("Liberado Financeiro", "devolver_rh", com(MENU.confirmar))).toBe(false);
  });
});

describe("etapaDoStatus", () => {
  it("diz de quem é a bola em cada status", () => {
    expect(etapaDoStatus("Pendente Operacional")).toBe("operacional");
    expect(etapaDoStatus("Devolvido Operacional")).toBe("operacional");
    expect(etapaDoStatus("Pendente RH")).toBe("rh");
    expect(etapaDoStatus("Devolvido RH")).toBe("rh");
    expect(etapaDoStatus("Liberado Financeiro")).toBe("financeiro");
    expect(etapaDoStatus("Pago")).toBe("fim");
  });

  it("todo status tem dono — nenhum cai no vazio", () => {
    for (const s of STATUS_TODOS) expect(etapaDoStatus(s)).toBeTruthy();
  });
});

describe("contaAvanco", () => {
  it("é acumulativo: a barra não anda para trás quando o próximo pega", () => {
    // Era o bug clássico do painel: o Operacional 'perdia' o contrato da
    // barra dele no instante em que o RH começava a mexer.
    const linhas: StatusPonto[] = ["Pago", "Liberado Financeiro", "Conferido RH", "Pendente RH", "Pendente Operacional"];
    const a = contaAvanco(linhas);
    expect(a.total).toBe(5);
    expect(a.operacional).toBe(4);  // tudo que saiu do Operacional
    expect(a.rh).toBe(3);           // conferido, liberado e pago
    expect(a.financeiro).toBe(1);   // só o pago
  });

  it("mês vazio não divide por zero", () => {
    const a = contaAvanco([]);
    expect(a).toEqual({ operacional: 0, rh: 0, financeiro: 0, total: 0 });
    expect(pct(a.operacional, a.total)).toBe(0);
  });

  it("100% quando tudo foi pago", () => {
    const a = contaAvanco(["Pago", "Pago"]);
    expect(pct(a.financeiro, a.total)).toBe(100);
  });
});

describe("prazo do fechamento", () => {
  it("é o 5º dia útil do mês SEGUINTE, às 17h", () => {
    // Set/2026: 01/10 é quinta. Úteis: 1,2,5,6,7 → 07/10/2026.
    const p = prazoDoMes("2026-09");
    expect(p.getFullYear()).toBe(2026);
    expect(p.getMonth()).toBe(9);      // outubro
    expect(p.getDate()).toBe(7);
    expect(p.getHours()).toBe(17);
  });

  it("pula fim de semana e feriado fixo", () => {
    expect(ehDiaUtil(new Date(2026, 0, 1))).toBe(false);   // 1º de janeiro
    expect(ehDiaUtil(new Date(2026, 11, 25))).toBe(false); // Natal
    expect(ehDiaUtil(new Date(2026, 7, 22))).toBe(false);  // sábado
    expect(ehDiaUtil(new Date(2026, 7, 25))).toBe(true);   // terça comum
  });

  it("faltaPara devolve null depois do prazo", () => {
    const alvo = new Date(2026, 0, 10, 17, 0, 0);
    expect(faltaPara(alvo, new Date(2026, 0, 9, 17, 0, 0))).toBe("1d 0h 0m");
    expect(faltaPara(alvo, new Date(2026, 0, 11, 0, 0, 0))).toBeNull();
  });
});

describe("mês de referência", () => {
  it("o padrão é o mês PASSADO — a folha se confere depois de fechar", () => {
    expect(mesPadrao(new Date(2026, 7, 26))).toBe("2026-07");
  });

  it("vira o ano para trás e para a frente", () => {
    expect(mesPadrao(new Date(2026, 0, 15))).toBe("2025-12");
    expect(addMeses("2026-01", -1)).toBe("2025-12");
    expect(addMeses("2026-12", 1)).toBe("2027-01");
  });

  it("mostra legível", () => {
    expect(mesLegivel("2026-08")).toBe("Ago/2026");
  });
});

describe("idsDoAnalista", () => {
  it("aceita as duas grafias que convivem no cadastro", () => {
    // Medido em 25/08/2026: 47 contratos em texto puro, 11 em array JSON.
    expect(idsDoAnalista("11722")).toEqual([11722]);
    expect(idsDoAnalista("[11722,11907]")).toEqual([11722, 11907]);
  });

  it("não quebra com lixo", () => {
    expect(idsDoAnalista(null)).toEqual([]);
    expect(idsDoAnalista("")).toEqual([]);
    expect(idsDoAnalista("   ")).toEqual([]);
    expect(idsDoAnalista("[isso nao e json")).toEqual([]);
    expect(idsDoAnalista("abc")).toEqual([]);
  });
});

describe("aparência e ordenação", () => {
  it("todo status tem cor e explicação próprias", () => {
    const desconhecido = corDoStatus("nao existe");
    for (const s of STATUS_TODOS) {
      expect(corDoStatus(s)).not.toBe(desconhecido);
      expect(explicaStatus(s).length).toBeGreaterThan(10);
    }
  });

  it("quem grita mais alto vem primeiro, e o pago por último", () => {
    const ordenado = [...STATUS_TODOS].sort((a, b) => ordemDoStatus(a) - ordemDoStatus(b));
    expect(ordenado[0]).toBe("Problema");
    expect(ordenado[ordenado.length - 1]).toBe("Pago");
  });
});
