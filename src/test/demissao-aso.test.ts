import { describe, it, expect } from "vitest";
import {
  STATUS_FINAIS, STATUS_SST_AGENDADO, STATUS_SST_RECEBIDA, STATUS_TODOS, acaoDoSST,
  corDoStatus, explicaStatus, linkDoLocalASO, patchDevolucao,
  podeDevolver, resumoDevolucao, resumoDoASO,
} from "@/lib/demissao/solicitacao";

// O ASO demissional marca data/hora/local do exame — os MESMOS campos do ASO
// de admissão. O que este arquivo trava é o que o encarregado lê do outro
// lado: o status certo e o local do exame.
//
// A ORDEM JÁ MUDOU TRÊS VEZES: analista → RH → SST (25/08), analista → SST →
// RH (02/09) e de volta para analista → RH → SST em 08/09/2026, agora com o
// SST fechando pelo agendamento do ASO. O teste é reescrito a cada vez, em vez
// de removido, porque é ele que trava a ordem — sem isso, "trocar SST e RH"
// vira uma edição que passa despercebida em três telas.

describe("status do fluxo de demissão", () => {
  it("o RH vem antes do SST, e o SST fecha", () => {
    const i = (s: string) => STATUS_TODOS.indexOf(s as (typeof STATUS_TODOS)[number]);
    expect(i("Pendente Analista")).toBeLessThan(i("Pendente RH"));
    expect(i("Pendente RH")).toBeLessThan(i("Pendente SST"));
    expect(i("Pendente SST")).toBeLessThan(i(STATUS_SST_RECEBIDA));
    expect(i(STATUS_SST_RECEBIDA)).toBeLessThan(i(STATUS_SST_AGENDADO));
  });

  it("os dois status do SST existem e são o fim da linha", () => {
    expect(STATUS_TODOS).toContain(STATUS_SST_RECEBIDA);
    expect(STATUS_TODOS).toContain(STATUS_SST_AGENDADO);
    expect(STATUS_FINAIS).toContain(STATUS_SST_AGENDADO);
    // "Concluída" fica só por causa das demissões fechadas no desenho antigo.
    expect(STATUS_FINAIS).toContain("Concluída");
  });

  it("a primeira etapa é do analista, não do Operacional", () => {
    expect(STATUS_TODOS).toContain("Pendente Analista");
    expect(STATUS_TODOS).not.toContain("Pendente Operacional");
    expect(explicaStatus("Pendente Analista")).toMatch(/analista/i);
  });

  it("cada status se explica sozinho para quem só acompanha", () => {
    for (const s of STATUS_TODOS) {
      expect(explicaStatus(s)).not.toBe("");
      // Sem cor própria, "Pendente SST" sairia igual a um status desconhecido.
      expect(corDoStatus(s)).not.toBe(corDoStatus("status que não existe"));
    }
  });

  it("quem fecha a demissão é o SST, e o status diz isso", () => {
    expect(explicaStatus("Pendente RH")).toMatch(/RH/);
    expect(explicaStatus(STATUS_SST_RECEBIDA)).toMatch(/SST/);
    expect(explicaStatus(STATUS_SST_AGENDADO)).toMatch(/agendad/i);
  });

  it("o SST recebe primeiro e agenda depois — sem atalho", () => {
    expect(acaoDoSST("Pendente SST")).toBe("receber");
    expect(acaoDoSST(STATUS_SST_RECEBIDA)).toBe("agendar");
    // Já agendado, e antes de chegar no SST, ele não tem nada a fazer.
    expect(acaoDoSST(STATUS_SST_AGENDADO)).toBeNull();
    expect(acaoDoSST("Pendente RH")).toBeNull();
  });

  it("só o SST devolve depois de receber — e nunca depois de agendar", () => {
    expect(podeDevolver("sst", "Pendente SST")).toBe(true);
    expect(podeDevolver("sst", STATUS_SST_RECEBIDA)).toBe(true);
    // Já existe exame marcado com o colaborador: desmarcar não é um botão.
    expect(podeDevolver("sst", STATUS_SST_AGENDADO)).toBe(false);
    expect(podeDevolver("rh", STATUS_SST_RECEBIDA)).toBe(false);
  });
});

describe("linkDoLocalASO", () => {
  it("prefere o link exato que o SST colou", () => {
    expect(linkDoLocalASO({
      sst_maps_url: "https://www.google.com/maps?q=-29.123456,-51.654321",
      sst_local_exame: "Clínica Ocupacional",
    })).toBe("https://www.google.com/maps?q=-29.123456,-51.654321");
  });

  it("sem link, cai na busca pelo texto do local", () => {
    expect(linkDoLocalASO({ sst_maps_url: null, sst_local_exame: "Clínica São Lucas, Triunfo" }))
      .toBe("https://www.google.com/maps/search/?api=1&query=Cl%C3%ADnica%20S%C3%A3o%20Lucas%2C%20Triunfo");
  });

  it("sem nada, não inventa link", () => {
    expect(linkDoLocalASO({ sst_maps_url: "   ", sst_local_exame: "  " })).toBeNull();
    expect(linkDoLocalASO({})).toBeNull();
  });
});

describe("resumoDoASO", () => {
  it("junta data, hora e local em uma linha", () => {
    expect(resumoDoASO({
      sst_data_exame: "2026-09-03", sst_hora_exame: "09:00", sst_local_exame: "Clínica X",
    })).toBe("03/09/2026 às 09:00 · Clínica X");
  });

  it("hora e local são opcionais — a data é que manda", () => {
    expect(resumoDoASO({ sst_data_exame: "2026-09-03" })).toBe("03/09/2026");
    expect(resumoDoASO({ sst_data_exame: "2026-09-03", sst_local_exame: "Clínica X" }))
      .toBe("03/09/2026 · Clínica X");
  });

  it("sem ASO marcado, não finge que tem", () => {
    expect(resumoDoASO({ sst_hora_exame: "09:00", sst_local_exame: "Clínica X" })).toBe("—");
  });
});

// ── Devolução ao analista (02/09/2026) ───────────────────────────────
//
// O erro na solicitação aparece no fim: é o RH, última etapa, que percebe que
// o aviso está errado ou que falta documento. Antes disso as únicas saídas
// eram concluir um desligamento errado ou largar o card. O que estes testes
// travam é o que a devolução PRECISA desfazer — voltar "meio aprovada" faria
// a solicitação pular o SST na segunda passagem.

describe("podeDevolver", () => {
  it("só devolve quem tem trabalho a fazer agora", () => {
    expect(podeDevolver("sst", "Pendente SST")).toBe(true);
    expect(podeDevolver("rh", "Pendente RH")).toBe(true);
  });

  it("não devolve turno que ainda não chegou nem que já passou", () => {
    expect(podeDevolver("sst", "Pendente RH")).toBe(false);
    expect(podeDevolver("rh", "Pendente SST")).toBe(false);
    expect(podeDevolver("rh", "Concluída")).toBe(false);
    expect(podeDevolver("sst", "Pendente Analista")).toBe(false);
  });

  it("o analista e o Operacional não devolvem", () => {
    // O analista REPROVA (a solicitação morre); devolver é dele para trás, e
    // atrás dele só tem o encarregado. O Operacional não decide nada.
    expect(podeDevolver("analista", "Pendente Analista")).toBe(false);
    expect(podeDevolver("operacional", "Pendente Analista")).toBe(false);
  });
});

describe("patchDevolucao", () => {
  const p = patchDevolucao("rh", "MELISSA DA SILVA LEITE", "  a data do aviso não bate  ");

  it("volta para a fila do analista, não para o Operacional", () => {
    // O Operacional é somente-leitura na demissão: devolver para lá encalharia
    // o card onde ninguém pode mexer.
    expect(p.status).toBe("Pendente Analista");
  });

  it("grava quem devolveu, de onde e por quê", () => {
    expect(p.devolvido_por).toBe("MELISSA DA SILVA LEITE");
    expect(p.devolvido_de).toBe("rh");
    expect(p.devolvido_motivo).toBe("a data do aviso não bate");
    expect(typeof p.devolvido_em).toBe("string");
  });

  it("desfaz o ASO — senão a segunda passagem pularia o SST", () => {
    expect(p.sst_por).toBeNull();
    expect(p.sst_em).toBeNull();
    expect(p.sst_data_exame).toBeNull();
    expect(p.sst_local_exame).toBeNull();
  });

  it("desfaz a decisão do analista — ele vai decidir de novo", () => {
    expect(p.operacional_por).toBeNull();
    expect(p.operacional_em).toBeNull();
    expect(p.operacional_motivo).toBeNull();
  });

  it("desfaz o que o RH tinha carimbado", () => {
    expect(p.rh_por).toBeNull();
    expect(p.rh_em).toBeNull();
    expect(p.rh_observacao).toBeNull();
  });
});

describe("resumoDevolucao", () => {
  it("sem devolução, não inventa", () => {
    expect(resumoDevolucao({})).toBeNull();
    expect(resumoDevolucao({ devolvido_de: "rh", devolvido_por: "X", devolvido_em: null })).toBeNull();
  });

  it("diz de qual etapa veio, que é o que muda o que conferir", () => {
    // Erro apontado pelo SST é sobre o exame; pelo RH, sobre o acerto.
    const sst = resumoDevolucao({ devolvido_de: "sst", devolvido_por: "Ana", devolvido_em: "2026-09-02T12:00:00Z" });
    const rh  = resumoDevolucao({ devolvido_de: "rh",  devolvido_por: "Melissa", devolvido_em: "2026-09-02T12:00:00Z" });
    expect(sst).toContain("pelo SST");
    expect(sst).toContain("Ana");
    expect(rh).toContain("pelo RH");
    expect(rh).toContain("Melissa");
  });
});
