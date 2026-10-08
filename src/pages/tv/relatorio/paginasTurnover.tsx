import { useMemo } from "react";
import {
  LIMITES, META_ANUAL, META_MENSAL, analistas, dozeMeses, totalAnalistas, turnoverDoAno, turnoverPorContrato, type PainelTurnover, type TipoLimite,
} from "@/lib/diretoria/turnover";
import { Barras, Cartao, CartaoKpi, Colunas, TINTA, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TV — Turn-over no formato do painel (mig 20261008000004). Mesmas contas
// e metas da tela do ERP (src/lib/diretoria/turnover.ts): taxa do ano =
// soma das taxas mensais, meta de 41% no ano / 3,42% no mês, limites por
// contrato. Três páginas: RESUMO DO ANO, POR CONTRATO e LIMITES.
// =====================================================================

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (n: number | null | undefined, casas = 2) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`);

export function PaginaTurnoverResumo({ p, cor }: { p: PainelTurnover; cor: string }) {
  const ano = useMemo(() => turnoverDoAno(p), [p]);
  const meses = useMemo(() => dozeMeses(p).map((m) => ({
    rotulo: MESES[Number(m.mes.slice(5)) - 1],
    valor: m.taxa,
    cor: m.taxa == null ? "#e4e4e7" : m.taxa > META_MENSAL ? "#ef4444" : "#16a34a",
  })), [p]);
  const empresas = [...p.por_empresa].sort((a, b) => (b.taxa ?? 0) - (a.taxa ?? 0));
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-5 gap-6" style={{ height: 214 }}>
        <CartaoKpi rotulo="Turn-over acumulado" valor={pct(ano.taxa)} cor={ano.acimaDaMeta ? "#dc2626" : "#16a34a"}
          selo={{ texto: `meta ${META_ANUAL}%`, cor: ano.acimaDaMeta ? "#dc2626" : "#16a34a" }} destaque={ano.acimaDaMeta} />
        <CartaoKpi rotulo="Projeção do ano" valor={pct(ano.projecao)} cor={ano.projecao > META_ANUAL ? "#dc2626" : "#0284c7"}
          dica={ano.projecao > META_ANUAL ? "acima da meta no ritmo atual" : "no ritmo atual"} />
        <CartaoKpi rotulo="Demissões" valor={ano.demissoes.toLocaleString("pt-BR")} cor="#dc2626" dica={`${p.meses.length} ${p.meses.length === 1 ? "mês" : "meses"} de ${p.ano}`} />
        <CartaoKpi rotulo="Efetivo médio" valor={Math.round(p.efetivo_medio).toLocaleString("pt-BR")} cor="#2563eb" dica="colaboradores" />
        <CartaoKpi rotulo="Meta mensal" valor={pct(META_MENSAL)} cor="#7c3aed" dica={`${META_ANUAL}% ÷ 12`} />
      </div>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "1.75fr 1fr" }}>
        <Cartao titulo={`Turn-over mês a mês — ${p.ano}`} cor={cor} selo={`meta ${pct(META_MENSAL)} ao mês`}>
          <Colunas dados={meses} sufixo="%" referencia={{ valor: META_MENSAL, cor: "#7c3aed" }} />
        </Cartao>
        <Cartao titulo="Por empresa" cor={cor}>
          {empresas.length ? (
            <div className="flex h-full flex-col justify-around">
              {empresas.slice(0, 6).map((e) => (
                <div key={e.empresa} className="flex items-center gap-4 border-b border-zinc-100 pb-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold" style={{ fontSize: 23 }}>{e.empresa}</p>
                    <p className="font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{e.demissoes.toLocaleString("pt-BR")} demissões · efetivo {Math.round(e.efetivo_medio).toLocaleString("pt-BR")}</p>
                  </div>
                  <span className="font-black tabular-nums" style={{ fontSize: 34, color: (e.taxa ?? 0) > META_ANUAL ? "#dc2626" : TINTA }}>{pct(e.taxa, 1)}</span>
                </div>
              ))}
            </div>
          ) : <Vazio />}
        </Cartao>
      </div>
    </div>
  );
}

/** Contrato pequeno distorce a % do próprio contrato (1 demissão em 1 pessoa = 100%): na TV, só a partir deste efetivo. */
const EFETIVO_MINIMO_PROPRIO = 20;

export function PaginaTurnoverContratos({ p, cor }: { p: PainelTurnover; cor: string }) {
  const linhas = useMemo(() => turnoverPorContrato(p), [p]);
  const efetivo = useMemo(() => new Map(p.por_contrato.map((c) => [c.contrato, c.efetivo_medio])), [p]);
  const doGrupo = [...linhas].sort((a, b) => (b.grupo ?? 0) - (a.grupo ?? 0)).slice(0, 8);
  const doProprio = [...linhas].filter((l) => l.proprio != null && (efetivo.get(l.contrato) ?? 0) >= EFETIVO_MINIMO_PROPRIO)
    .sort((a, b) => (b.proprio ?? 0) - (a.proprio ?? 0)).slice(0, 8);
  return (
    <div className="grid h-full grid-cols-2 gap-6">
      <Cartao titulo="Peso no turn-over do grupo" cor={cor} selo="% do efetivo do grupo">
        <Barras cor={cor} itens={doGrupo.map((l) => ({ nome: l.nome, valor: l.grupo ?? 0, rotulo: pct(l.grupo), dica: `${l.demissoes} dem.` }))} />
      </Cartao>
      <Cartao titulo="Turn-over do próprio contrato" cor={cor} selo={`contratos com ${EFETIVO_MINIMO_PROPRIO}+ pessoas`}>
        <Barras cor="#dc2626" itens={doProprio.map((l) => ({
          nome: l.nome, valor: l.proprio ?? 0, rotulo: pct(l.proprio, 1), dica: `${l.demissoes} dem.`,
          cor: (l.proprio ?? 0) > META_ANUAL ? "#dc2626" : "#f59e0b",
        }))} />
      </Cartao>
    </div>
  );
}

const TITULO_LIMITE: Record<TipoLimite, string> = { trabalhado: "Aviso trabalhado", indenizado: "Aviso indenizado", demissao: "Demissões" };

export function PaginaTurnoverLimites({ p, cor }: { p: PainelTurnover; cor: string }) {
  const tipos: TipoLimite[] = ["trabalhado", "indenizado", "demissao"];
  const totais = tipos.map((t) => ({ t, ...totalAnalistas(p, t) }));
  // Ranking de aviso trabalhado por contrato (sempre cheio, ao contrário de
  // "só os estourados"): vermelho estourou, âmbar vai estourar, verde ok.
  const ranking = useMemo(() => analistas(p, "trabalhado").filter((l) => l.efetivo >= EFETIVO_MINIMO_PROPRIO && l.qtd > 0).slice(0, 8), [p]);
  const estourados = ranking.filter((l) => l.estourou).length;
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-3 gap-6" style={{ height: 300 }}>
        {totais.map((x) => {
          const fora = x.pct > x.limite;
          const cheio = Math.min(100, (x.pct / Math.max(x.limite, 0.01)) * 100);
          return (
            <Cartao key={x.t} titulo={TITULO_LIMITE[x.t]} cor={fora ? "#dc2626" : cor} selo={`limite ${x.limite}%`}>
              <div className="flex h-full flex-col justify-center">
                <div className="flex items-end gap-4">
                  <p className="font-black leading-none tabular-nums" style={{ fontSize: 76, color: fora ? "#dc2626" : "#16a34a" }}>{pct(x.pct, 1)}</p>
                  <p className="mb-2 font-bold" style={{ fontSize: 20, color: TINTA_SUAVE }}>{x.qtd.toLocaleString("pt-BR")} de {x.efetivo.toLocaleString("pt-BR")}</p>
                </div>
                <div className="mt-4 h-5 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, cheio)}%`, background: fora ? "#dc2626" : "#16a34a" }} />
                </div>
                <p className="mt-2 font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}>projeção do ano: <b style={{ color: x.projecao > x.limite ? "#dc2626" : TINTA }}>{pct(x.projecao, 1)}</b></p>
              </div>
            </Cartao>
          );
        })}
      </div>
      <Cartao titulo="Aviso trabalhado por contrato" cor={estourados ? "#dc2626" : cor} style={{ flex: "1 1 0" }}
        selo={`limite ${LIMITES.trabalhado}% · contratos com ${EFETIVO_MINIMO_PROPRIO}+ pessoas`}>
        {ranking.length ? (
          <div className="grid h-full grid-cols-2 gap-x-12">
            {[ranking.slice(0, 4), ranking.slice(4, 8)].map((col, k) => (
              <Barras key={k} cor={cor} max={Math.max(LIMITES.trabalhado * 1.5, ...ranking.map((l) => l.pct))}
                itens={col.map((l) => ({
                  nome: l.nome, valor: l.pct, rotulo: pct(l.pct, 1), dica: `${l.qtd} de ${l.efetivo}`,
                  cor: l.estourou ? "#dc2626" : l.vaiEstourar ? "#f59e0b" : "#16a34a",
                }))} />
            ))}
          </div>
        ) : <Vazio texto="Nenhum aviso trabalhado no período." />}
      </Cartao>
    </div>
  );
}
