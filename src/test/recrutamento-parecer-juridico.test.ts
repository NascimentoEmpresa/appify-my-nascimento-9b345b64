import { describe, expect, it } from "vitest";
import { NIVEIS_JURIDICO, NIVEL_OK, eventoParecerJuridico, nivelJuridico, seloJuridico } from "@/lib/recrutamento/parecerJuridico";

// Kanban do Recrutamento — o Jurídico só dá parecer (mig 20261014000004).

describe("parecer do Jurídico", () => {
  it("os quatro níveis pedidos, na ordem do menos ao mais grave (os valores do CHECK do banco)", () => {
    expect(NIVEIS_JURIDICO.map((n) => n.rotulo)).toEqual(["Tudo certo", "Alguns processos, mas OK", "Muitos processos", "Alto risco"]);
    expect(NIVEIS_JURIDICO.map((n) => n.valor)).toEqual(["tudo_certo", "alguns_processos_ok", "muitos_processos", "alto_risco"]);
    expect(NIVEL_OK).toBe("tudo_certo");
    expect(nivelJuridico("xyz")).toBeNull();
  });
  it("evento do histórico", () => {
    expect(eventoParecerJuridico("alto_risco")).toBe("Parecer do Jurídico: Alto risco → Entrevista");
    expect(eventoParecerJuridico(null)).toBe("Parecer do Jurídico: OK → Entrevista");
  });
  it("selo do card: o nível; parecer antigo vira 'Jurídico: OK' / 'Restrição'", () => {
    expect(seloJuridico({ juridico_nivel: "muitos_processos" })?.texto).toBe("Jurídico: Muitos processos");
    expect(seloJuridico({ juridico_ok: true })?.texto).toBe("Jurídico: OK");
    // Seguiu sem o parecer do Jurídico (mig 20261014000016): não é "OK".
    expect(seloJuridico({ juridico_pulado: true })?.texto).toBe("Jurídico pulado");
    expect(seloJuridico({ juridico_pulado: true, juridico_nivel: "tudo_certo" })?.texto).toBe("Jurídico: Tudo certo");
    expect(seloJuridico({ juridico_ok: false })?.texto).toBe("Restrição do Jurídico");
    expect(seloJuridico({})).toBeNull();
  });
});
