import { useMemo } from "react";
import {
  META_DIAS_CONTRATAR, agingAbertas, agruparVagas, corDias, diasTotais, etapaDoStatus, fmtDias, funilVagas, mensalVagas, resumoVagas,
  tempoPorEtapa, tituloEtapa, vagaFechada, type PainelVagas,
} from "@/lib/relatorios/vagasPainel";
import { rotuloMes } from "@/pages/relatorios/sistemas";
import { semCodigo, semMesesVaziosNoInicio } from "@/lib/tv/relatorioTv";
import { Barras, Cartao, CartaoKpi, Colunas, GraficoMensal, Selo, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TV — Vagas — Dashboard (mig 20261008000004). A TV recebe o mesmo painel
// da tela do ERP (dir_vagas_painel) e faz as MESMAS contas
// (src/lib/relatorios/vagasPainel.ts) — o número da TV é o da tela.
// Três páginas: RESUMO (números, mês a mês, funil), EM ANDAMENTO (há quanto
// tempo, onde estão paradas, as mais antigas) e POR CONTRATO.
// =====================================================================

// As cores das etapas — as mesmas do Vagas — Dashboard (VagasPainel.tsx).
const COR_ETAPA: Record<string, string> = {
  aprovacao: "#94a3b8", recrutamento: "#7c3aed", selecao: "#2563eb", juridico: "#0891b2", entrevistas: "#db2777",
  aprovado: "#ea580c", sst_compras: "#f59e0b", contratado: "#16a34a", outros: "#64748b", legado: "#a8a29e",
};
const n1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);

export function PaginaVagasResumo({ p, cor }: { p: PainelVagas; cor: string }) {
  const r = useMemo(() => resumoVagas(p), [p]);
  const mensal = useMemo(() => semMesesVaziosNoInicio(mensalVagas(p), ["solicitadas"]).map((m) => ({
    rotulo: rotuloMes(m.mes), contratadas: m.contratadas, andamento: m.andamento, reprovadas: m.reprovadas,
    __total: m.contratadas + m.andamento + m.reprovadas, tempo: n1(m.tempoMedio),
  })), [p]);
  const funil = useMemo(() => funilVagas(p), [p]);
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-5 gap-6" style={{ height: 214 }}>
        <CartaoKpi rotulo="Vagas solicitadas" valor={r.solicitadas.toLocaleString("pt-BR")} cor="#2563eb" dica={`${r.posicoes.toLocaleString("pt-BR")} posições`} />
        <CartaoKpi rotulo="Contratadas" valor={r.contratadas.toLocaleString("pt-BR")} cor="#16a34a"
          dica={r.aproveitamentoPct != null ? `${r.aproveitamentoPct.toFixed(0)}% das que fecharam` : null} />
        <CartaoKpi rotulo="Em aberto agora" valor={r.abertasAgora.toLocaleString("pt-BR")} cor="#d97706" dica={`${r.posicoesAbertasAgora} posições`} />
        <CartaoKpi rotulo="Tempo até contratar" valor={fmtDias(r.tempoMedioContratar)} cor="#0284c7" dica={`mediana ${fmtDias(r.medianaContratar)}`} />
        <CartaoKpi rotulo={`No prazo (${META_DIAS_CONTRATAR} dias)`} valor={r.noPrazoPct != null ? `${Math.round(r.noPrazoPct)}%` : "—"}
          cor={(r.noPrazoPct ?? 0) >= 70 ? "#16a34a" : "#dc2626"} dica="das contratadas" destaque={(r.noPrazoPct ?? 100) < 70} />
      </div>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "1.75fr 1fr" }}>
        <Cartao titulo="Mês a mês — pelas vagas pedidas no mês" cor={cor}>
          <GraficoMensal dados={mensal} empilhado
            series={[{ chave: "contratadas", nome: "Contratadas", cor: "#16a34a" }, { chave: "andamento", nome: "Em andamento", cor: "#f59e0b" }, { chave: "reprovadas", nome: "Reprovadas/canceladas", cor: "#ef4444" }]}
            linha={{ chave: "tempo", nome: "Dias até contratar", cor: "#0f172a", sufixo: "d" }} />
        </Cartao>
        <Cartao titulo="Funil do período" cor={cor}>
          <div className="flex h-full flex-col justify-around">
            {funil.map((d, i) => (
              <div key={d.chave}>
                <div className="flex items-baseline justify-between">
                  <p className="font-bold" style={{ fontSize: 22 }}>{d.titulo}</p>
                  <p className="font-black tabular-nums" style={{ fontSize: 26 }}>{d.n.toLocaleString("pt-BR")} <span className="font-bold" style={{ fontSize: 19, color: TINTA_SUAVE }}>{d.pct.toFixed(0)}%</span></p>
                </div>
                <div className="mt-1 h-5 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(d.pct, d.n ? 2 : 0)}%`, background: i === funil.length - 1 ? "#16a34a" : `hsl(232 70% ${38 + i * 8}%)` }} />
                </div>
              </div>
            ))}
          </div>
        </Cartao>
      </div>
    </div>
  );
}

export function PaginaVagasAndamento({ p, cor }: { p: PainelVagas; cor: string }) {
  const aging = useMemo(() => agingAbertas(p), [p]);
  const paradas = useMemo(() => tempoPorEtapa(p).filter((e) => e.paradasAgora > 0).sort((a, b) => b.paradasAgora - a.paradasAgora), [p]);
  const antigas = useMemo(() => p.vagas.filter((v) => !vagaFechada(v))
    .map((v) => ({ v, dias: diasTotais(v, p.agora) })).sort((a, b) => b.dias - a.dias).slice(0, 6), [p]);
  const totalAbertas = aging.reduce((s, a) => s + a.vagas, 0);
  return (
    <div className="grid h-full gap-6" style={{ gridTemplateColumns: "1fr 1fr 1.15fr" }}>
      <Cartao titulo="Abertas há quanto tempo" cor={cor} selo={`${totalAbertas} abertas`}>
        <Colunas dados={aging.map((a) => ({ rotulo: a.rotulo, valor: a.vagas, cor: a.cor }))} />
      </Cartao>
      <Cartao titulo="Onde estão paradas agora" cor={cor}>
        {paradas.length ? (
          <Barras cor={cor} itens={paradas.slice(0, 7).map((e) => ({
            nome: e.titulo, valor: e.paradasAgora, cor: COR_ETAPA[e.chave] ?? cor, dica: e.mediaParadas != null ? `há ${fmtDias(e.mediaParadas, 0)}` : undefined,
          }))} />
        ) : <Vazio texto="Nenhuma vaga aberta." />}
      </Cartao>
      <Cartao titulo="Abertas há mais tempo" cor={cor}>
        {antigas.length ? (
          <div className="flex h-full flex-col justify-around">
            {antigas.map(({ v, dias }) => (
              <div key={v.id} className="flex items-center gap-4 border-b border-zinc-100 pb-2 last:border-0">
                <span className="shrink-0 rounded-2xl px-3 py-2 text-center font-black tabular-nums leading-none text-white" style={{ fontSize: 26, minWidth: 92, background: corDias(dias) }}>
                  {Math.floor(dias)}<span className="block font-bold" style={{ fontSize: 14 }}>dias</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold" style={{ fontSize: 22 }}>#{v.id} · {v.cargo ?? "Vaga"}{v.qtd > 1 ? ` ×${v.qtd}` : ""}</p>
                  <p className="truncate font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{v.contrato ? semCodigo(v.contrato) : "sem contrato"}</p>
                </div>
                <Selo cor={COR_ETAPA[etapaDoStatus(v.status)] ?? cor} claro tamanho={15}>{tituloEtapa(etapaDoStatus(v.status))}</Selo>
              </div>
            ))}
          </div>
        ) : <Vazio texto="Nenhuma vaga aberta." />}
      </Cartao>
    </div>
  );
}

export function PaginaVagasContratos({ p, cor }: { p: PainelVagas; cor: string }) {
  const contratos = useMemo(() => agruparVagas(p, "contrato").filter((g) => g.nome !== "(não informado)" || g.vagas > 0), [p]);
  const cargos = useMemo(() => agruparVagas(p, "cargo"), [p]);
  const porAbertas = [...contratos].filter((c) => c.abertas > 0).sort((a, b) => b.abertas - a.abertas || b.vagas - a.vagas).slice(0, 8);
  const porSolicitadas = [...contratos].sort((a, b) => b.vagas - a.vagas).slice(0, 8);
  const topCargos = [...cargos].sort((a, b) => b.vagas - a.vagas).slice(0, 8);
  return (
    <div className="grid h-full grid-cols-3 gap-6">
      <Cartao titulo="Mais vagas abertas" cor={cor} selo="agora">
        <Barras cor="#d97706" itens={porAbertas.map((c) => ({
          nome: semCodigo(c.nome), valor: c.abertas, dica: c.mediaDiasAbertas != null ? `há ${fmtDias(c.mediaDiasAbertas, 0)}` : undefined,
        }))} />
      </Cartao>
      <Cartao titulo="Mais vagas pedidas" cor={cor} selo="no período">
        <Barras cor={cor} itens={porSolicitadas.filter((c) => c.vagas > 0).map((c) => ({
          nome: semCodigo(c.nome), valor: c.vagas, dica: c.contratadas ? `${c.contratadas} contr.` : undefined,
        }))} />
      </Cartao>
      <Cartao titulo="Cargos mais pedidos" cor={cor} selo="no período">
        <Barras cor="#7c3aed" itens={topCargos.filter((c) => c.vagas > 0).map((c) => ({
          nome: c.nome, valor: c.vagas, dica: c.tempoMedioContratar != null ? fmtDias(c.tempoMedioContratar, 0) : undefined,
        }))} />
      </Cartao>
    </div>
  );
}
