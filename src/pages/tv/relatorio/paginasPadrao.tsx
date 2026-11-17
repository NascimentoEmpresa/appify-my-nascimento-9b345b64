import { fmtKpi, rotuloMes, sistemaPorSlug, type RelatorioDados } from "@/pages/relatorios/sistemas";
import {
  comparativoGeralTv, maiores, misturarCor, rankingsParaTv, resumoGeralTv, rotuloTv, semCodigo, semMesesVaziosNoInicio, serieDaDireita, serieDoQuadro, statusEmGrupos, textoVariacao, type SistemaGeral,
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

/**
 * Relatório Geral — "Todos os setores" (18/11/2026). Pablo, com o print do
 * Relatório Geral do ERP: "A tv tem que aparecer tipo isso, mas mais bonito,
 * completo e detalhado". Os números somados no topo (com a taxa de conclusão
 * e o tempo médio) e um quadro por sistema — os 8 de solicitação e o
 * Turn-over — com a variação contra o período anterior, a situação e os 12
 * meses; a vaga que sobra na grade vira "Onde olhar" (maior volume, mais
 * parado, mais lento). Contas em resumoGeralTv (src/lib/tv/relatorioTv.ts).
 */
export function PaginaGeral({ sistemas }: { sistemas: SistemaGeral[] }) {
  const r = resumoGeralTv(sistemas);
  const topo: { rotulo: string; valor: string; cor: string; dica: string }[] = [
    { rotulo: "Solicitações no período", valor: r.total.toLocaleString("pt-BR"), cor: "#2563eb", dica: `${r.solicitacoes.length} sistemas somados` },
    { rotulo: "Em andamento", valor: r.andamento.toLocaleString("pt-BR"), cor: "#d97706", dica: "ainda não concluídas" },
    { rotulo: "Concluídas", valor: r.concluidas.toLocaleString("pt-BR"), cor: "#16a34a", dica: r.taxaConclusao != null ? `${fmtKpi(r.taxaConclusao, "pct")} do total` : "—" },
    { rotulo: "Tempo médio até concluir", valor: fmtKpi(r.tempoMedio, "dias"), cor: "#0891b2", dica: "da abertura à conclusão" },
    { rotulo: "Recusadas / canceladas", valor: r.recusadas.toLocaleString("pt-BR"), cor: "#dc2626",
      dica: r.total ? `${fmtKpi(Math.round((r.recusadas * 1000) / r.total) / 10, "pct")} do total` : "no período" },
  ];
  const quadros = [...r.solicitacoes, ...(r.turnover ? [r.turnover] : [])];
  const colunas = Math.max(4, Math.ceil(quadros.length / 2));
  const sobraVaga = quadros.length < colunas * 2 && r.solicitacoes.length > 1;
  return (
    <div className="flex h-full flex-col gap-5">
      <div className="grid shrink-0 grid-cols-5 gap-5" style={{ height: 128 }}>
        {topo.map((k) => <Placa key={k.rotulo} {...k} />)}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-5" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
        {quadros.map((s) => <QuadroSistema key={s.slug} s={s} />)}
        {sobraVaga && <QuadroOndeOlhar solicitacoes={r.solicitacoes} />}
      </div>
    </div>
  );
}

const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const SOMBRA = "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)";

function Placa({ rotulo, valor, cor, dica }: { rotulo: string; valor: string; cor: string; dica: string }) {
  return (
    <div className="relative flex min-w-0 flex-col justify-center overflow-hidden rounded-[24px] bg-white" style={{ padding: "16px 24px 16px 30px", boxShadow: SOMBRA }}>
      <span className="absolute inset-y-0 left-0 w-2" style={{ background: cor }} />
      <p className="truncate font-bold uppercase tracking-wide" style={{ fontSize: 17, color: TINTA_SUAVE }}>{rotulo}</p>
      <p className="truncate font-black leading-none tabular-nums" style={{ fontSize: 50, color: cor, marginTop: 6 }}>{valor}</p>
      <p className="mt-1.5 truncate font-semibold" style={{ fontSize: 17, color: TINTA_SUAVE }}>{dica}</p>
    </div>
  );
}

/** "Onde olhar": o sistema com mais volume, o com mais em andamento e o mais lento até concluir. */
function QuadroOndeOlhar({ solicitacoes }: { solicitacoes: SistemaGeral[] }) {
  const linhas = comparativoGeralTv(solicitacoes);
  const maior = linhas[0];
  const parado = [...linhas].sort((a, b) => b.andamento - a.andamento)[0];
  const lento = [...linhas].filter((l) => l.tempo != null).sort((a, b) => (b.tempo ?? 0) - (a.tempo ?? 0))[0];
  const itens = [
    maior && { rotulo: "Maior volume", nome: maior.titulo, valor: `${maior.total.toLocaleString("pt-BR")} no período`, cor: "#2563eb" },
    parado?.andamento && { rotulo: "Mais em andamento", nome: parado.titulo, valor: `${parado.andamento.toLocaleString("pt-BR")} abertas`, cor: "#d97706" },
    lento && { rotulo: "Mais lento até concluir", nome: lento.titulo, valor: fmtKpi(lento.tempo, "dias"), cor: "#0891b2" },
  ].filter(Boolean) as { rotulo: string; nome: string; valor: string; cor: string }[];
  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[26px]" style={{ padding: "18px 22px", background: "linear-gradient(150deg, #1e3a8a 0%, #172554 100%)", color: "#fff", boxShadow: SOMBRA }}>
      <p className="font-extrabold" style={{ fontSize: 22 }}>Onde olhar</p>
      <div className="mt-2 flex min-h-0 flex-1 flex-col justify-around gap-2">
        {itens.map((i) => (
          <div key={i.rotulo} className="min-w-0 rounded-2xl px-3.5 py-2" style={{ background: "rgba(255,255,255,0.09)", borderLeft: `5px solid ${i.cor}` }}>
            <p className="truncate font-bold uppercase tracking-wide" style={{ fontSize: 12, opacity: 0.75 }}>{i.rotulo}</p>
            <p className="truncate font-extrabold leading-tight" style={{ fontSize: 19 }}>{i.nome}</p>
            <p className="truncate font-black tabular-nums leading-tight" style={{ fontSize: 17, color: misturarCor(i.cor, "#ffffff", 0.45) }}>{i.valor}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** As três "pílulas" e a linha de detalhe de cada quadro — o Turn-over tem outros números. */
function detalheDoQuadro(s: SistemaGeral): { pilulas: { texto: string; cor: string }[]; linha: string | null } {
  const v = (i: number) => num(s.kpis[i]?.valor);
  if (s.slug === "turnover") {
    const saldo = v(3);
    return {
      pilulas: [{ texto: `${fmtKpi(v(1), "n")} admitidos`, cor: "#16a34a" }, { texto: `${fmtKpi(v(2), "n")} desligados`, cor: "#dc2626" }],
      linha: saldo == null ? null : `Saldo ${saldo > 0 ? "+" : ""}${saldo.toLocaleString("pt-BR")} · ${fmtKpi(v(4), "n")} saíram em até 90 dias`,
    };
  }
  return {
    pilulas: [
      { texto: `${fmtKpi(v(1), "n")} em andamento`, cor: "#d97706" },
      { texto: `${fmtKpi(v(2), "n")} concluídas`, cor: "#16a34a" },
      ...((v(3) ?? 0) > 0 ? [{ texto: `${fmtKpi(v(3), "n")} recusadas`, cor: "#dc2626" }] : []),
    ],
    linha: v(4) != null ? `${fmtKpi(v(4), "dias")} em média até concluir` : null,
  };
}

function QuadroSistema({ s }: { s: SistemaGeral }) {
  const meta = sistemaPorSlug(s.slug);
  const cor = meta?.cor ?? "#2563eb";
  const Icone = meta?.icone;
  const principal = s.kpis[0];
  const variacao = textoVariacao(principal?.variacao);
  // Turn-over: subir é ruim; nos outros, só o sentido (sem juízo de bom/ruim) — cinza.
  const corVariacao = !variacao ? TINTA_SUAVE : s.slug === "turnover" ? (variacao.sobe ? "#dc2626" : "#16a34a") : "#52525b";
  const { pilulas, linha } = detalheDoQuadro(s);
  const serie = semMesesVaziosNoInicio(serieDoQuadro(s), ["v"], 6).slice(-12);
  const max = Math.max(1, ...serie.map((u) => u.v));
  const pct = s.slug === "turnover";
  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[26px] bg-white" style={{ padding: "18px 22px 14px", boxShadow: SOMBRA }}>
      <span className="absolute inset-x-0 top-0 h-2" style={{ background: cor }} />
      <div className="flex items-center gap-2.5">
        {Icone && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${cor}1a`, color: cor }}><Icone style={{ width: 23, height: 23 }} strokeWidth={2.4} /></span>}
        <p className="min-w-0 flex-1 truncate font-extrabold" style={{ fontSize: 22 }}>{s.titulo}</p>
      </div>
      <div className="mt-2 flex items-end gap-2.5">
        <p className="font-black leading-none tabular-nums" style={{ fontSize: 50, color: cor }}>{fmtKpi(num(principal?.valor), principal?.formato ?? "n")}</p>
        <div className="mb-0.5 min-w-0">
          {variacao && <p className="font-extrabold tabular-nums leading-tight" style={{ fontSize: 16, color: corVariacao }}>{variacao.sobe ? "▲" : "▼"} {variacao.texto}</p>}
          <p className="truncate font-bold leading-tight" style={{ fontSize: 15, color: TINTA_SUAVE }}>{pct ? "médio mensal" : s.rotulo_item}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pilulas.map((p) => <Selo key={p.texto} cor={p.cor} claro tamanho={13}>{p.texto}</Selo>)}
      </div>
      {linha && <p className="mt-1.5 truncate font-semibold" style={{ fontSize: 15, color: TINTA_SUAVE }}>{linha}</p>}
      <div className="mt-auto flex items-end gap-1 pt-2" style={{ height: 78 }}>
        {serie.map((u, i) => {
          const ultima = i === serie.length - 1;
          return (
            <div key={u.mes} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5">
              {ultima && <span className="font-black tabular-nums leading-none" style={{ fontSize: 13, color: cor }}>{pct ? `${u.v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : u.v.toLocaleString("pt-BR")}</span>}
              <div className="w-full rounded-t" style={{ height: `${Math.max(4, (u.v / max) * 44)}px`, background: ultima ? cor : `${cor}59` }} />
              <span className="font-bold leading-none" style={{ fontSize: 11, color: TINTA_SUAVE }}>{rotuloMes(u.mes).slice(0, 1).toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Relatório Geral — "Comparativo": a situação de cada sistema numa barra só
 * (concluídas, em andamento, recusadas), o tempo médio até concluir e o
 * turn-over mês a mês (admitidos × desligados, com a taxa).
 */
export function PaginaGeralComparativo({ sistemas }: { sistemas: SistemaGeral[] }) {
  const r = resumoGeralTv(sistemas);
  const linhas = comparativoGeralTv(r.solicitacoes);
  const max = Math.max(1, ...linhas.map((l) => l.total));
  const tempos = linhas.filter((l) => l.tempo != null).sort((a, b) => (b.tempo ?? 0) - (a.tempo ?? 0));
  const t = r.turnover;
  const dadosTurnover = t ? semMesesVaziosNoInicio(t.mensal.dados, ["admitidos", "desligados"]).map((m) => ({ ...m, rotulo: rotuloMes(m.mes).slice(0, 3) })) : [];
  return (
    <div className="grid h-full gap-6" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
      <Cartao titulo="Solicitações por sistema" cor="#2563eb" selo={`${r.total.toLocaleString("pt-BR")} no período`}>
        <div className="flex h-full flex-col">
          <div className="mb-2 flex gap-5">
            {[["Concluídas", COR_GRUPO.concluido], ["Em andamento", COR_GRUPO.aberto], ["Recusadas", COR_GRUPO.recusado]].map(([n, c]) => (
              <span key={n} className="inline-flex items-center gap-2 font-bold" style={{ fontSize: 18, color: TINTA_SUAVE }}><span className="h-4 w-4 rounded" style={{ background: c }} />{n}</span>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-around">
            {linhas.map((l) => {
              const meta = sistemaPorSlug(l.slug);
              return (
                <div key={l.slug} className="flex items-center gap-4">
                  <p className="w-[250px] shrink-0 truncate font-bold" style={{ fontSize: 21 }}>
                    <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: meta?.cor ?? TINTA_SUAVE }} />{l.titulo}
                  </p>
                  <div className="flex h-7 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "#f1f1f3" }}>
                    <div className="flex h-full" style={{ width: `${Math.max(1, (l.total / max) * 100)}%` }}>
                      {[[l.concluidas, COR_GRUPO.concluido], [l.andamento, COR_GRUPO.aberto], [l.recusadas, COR_GRUPO.recusado]].map(([n, c], i) =>
                        Number(n) > 0 ? <div key={i} className="h-full" style={{ flexGrow: Number(n), background: String(c) }} /> : null)}
                    </div>
                  </div>
                  <p className="w-[170px] shrink-0 text-right font-black tabular-nums" style={{ fontSize: 24 }}>
                    {l.total.toLocaleString("pt-BR")}
                    {l.pctConcluidas != null && <span className="ml-2 font-bold" style={{ fontSize: 16, color: COR_GRUPO.concluido }}>{l.pctConcluidas}% concl.</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </Cartao>
      <div className="flex min-h-0 flex-col gap-6">
        <Cartao titulo="Tempo médio até concluir" cor="#0891b2" selo={r.tempoMedio != null ? `média ${fmtKpi(r.tempoMedio, "dias")}` : null} className="flex-1">
          {/* Grade de 2 colunas: cabem os 8 sistemas (em lista, o cartão cortava a partir do 5º). */}
          {tempos.length ? (
            <div className="grid h-full grid-cols-2 content-around gap-x-6 gap-y-2">
              {tempos.map((l) => (
                <div key={l.slug} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate font-semibold" style={{ fontSize: 18 }}>{l.titulo}</p>
                    <p className="shrink-0 font-black tabular-nums" style={{ fontSize: 21, color: "#0891b2" }}>{fmtKpi(l.tempo, "dias")}</p>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: "#f1f1f3" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, ((l.tempo ?? 0) / Math.max(1, tempos[0].tempo ?? 1)) * 100)}%`, background: "#0891b2" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <Vazio />}
        </Cartao>
        {t && (
          <Cartao titulo="Turn-over mês a mês" cor={sistemaPorSlug("turnover")?.cor ?? "#c2410c"} selo={`${fmtKpi(num(t.kpis[0]?.valor), "pct")} médio`} className="flex-1">
            <GraficoMensal dados={dadosTurnover} rotuloTopo={false}
              series={[{ chave: "admitidos", nome: "Admitidos", cor: "#16a34a" }, { chave: "desligados", nome: "Desligados", cor: "#ef4444" }]}
              linha={t.mensal.series.some((x) => x.chave === "taxa") ? { chave: "taxa", nome: "Turn-over", cor: "#0f172a", sufixo: "%" } : null} />
          </Cartao>
        )}
      </div>
    </div>
  );
}
