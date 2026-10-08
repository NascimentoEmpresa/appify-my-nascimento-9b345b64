import { useEffect, useMemo, useState } from "react";
import { Briefcase, Gavel, GraduationCap, LayoutDashboard, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SISTEMAS, sistemaPorSlug, type RelatorioDados, type RelatorioGeralDados } from "@/pages/relatorios/sistemas";
import { periodoTv, relatorioTemFiltros, rotuloPeriodoTv, tituloRelatorioTv, type ItemTv } from "@/lib/tv/tv";
import { rotuloMeses } from "@/lib/diretoria/turnover";
import type { LinhaLicitacaoTv } from "@/lib/tv/licitacaoTv";
import { corDoRelatorioTv, mesesTurnoverTv, paginasDoRelatorio, tempoDaPaginaMs, type DadosRelTv } from "@/lib/tv/relatorioTv";
import { Aviso, Moldura, Palco } from "./relatorio/base";
import { PaginaDestaques, PaginaGeral, PaginaResumo } from "./relatorio/paginasPadrao";
import { PaginaVagasAndamento, PaginaVagasContratos, PaginaVagasResumo } from "./relatorio/paginasVagas";
import { PaginaTurnoverContratos, PaginaTurnoverLimites, PaginaTurnoverResumo } from "./relatorio/paginasTurnover";
import { PaginaLicitacaoAberturas, PaginaLicitacaoMapa, PaginaLicitacaoResponsaveis, PaginaLicitacaoResumo } from "./relatorio/paginasLicitacao";
import { PaginaTrnCursos, PaginaTrnEngajamento, PaginaTrnGeral } from "./relatorio/paginasTreinamentos";

// =====================================================================
// Relatório do ERP na TV (Sistemas › TV's)
//
// 07/10/2026 (mig 20261007000014): "compatível com TV: tela cheia, sem
// precisar mexer nem descer". Os números vêm de tv_relatorio(token, item) —
// a mesma conta dos Relatórios, só da playlist desta TV. Cache de 5 min por
// item: a playlist gira sem reconsultar a cada volta.
// PRÉVIA (gestão, sem token de TV): os mesmos números pelas RPCs dos
// Relatórios, com o login de quem está montando a playlist, mesmo período e
// contrato.
//
// 08/10/2026 (mig 20261008000004) — "colocar TODOS os relatórios nas TVs,
// adaptados (o layout da TV pode cortar), e melhorar completamente os que
// existem, tá muito seco e feio" (referência: carmed.vercel.app):
//   · TODOS: Geral, os 9 padrão, Turn-over no formato do painel e o Vagas —
//     Dashboard;
//   · PALCO FIXO 1920×1080 que encolhe para caber (relatorio/base.tsx) —
//     não corta em nenhuma TV, com margem contra o overscan;
//   · PÁGINAS que se revezam dentro do tempo do item (cada relatório tem 1 a
//     3; o rodapé mostra qual e a barra do tempo) — nada espremido;
//   · visual novo: faixa da cor do relatório, cartões brancos com sombra,
//     selos, números grandes, Sofia Sans.
// Regras em src/lib/tv/relatorioTv.ts (com teste).
//
// 08/10/2026 (mig 20261008000007): LICITAÇÕES (o Painel Executivo de
// /app/painel-executivo/tv refeito para cá — o original não mudou; contas
// em src/lib/tv/licitacaoTv.ts) e TREINAMENTOS (o Dashboard do módulo).
// Os dois mostram o todo, como as telas de origem: sem período nem
// contrato. Na prévia, cada um exige a liberação da tela de origem
// (tv_licitacao_previa → Painel Executivo; trn_dashboard → Treinamentos).
// =====================================================================

const CACHE = new Map<string, { em: number; dados: DadosRelTv }>();
const VALIDADE_MS = 5 * 60_000;
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

const ORDEM_GERAL = ["recrutamento", "demissoes", "materiais", "ferias", "medida-disciplinar", "mudanca-funcao", "chamados", "orientacoes"];

/** Cor e ícone de cada relatório na TV. */
function aparencia(slug: string | null | undefined): { cor: string; Icone: LucideIcon } {
  const Icone = slug === "geral" ? LayoutDashboard : slug === "vagas" ? Briefcase : slug === "licitacoes" ? Gavel : slug === "treinamentos" ? GraduationCap
    : sistemaPorSlug(slug ?? "")?.icone ?? LayoutDashboard;
  return { cor: corDoRelatorioTv(slug), Icone };
}

/** Prévia: busca com o login de quem está na gestão, no formato que a TV recebe. */
async function carregarPrevia(item: ItemTv): Promise<DadosRelTv> {
  const { de, ate } = periodoTv(item.rel_periodo);
  const args = { _de: de, _ate: ate, _contrato: item.rel_contrato ?? null, _meses: null };
  const contrato = item.rel_contrato_nome ?? null;
  const ok = <T,>({ data, error }: { data: T; error: { message: string } | null }) => { if (error) throw new Error(error.message); return data; };

  if (item.relatorio === "geral") {
    const g = ok(await rpc("dir_rel_geral", args)) as RelatorioGeralDados;
    return { tipo: "geral", periodo: { de, ate }, contrato,
             sistemas: ORDEM_GERAL.filter((s) => g[s]).map((s) => ({ slug: s, titulo: g[s].titulo, kpis: g[s].kpis, rotulo_item: g[s].rotulo_item, mensal: g[s].mensal })) };
  }
  if (item.relatorio === "vagas") {
    return { tipo: "vagas", periodo: { de, ate }, contrato, painel: ok(await rpc("dir_vagas_painel", args)) };
  }
  if (item.relatorio === "licitacoes") {
    return { tipo: "licitacoes", contrato: null, ...(ok(await rpc("tv_licitacao_previa")) as { itens: LinhaLicitacaoTv[]; gerado_em?: string }) };
  }
  if (item.relatorio === "treinamentos") {
    return { tipo: "treinamentos", contrato: null, painel: ok(await rpc("trn_dashboard", { _curso: null, _de: null, _ate: null })) };
  }
  if (item.relatorio === "turnover") {
    const { ano, meses } = mesesTurnoverTv(de, ate);
    const filial = item.rel_contrato ? (ok(await rpc("dir_turnover_filial", { _contrato: item.rel_contrato })) as string | null) : null;
    const painel = ok(await rpc("dir_turnover_painel", { _ano: ano, _mes: null, _contrato: filial, _causas: null, _meses: meses }));
    return { tipo: "turnover", painel, filial, contrato };
  }
  const s = SISTEMAS.find((x) => x.slug === item.relatorio);
  if (!s) throw new Error("Relatório desconhecido.");
  return { ...(ok(await rpc(s.rpc, args)) as RelatorioDados), tipo: "sistema", slug: s.slug, contrato };
}

export function TvRelatorio({ item, token, previa = false }: { item: ItemTv; token: string; previa?: boolean }) {
  const [dados, setDados] = useState<DadosRelTv | null>(CACHE.get(item.id)?.dados ?? null);
  const [erro, setErro] = useState<string | null>(null);

  const comFiltros = relatorioTemFiltros(item.relatorio);
  const chavePrevia = previa ? (comFiltros ? `${item.relatorio}|${item.rel_periodo}|${item.rel_contrato ?? ""}` : item.relatorio ?? "") : "";
  useEffect(() => {
    let vivo = true;
    if (previa) {
      setDados(null); setErro(null);
      carregarPrevia(item).then((d) => { if (vivo) setDados(d); }, (e) => { if (vivo) setErro((e as Error).message); });
      return () => { vivo = false; };
    }
    const c = CACHE.get(item.id);
    if (c && Date.now() - c.em < VALIDADE_MS) { setDados(c.dados); return; }
    rpc("tv_relatorio", { p_token: token, p_item: item.id }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setErro(error.message); return; }
      CACHE.set(item.id, { em: Date.now(), dados: data as DadosRelTv });
      setDados(data as DadosRelTv); setErro(null);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, token, previa, chavePrevia]);

  // A TV antiga (antes da mig 20261008000004) mandava o Turn-over como sistema padrão: segue funcionando.
  const slug = item.relatorio ?? (dados?.tipo === "sistema" ? dados.slug : null);
  const { cor, Icone } = aparencia(slug);
  const paginas = useMemo(() => (dados ? paginasDoRelatorio(dados) : []), [dados]);
  const duracaoMs = tempoDaPaginaMs(item.duracao_seg, paginas.length);
  const [pagina, setPagina] = useState(0);
  useEffect(() => { setPagina(0); }, [paginas.length, item.id]);
  useEffect(() => {
    if (paginas.length < 2) return;
    const t = window.setTimeout(() => setPagina((p) => (p + 1) % paginas.length), duracaoMs);
    return () => window.clearTimeout(t);
  }, [pagina, paginas.length, duracaoMs]);

  const titulo = item.titulo || tituloRelatorioTv(item.relatorio);
  const contratoNome = dados?.contrato ?? null;
  const selos = !comFiltros
    ? (item.relatorio === "licitacoes" ? ["Todas as empresas do grupo", "Grade completa"] : ["Toda a base de alunos", "Desde o início"])
    : [
      dados?.tipo === "turnover" ? `${dados.painel.ano} · ${rotuloMeses(dados.painel.meses)}` : rotuloPeriodoTv(item.rel_periodo),
      contratoNome
        ? (dados?.tipo === "turnover" && !dados.filial ? `${contratoNome} — sem dados de turn-over, mostrando o grupo` : contratoNome)
        : "Todos os contratos",
    ];
  const atualizado = dados?.gerado_em ? new Date(dados.gerado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : dados ? new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
  const atual = paginas[Math.min(pagina, Math.max(0, paginas.length - 1))]?.chave;

  return (
    <Palco>
      <Moldura cor={cor} Icone={Icone} titulo={titulo} selos={selos} paginas={paginas.length ? paginas : [{ chave: "-", titulo: "Carregando" }]}
        pagina={Math.min(pagina, Math.max(0, paginas.length - 1))} duracaoMs={duracaoMs} atualizado={atualizado}>
        {!dados ? (
          erro ? <Aviso cor={cor} titulo="Não foi possível carregar o relatório" sub={erro} girando={false} />
            : <Aviso cor={cor} titulo="Carregando os números do ERP…" />
        ) : atual === "geral" && dados.tipo === "geral" ? <PaginaGeral sistemas={dados.sistemas} />
          : atual === "vagas-resumo" && dados.tipo === "vagas" ? <PaginaVagasResumo p={dados.painel} cor={cor} />
          : atual === "vagas-andamento" && dados.tipo === "vagas" ? <PaginaVagasAndamento p={dados.painel} cor={cor} />
          : atual === "vagas-contratos" && dados.tipo === "vagas" ? <PaginaVagasContratos p={dados.painel} cor={cor} />
          : atual === "turnover-resumo" && dados.tipo === "turnover" ? <PaginaTurnoverResumo p={dados.painel} cor={cor} />
          : atual === "turnover-contratos" && dados.tipo === "turnover" ? <PaginaTurnoverContratos p={dados.painel} cor={cor} />
          : atual === "turnover-limites" && dados.tipo === "turnover" ? <PaginaTurnoverLimites p={dados.painel} cor={cor} />
          : atual === "lic-resumo" && dados.tipo === "licitacoes" ? <PaginaLicitacaoResumo itens={dados.itens} cor={cor} />
          : atual === "lic-mapa" && dados.tipo === "licitacoes" ? <PaginaLicitacaoMapa itens={dados.itens} cor={cor} />
          : atual === "lic-responsaveis" && dados.tipo === "licitacoes" ? <PaginaLicitacaoResponsaveis itens={dados.itens} cor={cor} />
          : atual === "lic-aberturas" && dados.tipo === "licitacoes" ? <PaginaLicitacaoAberturas itens={dados.itens} cor={cor} />
          : atual === "trn-geral" && dados.tipo === "treinamentos" ? <PaginaTrnGeral p={dados.painel} cor={cor} />
          : atual === "trn-engajamento" && dados.tipo === "treinamentos" ? <PaginaTrnEngajamento p={dados.painel} cor={cor} />
          : atual === "trn-cursos" && dados.tipo === "treinamentos" ? <PaginaTrnCursos p={dados.painel} cor={cor} />
          : atual === "sistema-detalhe" && dados.tipo === "sistema" ? <PaginaDestaques d={dados} cor={cor} />
          : dados.tipo === "sistema" ? <PaginaResumo d={dados} cor={cor} />
          : <Aviso cor={cor} titulo="Relatório sem página" girando={false} />}
      </Moldura>
    </Palco>
  );
}
