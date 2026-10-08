import { useEffect, useMemo, useState } from "react";
import {
  COR_FASE, MAPA_UF, estatisticasLicitacao, nomeDeCidade, paraItensLicitacao, reaisAbreviado, reaisCurto, urgenciaAbertura, valorDaGrade,
  type LinhaLicitacaoTv, type Municipio,
} from "@/lib/tv/licitacaoTv";
import { misturarCor } from "@/lib/tv/relatorioTv";
import { Barras, Cartao, CartaoKpi, GraficoMensal, Selo, TINTA, TINTA_SUAVE, Vazio } from "./base";

// =====================================================================
// TV — Licitações (mig 20261008000007). O Painel Executivo de
// /app/painel-executivo/tv refeito na linguagem dos relatórios da TV — o
// original NÃO mudou. Mesmo conteúdo, em quatro páginas:
//   · RESUMO: os 4 números do Painel (pipeline, editais, taxa de vitória,
//     aberturas) + o valor ganho, o funil por fase e a evolução de 6 meses;
//   · ONDE ESTAMOS: o mapa — aqui em quadradinhos por UF (o do Painel
//     geocodifica cidade a cidade no OpenStreetMap, um pedido por cidade,
//     o que a TV não pode ficar fazendo a cada volta) — e as cidades com
//     mais processos. A UF que falta na grade sai da própria grade ou da
//     lista de municípios do IBGE, a mesma do Painel (mesmo cache);
//   · POR RESPONSÁVEL: valor e processos (como o Painel);
//   · ABERTURAS E RESULTADOS: os alertas de abertura e os últimos
//     finalizados.
// As contas são as do usePainelLicitacao (src/lib/tv/licitacaoTv.ts).
// =====================================================================

const URGENCIA = { critica: "#ef4444", proxima: "#f59e0b", normal: "#16a34a" } as const;
const VERDE = "#16a34a";
const VERMELHO = "#dc2626";

function useLicitacao(linhas: LinhaLicitacaoTv[], municipios?: Municipio[]) {
  return useMemo(() => estatisticasLicitacao(paraItensLicitacao(linhas), new Date(), municipios), [linhas, municipios]);
}

// Lista de municípios do IBGE: a MESMA chave e formato do cache do Painel
// Executivo (PainelExecutivoTV.tsx) — quem já abriu o Painel no navegador não
// baixa de novo. Sem rede ou sem localStorage, a TV segue só com a grade.
const IBGE_CACHE_KEY = "ibge:municipios:v2";
let municipiosEmMemoria: Municipio[] | null = null;
let buscandoIbge: Promise<Municipio[]> | null = null;

function lerCacheIbge(): Municipio[] | null {
  if (municipiosEmMemoria) return municipiosEmMemoria;
  try {
    const raw = localStorage.getItem(IBGE_CACHE_KEY);
    const lista = raw ? (JSON.parse(raw) as Municipio[]) : null;
    if (Array.isArray(lista) && lista.length) municipiosEmMemoria = lista;
  } catch { /* sem localStorage: busca de novo */ }
  return municipiosEmMemoria;
}

function buscarIbge(): Promise<Municipio[]> {
  if (buscandoIbge) return buscandoIbge;
  buscandoIbge = fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome")
    .then((r) => (r.ok ? r.json() : []))
    .then((data: { nome: string; microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } } }[]) => {
      const lista = data.map((m) => ({ nome: m.nome, uf: m.microrregiao?.mesorregiao?.UF?.sigla ?? "" })).filter((m) => m.uf);
      if (lista.length) {
        municipiosEmMemoria = lista;
        try { localStorage.setItem(IBGE_CACHE_KEY, JSON.stringify(lista)); } catch { /* cheio ou bloqueado */ }
      }
      return lista;
    })
    .catch(() => { buscandoIbge = null; return []; });
  return buscandoIbge;
}

function useMunicipiosIbge(): Municipio[] | undefined {
  const [lista, setLista] = useState<Municipio[] | undefined>(() => lerCacheIbge() ?? undefined);
  useEffect(() => {
    if (lista) return;
    let vivo = true;
    buscarIbge().then((l) => { if (vivo && l.length) setLista(l); });
    return () => { vivo = false; };
  }, [lista]);
  return lista;
}

const dataCurta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");
const quando = (dias: number) => (dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`);
const local = (cidade: string | null, uf: string | null) => [cidade?.trim() ? nomeDeCidade(cidade) : null, uf?.trim().toUpperCase()].filter(Boolean).join("/") || null;

export function PaginaLicitacaoResumo({ itens, cor }: { itens: LinhaLicitacaoTv[]; cor: string }) {
  const s = useLicitacao(itens);
  const pipeline = reaisCurto(s.valorPipeline);
  const ganho = reaisCurto(s.valorGanho);
  // O valor vai em milhões (ou bilhões, se algum mês passar de 1 bi) — o eixo não vira uma régua de zeros.
  const emBilhoes = s.evolucao.some((m) => m.valor >= 1e9);
  const divisor = emBilhoes ? 1e9 : 1e6;
  const evolucao = s.evolucao.map((m) => ({ rotulo: m.rotulo, processos: m.processos, valor: Math.round((m.valor / divisor) * 10) / 10 }));
  const totalFunil = s.porFase.reduce((t, f) => t + f.n, 0);
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid shrink-0 grid-cols-5 gap-6" style={{ height: 214 }}>
        <CartaoKpi rotulo="Pipeline ativo" valor={pipeline.valor} tamanho={64} cor={cor} dica={`${pipeline.unidade} · ${s.ativas.toLocaleString("pt-BR")} editais ativos`} />
        <CartaoKpi rotulo="Contratos ganhos" valor={ganho.valor} tamanho={64} cor={VERDE}
          dica={`${ganho.unidade}${s.pessoasGanhas ? ` · ${s.pessoasGanhas.toLocaleString("pt-BR")} pessoas` : ""}`} />
        <CartaoKpi rotulo="Total de editais" valor={s.total.toLocaleString("pt-BR")} cor="#2563eb" dica={`${s.finalizadas.toLocaleString("pt-BR")} finalizados`} />
        <CartaoKpi rotulo="Taxa de vitória" valor={`${s.taxaVitoria.toFixed(0)}%`} cor={VERDE} dica={`${s.ganhas} ganhos · ${s.perdidas} perdidos`} />
        <CartaoKpi rotulo="Aberturas em 7 dias" valor={s.aberturas7d.toLocaleString("pt-BR")} cor={s.aberturas7d ? "#ea580c" : TINTA_SUAVE}
          dica="editais ativos" destaque={s.aberturas7d > 0} />
      </div>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "1fr 1.45fr" }}>
        <Cartao titulo="Funil por fase" cor={cor} selo={`${totalFunil.toLocaleString("pt-BR")} processos`}>
          {s.porFase.length ? (
            <Barras cor={cor} itens={s.porFase.map((f) => ({
              nome: f.nome, valor: f.n, cor: f.nome === "Não Participado" ? "#a1a1aa" : f.cor,
              dica: totalFunil ? `${Math.round((f.n * 100) / totalFunil)}%` : undefined,
            }))} />
          ) : <Vazio texto="Nenhum processo na grade." />}
        </Cartao>
        <Cartao titulo="Evolução do pipeline — últimos 6 meses" cor={cor} selo="pela data de cadastro">
          <GraficoMensal dados={evolucao} series={[{ chave: "processos", nome: "Processos", cor }]}
            linha={{ chave: "valor", nome: emBilhoes ? "Valor (R$ bilhões)" : "Valor (R$ milhões)", cor: "#0f172a" }} />
        </Cartao>
      </div>
    </div>
  );
}

export function PaginaLicitacaoMapa({ itens, cor }: { itens: LinhaLicitacaoTv[]; cor: string }) {
  const municipios = useMunicipiosIbge();
  const s = useLicitacao(itens, municipios);
  const max = Math.max(1, ...s.porUF.values());
  const comProcesso = [...s.porUF.keys()].filter((uf) => MAPA_UF.some((m) => m.uf === uf));
  const cidades = s.topCidades.slice(0, 8);
  const estados = [...s.porUF.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="grid h-full gap-6" style={{ gridTemplateColumns: "1.15fr 1fr" }}>
      <Cartao titulo="Processos por estado" cor={cor} selo={`${comProcesso.length} estados`}>
        <div className="flex h-full items-center justify-center gap-10">
          <div className="grid h-full" style={{ gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "repeat(8, 1fr)", gap: 8, aspectRatio: "7 / 8" }}>
            {MAPA_UF.map(({ uf, col, lin }) => {
              const n = s.porUF.get(uf) ?? 0;
              const t = n ? Math.sqrt(n / max) : 0;
              const fundo = n ? misturarCor(cor, "#ffffff", 0.82 - t * 0.82) : "#f4f4f5";
              const claro = t > 0.45;
              return (
                <div key={uf} className="flex flex-col items-center justify-center rounded-2xl"
                  style={{ gridColumn: col + 1, gridRow: lin + 1, background: fundo, color: n ? (claro ? "#fff" : misturarCor(cor, "#000000", 0.35)) : "#a1a1aa" }}>
                  <span className="font-extrabold leading-none" style={{ fontSize: 20 }}>{uf}</span>
                  {n > 0 && <span className="mt-1 font-black leading-none tabular-nums" style={{ fontSize: 26 }}>{n}</span>}
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-col gap-4">
            <p className="font-bold uppercase tracking-wide" style={{ fontSize: 18, color: TINTA_SUAVE }}>Mais processos</p>
            {estados.map(([uf, n]) => (
              <div key={uf} className="flex items-baseline gap-3">
                <span className="font-black" style={{ fontSize: 30, color: cor, minWidth: 54 }}>{uf}</span>
                <span className="font-black tabular-nums" style={{ fontSize: 30 }}>{n}</span>
                <span className="font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{Math.round((n * 100) / Math.max(1, s.total))}%</span>
              </div>
            ))}
            {s.semUF > 0 && (
              <p className="mt-2 max-w-[220px] font-semibold leading-snug" style={{ fontSize: 18, color: TINTA_SUAVE }}>
                + {s.semUF} sem estado identificado na grade
              </p>
            )}
          </div>
        </div>
      </Cartao>
      <Cartao titulo="Cidades com mais processos" cor={cor} selo={`${s.topCidades.length} cidades`}>
        {cidades.length ? (
          <Barras cor={cor} itens={cidades.map((c) => ({ nome: local(c.cidade, c.uf) ?? c.cidade, valor: c.n }))} />
        ) : <Vazio texto="Nenhuma cidade informada." />}
      </Cartao>
    </div>
  );
}

export function PaginaLicitacaoResponsaveis({ itens, cor }: { itens: LinhaLicitacaoTv[]; cor: string }) {
  const s = useLicitacao(itens);
  const porQtd = [...s.porResponsavel].sort((a, b) => b.qtd - a.qtd);
  return (
    <div className="grid h-full grid-cols-2 gap-6">
      <Cartao titulo="Valor por responsável" cor={cor} selo="processos participados">
        {s.porResponsavel.length ? (
          <Barras cor={cor} itens={s.porResponsavel.map((r) => ({ nome: r.nome, valor: r.valor, rotulo: reaisAbreviado(r.valor) ?? "R$ 0" }))} />
        ) : <Vazio texto="Nenhum processo participado." />}
      </Cartao>
      <Cartao titulo="Processos por responsável" cor={cor} selo="e vitórias">
        {porQtd.length ? (
          <Barras cor="#7c3aed" itens={porQtd.map((r) => ({
            nome: r.nome, valor: r.qtd,
            dica: r.vitorias || r.perdidas ? `${r.vitorias} ${r.vitorias === 1 ? "vitória" : "vitórias"}${r.taxa != null ? ` · ${Math.round(r.taxa)}%` : ""}` : undefined,
          }))} />
        ) : <Vazio texto="Nenhum processo participado." />}
      </Cartao>
    </div>
  );
}

export function PaginaLicitacaoAberturas({ itens, cor }: { itens: LinhaLicitacaoTv[]; cor: string }) {
  const s = useLicitacao(itens);
  const proximas = s.proximasAberturas.slice(0, 6);
  return (
    <div className="grid h-full gap-6" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
      <Cartao titulo="Próximas aberturas" cor={cor} selo={s.aberturas7d ? `${s.aberturas7d} em até 7 dias` : "nenhuma em 7 dias"}>
        {proximas.length ? (
          <div className="flex h-full flex-col justify-around">
            {proximas.map(({ item, dias }) => {
              const c = URGENCIA[urgenciaAbertura(dias) ?? "normal"];
              return (
                <div key={item.id} className="flex items-center gap-5 border-b border-zinc-100 pb-2 last:border-0">
                  <span className="shrink-0 rounded-2xl px-3 py-2 text-center font-black tabular-nums leading-none text-white" style={{ fontSize: 30, minWidth: 128, background: c }}>
                    {dataCurta(item.data)}<span className="mt-1 block font-bold" style={{ fontSize: 16 }}>{quando(dias)}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold" style={{ fontSize: 24 }}>{item.edital || "Sem edital"} · {item.objeto || "Sem objeto"}</p>
                    <p className="truncate font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}>
                      {[item.empresa, local(item.cidade, item.uf), item.responsavel?.toUpperCase(), reaisAbreviado(valorOuNull(item.valor_global))].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Selo cor={COR_FASE[item.fase] ?? cor} claro tamanho={15}>{item.fase}</Selo>
                </div>
              );
            })}
          </div>
        ) : <Vazio texto="Nenhuma abertura marcada nos editais ativos." />}
      </Cartao>
      <Cartao titulo="Últimos resultados" cor={cor} selo={`${s.ganhas} ganhos · ${s.perdidas} perdidos`}>
        {s.ultimosResultados.length ? (
          <div className="flex h-full flex-col justify-around">
            {s.ultimosResultados.map(({ item, ganhou }) => (
              <div key={item.id} className="flex items-center gap-4 border-b border-zinc-100 pb-2 last:border-0">
                <span className="shrink-0 rounded-2xl px-3 py-2 text-center font-black uppercase leading-none text-white" style={{ fontSize: 18, minWidth: 112, background: ganhou ? VERDE : VERMELHO }}>
                  {ganhou ? "Ganho" : "Perdido"}
                  <span className="mt-1 block font-bold normal-case" style={{ fontSize: 15 }}>{item.posicao ? `${item.posicao}º lugar` : "sem posição"}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold" style={{ fontSize: 22, color: TINTA }}>{item.edital || "Sem edital"} · {item.objeto || "Sem objeto"}</p>
                  <p className="truncate font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>
                    {[local(item.cidade, item.uf), reaisAbreviado(valorOuNull(item.valor_global))].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : <Vazio texto="Nenhum processo finalizado ainda." />}
      </Cartao>
    </div>
  );
}

/** Valor da grade em número, ou null se não tem (para não escrever "R$ 0"). */
function valorOuNull(v: string | null): number | null {
  const n = valorDaGrade(v);
  return n > 0 ? n : null;
}
