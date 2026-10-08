import { fmtKpi, rotuloMes, sistemaPorSlug, type RelatorioDados } from "@/pages/relatorios/sistemas";
import {
  maiores, misturarCor, rankingsParaTv, rotuloTv, semCodigo, semMesesVaziosNoInicio, serieDaDireita, statusEmGrupos, textoVariacao, type SistemaGeral,
} from "@/lib/tv/relatorioTv";
import { Anel, Barras, Cartao, CartaoKpi, COR_GRUPO, corDoTom, GraficoMensal, Selo, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TV — Relatório Geral e os relatórios padrão (os 9 que devolvem
// RelatorioDados). Duas páginas: RESUMO (números, mês a mês, situação) e
// DESTAQUES (rankings e a situação em detalhe — só números somados; nada
// que identifique pessoa vai para a TV, ver rankingsParaTv).
// =====================================================================

const CORES_SERIE = ["#2563eb", "#16a34a", "#ef4444", "#f59e0b"];
/** Cor da série pelo SENTIDO (desligado/recusado = vermelho, concluído = verde), senão pela posição. */
const corDaSerie = (chave: string, i: number) =>
  /recus|deslig|reprov|cancel/i.test(chave) ? "#ef4444" : /conclu|contrat|pago/i.test(chave) ? "#16a34a" : /admit|total|abert/i.test(chave) ? "#2563eb" : CORES_SERIE[i % CORES_SERIE.length];

/** Nome dos três grupos de status no anel — Colaboradores tem outro sentido. */
const NOMES_GRUPO: Record<string, { aberto: string; concluido: string; recusado: string }> = {
  colaboradores: { aberto: "Afastados", concluido: "Trabalhando", recusado: "Outros" },
};
const nomesGrupo = (slug: string) => NOMES_GRUPO[slug] ?? { aberto: "Em andamento", concluido: "Concluídas", recusado: "Recusadas" };

export function PaginaResumo({ d, cor }: { d: RelatorioDados & { slug: string }; cor: string }) {
  const kpis = d.kpis.slice(0, 5);
  const direita = serieDaDireita(d.mensal.series, d.mensal.dados);
  const barras = d.mensal.series.filter((s) => s.chave !== direita).slice(0, 3);
  const linha = direita ? d.mensal.series.find((s) => s.chave === direita) : null;
  const pct = d.mensal.series.find((s) => s.chave === direita)?.eixo === "direita";
  const dados = semMesesVaziosNoInicio(d.mensal.dados, d.mensal.series.map((s) => s.chave)).map((m) => ({ ...m, rotulo: rotuloMes(m.mes) }));
  const g = statusEmGrupos(d.por_status);
  const nomes = nomesGrupo(d.slug);
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 gap-6" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))`, height: 214 }}>
        {kpis.map((k) => {
          const v = textoVariacao(k.variacao);
          return (
            <CartaoKpi key={k.rotulo} rotulo={k.rotulo} valor={fmtKpi(k.valor, k.formato)} cor={corDoTom(k.tom)}
              dica={v ? "vs. período anterior" : k.dica} selo={v ? { texto: v.texto, cor: v.sobe ? "#16a34a" : "#dc2626" } : null} />
          );
        })}
      </div>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "1.75fr 1fr" }}>
        <Cartao titulo="Mês a mês" cor={cor} selo={`${dados.length} ${dados.length === 1 ? "mês" : "meses"}`}>
          <GraficoMensal dados={dados} series={barras.map((s, i) => ({ chave: s.chave, nome: s.rotulo, cor: corDaSerie(s.chave, i) }))}
            linha={linha ? { chave: linha.chave, nome: linha.rotulo, cor: "#0f172a", sufixo: pct ? "%" : undefined } : null} />
        </Cartao>
        <Cartao titulo="Situação" cor={cor} selo={`${g.total.toLocaleString("pt-BR")} ${d.rotulo_item}`}>
          {g.total ? (
            <Anel centro={g.total.toLocaleString("pt-BR")} sub={d.rotulo_item}
              fatias={[
                { nome: nomes.concluido, n: g.concluido, cor: COR_GRUPO.concluido },
                { nome: nomes.aberto, n: g.aberto, cor: COR_GRUPO.aberto },
                ...(g.recusado || d.slug !== "colaboradores" ? [{ nome: nomes.recusado, n: g.recusado, cor: COR_GRUPO.recusado }] : []),
              ]} />
          ) : <Vazio />}
        </Cartao>
      </div>
    </div>
  );
}

/**
 * DESTAQUES: os rankings (por contrato, cargo, motivo… — nunca por pessoa,
 * ver rankingsParaTv) e a situação em detalhe. A lista "mais recentes" dos
 * Relatórios NÃO vem para a TV: ela traz nomes (quem foi demitido, quem
 * levou advertência) e a TV fica em área comum.
 */
export function PaginaDestaques({ d, cor }: { d: RelatorioDados; cor: string }) {
  const rankings = rankingsParaTv(d.rankings).slice(0, 3);
  const situacoes = [...d.por_status].sort((a, b) => b.n - a.n);
  const total = situacoes.reduce((s, x) => s + x.n, 0);
  const mostrar = situacoes.slice(0, 10);
  const resto = situacoes.slice(10).reduce((s, x) => s + x.n, 0);
  const temSituacao = situacoes.length > 1;
  return (
    <div className="flex h-full flex-col gap-6">
      {rankings.length > 0 && (
        <div className="grid min-h-0 gap-6" style={{ gridTemplateColumns: `repeat(${rankings.length}, minmax(0, 1fr))`, flex: temSituacao ? "1.3 1 0" : "1 1 0" }}>
          {rankings.map((r) => {
            const top = maiores(r.itens.map((i) => ({ ...i, nome: rotuloTv(semCodigo(i.nome)) })), temSituacao ? 4 : 8);
            return (
              <Cartao key={r.titulo} titulo={r.titulo} cor={cor} selo={top.resto ? `+${top.resto.toLocaleString("pt-BR")} em outros` : null}>
                <Barras cor={cor} itens={top.itens.map((i) => ({ nome: i.nome, valor: i.n }))} />
              </Cartao>
            );
          })}
        </div>
      )}
      {temSituacao && (
        <Cartao titulo="Situação em detalhe" cor={cor} style={{ flex: "1 1 0" }}
          selo={`${total.toLocaleString("pt-BR")} ${d.rotulo_item}${resto ? ` · +${resto.toLocaleString("pt-BR")} em outras` : ""}`}>
          {/* Um bloco por situação, na cor do grupo (andamento / concluída / recusada). */}
          <div className="grid h-full gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(mostrar.length, 5)}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}>
            {mostrar.map((s) => (
              <div key={s.nome} className="flex min-w-0 flex-col justify-center rounded-[20px] px-5 py-3" style={{ background: misturarCor(COR_GRUPO[s.grupo], "#ffffff", 0.88) }}>
                <p className="truncate font-extrabold" style={{ fontSize: 19, color: misturarCor(COR_GRUPO[s.grupo], "#000000", 0.35) }}>{rotuloTv(s.nome)}</p>
                <div className="flex items-baseline gap-2">
                  <p className="font-black leading-none tabular-nums" style={{ fontSize: 46 }}>{s.n.toLocaleString("pt-BR")}</p>
                  <p className="font-bold tabular-nums" style={{ fontSize: 18, color: TINTA_SUAVE }}>{total ? Math.round((s.n * 100) / total) : 0}%</p>
                </div>
              </div>
            ))}
          </div>
        </Cartao>
      )}
    </div>
  );
}

/** Relatório Geral: os números somados no topo e um quadro por sistema. */
export function PaginaGeral({ sistemas }: { sistemas: SistemaGeral[] }) {
  const soma = (i: number) => sistemas.reduce((s, x) => s + (Number(x.kpis[i]?.valor) || 0), 0);
  const topo = [
    { rotulo: "Solicitações no período", valor: soma(0), cor: "#2563eb" },
    { rotulo: "Em andamento", valor: soma(1), cor: "#d97706" },
    { rotulo: "Concluídas", valor: soma(2), cor: "#16a34a" },
    { rotulo: "Recusadas / canceladas", valor: soma(3), cor: "#dc2626" },
  ];
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-4 gap-6" style={{ height: 186 }}>
        {topo.map((k) => <CartaoKpi key={k.rotulo} rotulo={k.rotulo} valor={k.valor.toLocaleString("pt-BR")} cor={k.cor} dica={`${sistemas.length} sistemas`} />)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-6">
        {sistemas.map((s) => <QuadroSistema key={s.slug} s={s} />)}
      </div>
    </div>
  );
}

function QuadroSistema({ s }: { s: SistemaGeral }) {
  const meta = sistemaPorSlug(s.slug);
  const cor = meta?.cor ?? "#2563eb";
  const Icone = meta?.icone;
  const [total, andamento, concluidas] = s.kpis;
  const chave = s.mensal.series[0]?.chave ?? "total";
  const ult = s.mensal.dados.slice(-6).map((m) => ({ mes: m.mes, v: Number(m[chave]) || 0 }));
  const max = Math.max(1, ...ult.map((u) => u.v));
  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] bg-white" style={{ padding: "22px 26px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)" }}>
      <span className="absolute inset-x-0 top-0 h-2.5" style={{ background: cor }} />
      <div className="flex items-center gap-3">
        {Icone && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${cor}1a`, color: cor }}><Icone style={{ width: 26, height: 26 }} strokeWidth={2.4} /></span>}
        <p className="min-w-0 truncate font-extrabold" style={{ fontSize: 25 }}>{s.titulo}</p>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <p className="font-black leading-none tabular-nums" style={{ fontSize: 60, color: cor }}>{fmtKpi(total?.valor ?? null, "n")}</p>
        <p className="mb-1 font-bold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{s.rotulo_item}</p>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Selo cor="#d97706" claro tamanho={16}>{fmtKpi(andamento?.valor ?? null, "n")} em andamento</Selo>
        <Selo cor="#16a34a" claro tamanho={16}>{fmtKpi(concluidas?.valor ?? null, "n")} concluídas</Selo>
      </div>
      <div className="mt-auto flex h-[62px] items-end gap-2 pt-3">
        {ult.map((u, i) => (
          <div key={u.mes} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t-md" style={{ height: `${Math.max(6, (u.v / max) * 44)}px`, background: i === ult.length - 1 ? cor : `${cor}55` }} />
            <span className="font-bold" style={{ fontSize: 13, color: TINTA_SUAVE }}>{rotuloMes(u.mes).slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
