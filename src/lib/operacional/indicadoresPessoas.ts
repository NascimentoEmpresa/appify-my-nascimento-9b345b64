// =====================================================================
// Operacional › Indicadores › 4. PESSOAS E CAPACIDADE (09/11/2026)
//
// Fontes que já existem, com a conta das telas de origem:
//   · quadro: RH › Ativos/Contratos (rh_ac_painel + conferirContrato) —
//     previsto da planilha, quem conta (Trabalhando), sobra/falta posto a
//     posto, afastados. É a POSIÇÃO DE HOJE, não da competência;
//   · faltas: as faltas descontadas nas NFs da competência (Diretoria ›
//     Custo de Faltas, dir_rel_custo_faltas). Curva ABC por contrato:
//     A até 80% das faltas, B até 95%, C o resto;
//   · afastamentos: SST › Controle de Afastamentos, casos em aberto por motivo.
// =====================================================================
import { conferirContrato, type PainelAtivos } from "@/pages/rh/conferenciaAtivos";
import { notaValidaNoFaturamento } from "@/pages/controladoria/faturamento/regras";
import type { NotaFaltas } from "@/lib/relatorios/custoFaltas";

export interface QuadroPessoas {
  previsto: number;
  atual: number;
  excedente: number;
  deficit: number;
  afastados: number;
  feristas: number;
  contratosExcedente: number;
  contratosDeficit: number;
  contratosEquilibrados: number;
  contratos: { nome: string; previsto: number; atual: number; saldo: number }[];
}

export interface FaltasPessoas {
  total: number;
  contratosComFaltas: number;
  /** % das faltas que estão nos 10 contratos com mais faltas. */
  top10: number | null;
  abc: { classe: "A" | "B" | "C"; faltas: number; contratos: number }[];
  porContrato: { nome: string; faltas: number; classe: "A" | "B" | "C" }[];
}

export const ehFerias = (s: string | null | undefined) => /f[eé]rias/i.test(s ?? "");

export function montarQuadro(p: PainelAtivos): QuadroPessoas {
  const q: QuadroPessoas = {
    previsto: 0, atual: 0, excedente: 0, deficit: 0, afastados: 0, feristas: 0,
    contratosExcedente: 0, contratosDeficit: 0, contratosEquilibrados: 0, contratos: [],
  };
  for (const c of p.contratos) {
    if (c.encerrado || !c.postos.length) continue;
    const r = conferirContrato(c);
    q.previsto += r.previsto;
    q.atual += r.tem;
    q.excedente += r.sobra;
    q.deficit += r.falta;
    q.afastados += r.afastados.length;
    q.feristas += c.pessoas.filter((x) => !x.fora && ehFerias(x.situacao)).length;
    if (r.situacao === "excesso") q.contratosExcedente++;
    else if (r.situacao === "falta") q.contratosDeficit++;
    else q.contratosEquilibrados++;
    q.contratos.push({ nome: c.nome, previsto: r.previsto, atual: r.tem, saldo: r.saldo });
  }
  q.contratos.sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
  return q;
}

export function montarFaltas(notas: NotaFaltas[], competencia: string): FaltasPessoas {
  const porContrato = new Map<string, number>();
  for (const n of notas) {
    if (!n.competencia.startsWith(competencia) || !notaValidaNoFaturamento(n) || !(n.faltas > 0)) continue;
    porContrato.set(n.contrato_nome, (porContrato.get(n.contrato_nome) ?? 0) + n.faltas);
  }
  const lista = [...porContrato.entries()].map(([nome, faltas]) => ({ nome, faltas })).sort((a, b) => b.faltas - a.faltas);
  const total = lista.reduce((s, l) => s + l.faltas, 0);
  let acumulado = 0;
  const comClasse = lista.map((l) => {
    // A classe vem de onde o contrato COMEÇA na curva: o 1º contrato é sempre A.
    const inicio = total > 0 ? acumulado / total : 0;
    acumulado += l.faltas;
    const classe: "A" | "B" | "C" = inicio < 0.8 ? "A" : inicio < 0.95 ? "B" : "C";
    return { ...l, classe };
  });
  const abc = (["A", "B", "C"] as const).map((classe) => {
    const da = comClasse.filter((l) => l.classe === classe);
    return { classe, faltas: da.reduce((s, l) => s + l.faltas, 0), contratos: da.length };
  });
  const top = lista.slice(0, 10).reduce((s, l) => s + l.faltas, 0);
  return {
    total,
    contratosComFaltas: lista.length,
    top10: total > 0 ? Math.round((top / total) * 1000) / 10 : null,
    abc,
    porContrato: comClasse,
  };
}

/** Afastamentos em aberto por motivo: os 3 maiores e "Outros". */
export function motivosAfastamento(itens: { motivo: string; aberto: boolean }[]): { nome: string; valor: number }[] {
  const m = new Map<string, number>();
  for (const i of itens) if (i.aberto) m.set(i.motivo || "Sem motivo", (m.get(i.motivo || "Sem motivo") ?? 0) + 1);
  const ord = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const top = ord.slice(0, 3).map(([nome, valor]) => ({ nome, valor }));
  const resto = ord.slice(3).reduce((s, [, v]) => s + v, 0);
  return resto > 0 ? [...top, { nome: "Outros", valor: resto }] : top;
}
