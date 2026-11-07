import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardPontoDiaria, SeloPontoDiaria } from "@/pages/malote/PontoDiariaMalote";
import type { PontoDiariaMalote } from "@/lib/diariaPonto";

const item = (inicio: string | null, fim: string | null, minutos = [450, 705]): PontoDiariaMalote => ({
  despesa_id: "dm", solicitacao_id: "sd", numero: "SD-2026-000255", faltante_nome: "ROMAINE GENEROSO",
  contrato_nome: null, posto_nome: null, tem_vinculo: true,
  dias: [{ data: "2026-10-26", turno: "tarde", inicio_cobertura: inicio, fim_cobertura: fim, minutos,
    ponto: { disponivel: true, jornadas: [{ data: "2026-10-26", vinculo: "1/123", minutos }] } }],
});

describe("SIS-2026-0800: sinalização no Malote", () => {
  it("o caso relatado mostra ausência de sobreposição sem alerta de conflito", () => {
    render(<SeloPontoDiaria itens={[item("13:00", "17:00")]} sincronizadoAte="2026-10-28" />);
    expect(screen.getByText("Sem sobreposição")).toBeInTheDocument();
    expect(screen.queryByText(/Conflito/)).not.toBeInTheDocument();
  });
  it("a despesa mostra data, cobertura e intervalo trabalhado que se sobrepõe", () => {
    render(<CardPontoDiaria itens={[item("10:00", "14:00")]} sincronizadoAte="2026-10-28" />);
    expect(screen.getByText(/26\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Diária: 10:00–14:00. Sobreposição com trabalho em 07:30–11:45/)).toBeInTheDocument();
    expect(screen.getByText("Conflito de horários")).toBeInTheDocument();
  });
  it.each([[null, null, [450, 705]], ["13:00", "17:00", [450]]])("não mostra sinal verde com cobertura ausente ou ponto incompleto", (inicio, fim, minutos) => {
    render(<CardPontoDiaria itens={[item(inicio as string | null, fim as string | null, minutos as number[])]} sincronizadoAte="2026-10-28" />);
    expect(screen.getAllByText("Ponto a conferir").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sem sobreposição")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma batida/)).not.toBeInTheDocument();
  });
});
