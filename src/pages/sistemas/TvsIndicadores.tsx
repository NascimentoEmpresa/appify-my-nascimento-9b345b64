import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Loader2, MonitorPlay, Pencil, Plus, RefreshCw, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { TvRelatorio } from "@/pages/tv/TvRelatorio";
import { IaIndicadorDialog } from "@/components/tv/IaIndicador";
import {
  COR_SITUACAO, PAINEIS_GERENCIAIS, VISUAIS_GERENCIAIS, type VisualGerencial, ROTULO_FONTE, ROTULO_PERIODICIDADE, ROTULO_SITUACAO, formatarValor, frase, indicadoresDaTv,
  lancamentoAtrasado, placar, situacao, subindicadores, textoMeta, type IndicadorGerencial, type LinhaDetalhe, type PainelGerencial,
  CORES_EQUIPE, formatarMetaEquipe, type MetaEquipe,
} from "@/lib/tv/gerencial";

// =====================================================================
// TV's › INDICADORES GERENCIAIS (12/10/2026, mig 20261012000001) — SIS-2026-0635
//
// A outra metade do documento "Indicadores das TVs": a TV mostra o resumo;
// aqui fica o que "permanece disponível no sistema ou no computador do líder":
//   · DETALHAMENTO POR CLIQUE — cada indicador abre com a regra de cálculo,
//     o por contrato/cidade, os subindicadores e o histórico;
//   · PARAMETRIZAÇÃO — meta, limite de atenção, sentido, periodicidade,
//     responsável, o parâmetro do cálculo (dias, prazo…) e se vai para a TV;
//   · LANÇAMENTO — o número dos indicadores que o ERP não tem (margem real,
//     ASO, eSocial…), com contrato afetado, causa, responsável e impacto.
// Liberação: tvs_gerenciais (visualizar / incluir lançamento / alterar
// parâmetros / excluir lançamento). Regras em src/lib/tv/gerencial.ts.
// =====================================================================

const sb = supabase as any;
const MENU = "tvs_gerenciais";
const K = "tvs-gerenciais";

interface Lancamento {
  id: string; indicador: string; referencia: string; valor: number; afetado: string | null; causa: string | null; responsavel: string | null;
  impacto: number | null; detalhe: LinhaDetalhe[]; observacao: string | null; created_at: string; created_by_nome: string | null;
}

const usePainel = (slug: string) => useQuery({
  queryKey: [K, "painel", slug], staleTime: 60_000,
  queryFn: async (): Promise<PainelGerencial> => {
    const { data, error } = await sb.rpc("tvg_painel", { p_painel: slug });
    if (error) throw error;
    return data;
  },
});

const useLancamentos = (codigo: string | null) => useQuery({
  queryKey: [K, "lancamentos", codigo], enabled: !!codigo,
  queryFn: async (): Promise<Lancamento[]> => {
    const { data, error } = await sb.from("TVG_LANCAMENTO").select("*").eq("indicador", codigo).order("referencia", { ascending: false }).order("created_at", { ascending: false }).limit(24);
    if (error) throw error;
    return data ?? [];
  },
});

const fmtData = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR") : "—");
const fmtDataHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const numOuNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));

export default function TvsIndicadores() {
  const [slug, setSlug] = useState(PAINEIS_GERENCIAIS[0].slug);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTv, setVerTv] = useState(false);
  const [visual, setVisual] = useState<VisualGerencial>("dashboard");
  // I.A "de onde vem este número?" (14/10/2026, Edge tvg-ia): clique na prévia ou no detalhe.
  const [ia, setIa] = useState<{ codigo: string; nome: string } | null>(null);
  const painel = usePainel(slug);
  const qc = useQueryClient();
  const info = PAINEIS_GERENCIAIS.find((p) => p.slug === slug)!;
  const naTv = indicadoresDaTv(painel.data);
  const subsPainel = subindicadores(painel.data, null);
  const pl = placar(naTv);
  const selecionado = painel.data?.indicadores.find((i) => i.codigo === aberto) ?? null;
  const diretorias = [...new Set(PAINEIS_GERENCIAIS.map((p) => p.diretoria))];

  return (
    <div className="space-y-4">
      <PageHeader title="Indicadores gerenciais das TVs" module="TV's" breadcrumb={["Indicadores gerenciais"]}
        subtitle="As 13 TVs por diretoria: o que está fora da meta, onde, por quê e quem age — com o detalhe, as metas e os lançamentos" />
      <AcessoGate menu={MENU} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        {/* As TVs, por diretoria */}
        <Card className="space-y-2 p-3">
          {diretorias.map((d) => (
            <div key={d} className="flex flex-wrap items-center gap-1.5">
              <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{d}</span>
              {PAINEIS_GERENCIAIS.filter((p) => p.diretoria === d).map((p) => (
                <Button key={p.slug} size="sm" variant={p.slug === slug ? "default" : "outline"} className="h-7 rounded-full px-3 text-xs"
                  style={p.slug === slug ? { background: p.cor, borderColor: p.cor } : undefined} onClick={() => { setSlug(p.slug); setAberto(null); }}>
                  {p.titulo}
                </Button>
              ))}
            </div>
          ))}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-white" style={{ background: info.cor }}>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-tight">TV {info.titulo}</p>
              <p className="text-sm opacity-90">“{painel.data?.painel?.pergunta ?? "…"}”</p>
            </div>
            <div className="flex gap-1.5">
              {(["vermelho", "amarelo", "verde"] as const).map((s) => (
                <span key={s} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold" style={{ color: COR_SITUACAO[s] }}>{pl[s]} {ROTULO_SITUACAO[s].toLowerCase()}</span>
              ))}
            </div>
            <Button size="sm" variant="secondary" onClick={() => setVerTv(true)}><MonitorPlay className="mr-1 h-4 w-4" /> Ver como na TV</Button>
            <Button size="sm" variant="secondary" disabled={painel.isFetching} onClick={() => qc.invalidateQueries({ queryKey: [K, "painel", slug] })}>
              <RefreshCw className={`mr-1 h-4 w-4 ${painel.isFetching ? "animate-spin" : ""}`} /> Atualizar
            </Button>
          </div>

          {painel.isLoading ? <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculando os indicadores…</div>
            : painel.error ? <div className="p-6 text-sm text-destructive">{(painel.error as Error).message}</div>
            : (
              <div className="space-y-4 p-4">
                <p className="text-xs text-muted-foreground">Na ordem da TV: fora da meta primeiro, pelo impacto. Clique num indicador para ver o detalhe, lançar o número ou ajustar a meta.</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {naTv.map((i) => <CartaoGestao key={i.codigo} i={i} onClick={() => setAberto(i.codigo)} />)}
                </div>
                {subsPainel.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subindicadores (ficam no sistema, não ocupam a TV)</p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {subsPainel.map((i) => <CartaoGestao key={i.codigo} i={i} onClick={() => setAberto(i.codigo)} compacto />)}
                    </div>
                  </div>
                )}
              </div>
            )}
        </Card>

        {/* Meta por pessoa da equipe (15/10/2026, mig 20261015000003): hoje só a TV Licitações. */}
        {slug === "ger-licitacoes" && <MetasEquipe slug={slug} equipe={painel.data?.equipe ?? []} onMudou={() => qc.invalidateQueries({ queryKey: [K, "painel", slug] })} />}

        {selecionado && painel.data && (
          <DetalheIndicador i={selecionado} painel={painel.data} onClose={() => setAberto(null)} onAbrir={setAberto}
            onMudou={() => qc.invalidateQueries({ queryKey: [K] })} onIa={() => setIa({ codigo: selecionado.codigo, nome: selecionado.nome })} />
        )}
        {ia && <IaIndicadorDialog codigo={ia.codigo} nome={ia.nome} onClose={() => setIa(null)} />}

        <Dialog open={verTv} onOpenChange={setVerTv}>
          <DialogContent className="max-w-6xl p-3">
            <DialogHeader className="px-1">
              <DialogTitle className="flex flex-wrap items-center gap-3 pr-8">
                <span className="flex-1">TV {info.titulo} — como aparece na TV</span>
                <Select value={visual} onValueChange={(v) => setVisual(v as VisualGerencial)}>
                  <SelectTrigger className="h-8 w-[300px] text-xs font-normal"><SelectValue /></SelectTrigger>
                  <SelectContent>{VISUAIS_GERENCIAIS.map((v) => <SelectItem key={v.valor} value={v.valor} className="text-xs">{v.rotulo}</SelectItem>)}</SelectContent>
                </Select>
              </DialogTitle>
            </DialogHeader>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              {verTv && <TvRelatorio key={visual} previa token="" onIndicador={(i) => setIa({ codigo: i.codigo, nome: i.nome })}
                item={{ id: `previa-${slug}`, tipo: "relatorio", relatorio: slug, rel_visual: visual, titulo: null, url: null, arquivo: null, texto: null, cor: null, duracao_seg: 45 }} />}
            </div>
            <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-violet-700 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" /> Clique em qualquer indicador: a I.A explica de onde vem cada informação e responde suas perguntas.</p>
            <p className="px-1 text-xs text-muted-foreground">Para colocar numa TV: TV's › Gestão das TVs › Playlists › adicionar item “Relatório do ERP” e escolher <b>TV {info.titulo}</b> e o visual.</p>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}

function CartaoGestao({ i, onClick, compacto = false }: { i: IndicadorGerencial; onClick: () => void; compacto?: boolean }) {
  const s = situacao(i);
  const cor = COR_SITUACAO[s];
  const atrasado = lancamentoAtrasado(i);
  return (
    <button type="button" onClick={onClick} className="relative flex flex-col overflow-hidden rounded-xl border bg-card p-3 pt-4 text-left shadow-sm transition hover:shadow-md">
      <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: cor }} />
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-tight">{i.nome}</p>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ color: cor, background: `${cor}1a` }}>{ROTULO_SITUACAO[s]}</span>
      </div>
      <p className={`mt-1 font-black tabular-nums ${compacto ? "text-xl" : "text-3xl"}`} style={{ color: i.resultado?.valor == null ? undefined : cor }}>
        {i.resultado?.valor == null ? <span className="text-base font-semibold text-muted-foreground">{i.resultado?.erro ? "Erro no cálculo" : "Aguardando lançamento"}</span> : formatarValor(i.resultado.valor, i.unidade, true, i.resultado.casas)}
      </p>
      <p className="text-[11px] text-muted-foreground">{textoMeta(i)}</p>
      {!compacto && (
        <div className="mt-2 space-y-0.5 text-xs">
          {i.resultado?.afetado && <p className="line-clamp-2"><b className="text-muted-foreground">Onde:</b> {i.resultado.afetado}</p>}
          {i.resultado?.causa && <p className="line-clamp-2"><b className="text-muted-foreground">Causa:</b> {i.resultado.causa}</p>}
          {i.responsavel && <p><b className="text-muted-foreground">Resp.:</b> {i.responsavel}</p>}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-1 pt-2">
        <Badge variant="outline" className="text-[10px]">{ROTULO_FONTE[i.fonte]}</Badge>
        {atrasado && <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">Lançamento em atraso</Badge>}
      </div>
    </button>
  );
}

function DetalheIndicador({ i, painel, onClose, onAbrir, onMudou, onIa }: {
  i: IndicadorGerencial; painel: PainelGerencial; onClose: () => void; onAbrir: (c: string) => void; onMudou: () => void; onIa: () => void;
}) {
  const s = situacao(i);
  const cor = COR_SITUACAO[s];
  const r = i.resultado ?? { valor: null };
  const subs = subindicadores(painel, i.codigo);
  const historico = useLancamentos(i.fonte === "manual" ? i.codigo : null);
  const [lancando, setLancando] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  const qc = useQueryClient();
  const excluir = useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TVG_LANCAMENTO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Lançamento excluído."); onMudou(); qc.invalidateQueries({ queryKey: [K, "lancamentos", i.codigo] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: cor }} /> {i.nome}
          </DialogTitle>
          <DialogDescription>{i.identificar}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <div className="rounded-xl border p-4 text-center" style={{ borderColor: cor }}>
            <p className="text-4xl font-black tabular-nums" style={{ color: cor }}>{r.valor == null ? "—" : formatarValor(r.valor, i.unidade, false, r.casas)}</p>
            <p className="text-xs text-muted-foreground">{textoMeta(i)}{i.alerta != null ? ` · atenção até ${formatarValor(i.alerta, i.unidade, false)}` : ""}</p>
            <p className="mt-1 text-xs font-bold uppercase" style={{ color: cor }}>{ROTULO_SITUACAO[s]}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p><b className="text-muted-foreground">Onde:</b> {r.afetado || "—"}</p>
            <p><b className="text-muted-foreground">Causa principal:</b> {r.causa || "—"}</p>
            <p><b className="text-muted-foreground">Responsável:</b> {i.responsavel || "—"}</p>
            {r.impacto != null && Number(r.impacto) !== 0 && <p><b className="text-muted-foreground">Impacto:</b> {formatarValor(r.impacto, "brl", false)}</p>}
            {r.base && <p className="text-xs text-muted-foreground">{r.base}</p>}
            <p className="text-xs text-muted-foreground">
              {ROTULO_FONTE[i.fonte]}{i.espelho_de ? ` (${i.espelho_de})` : ""} · {ROTULO_PERIODICIDADE[i.periodicidade]}
              {r.atualizado_em ? ` · atualizado ${fmtDataHora(r.atualizado_em)}` : ""}{r.referencia ? ` · referência ${fmtData(r.referencia)}` : ""}
            </p>
            {r.erro && <p className="text-xs text-destructive">Erro no cálculo: {r.erro}</p>}
          </div>
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-xs">
          <p className="font-semibold">Na TV aparece:</p>
          <p className="text-muted-foreground">{frase(i)}</p>
          {i.regra && <><p className="mt-2 font-semibold">Como é calculado</p><p className="text-muted-foreground">{i.regra}</p></>}
          {r.observacao && <><p className="mt-2 font-semibold">Observação do lançamento</p><p className="text-muted-foreground">{r.observacao}</p></>}
        </div>

        {(r.detalhe ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-sm font-semibold">Detalhamento</p>
            <table className="w-full text-sm">
              <tbody>
                {(r.detalhe ?? []).map((l, k) => (
                  <tr key={k} className="border-t">
                    <td className="py-1 pr-2">{l.nome}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">{l.rotulo || formatarValor(l.valor, i.unidade, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {subs.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-semibold">Subindicadores</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {subs.map((x) => {
                const sx = situacao(x);
                return (
                  <button key={x.codigo} type="button" onClick={() => onAbrir(x.codigo)} className="flex items-center gap-2 rounded-lg border p-2 text-left text-sm hover:bg-muted/50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COR_SITUACAO[sx] }} />
                    <span className="min-w-0 flex-1">{x.nome}</span>
                    <span className="font-bold tabular-nums">{x.resultado?.valor == null ? "—" : formatarValor(x.resultado.valor, x.unidade, true, x.resultado.casas)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {i.fonte === "manual" && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-sm font-semibold"><History className="h-4 w-4" /> Lançamentos</p>
            {historico.isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p>
              : !(historico.data ?? []).length ? <p className="text-xs text-muted-foreground">Nenhum lançamento ainda — a TV mostra “Aguardando lançamento”.</p>
              : (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground"><tr><th className="py-1">Referência</th><th>Valor</th><th>Onde / causa</th><th>Por</th><th /></tr></thead>
                  <tbody>
                    {(historico.data ?? []).map((l) => (
                      <tr key={l.id} className="border-t align-top">
                        <td className="py-1">{fmtData(l.referencia)}</td>
                        <td className="font-semibold tabular-nums">{formatarValor(l.valor, i.unidade, false)}</td>
                        <td className="max-w-[260px]">{[l.afetado, l.causa].filter(Boolean).join(" · ") || "—"}</td>
                        <td>{l.created_by_nome ?? "—"}<br /><span className="text-muted-foreground">{fmtDataHora(l.created_at)}</span></td>
                        <td>
                          <AcessoGate menu={MENU} acao="excluir">
                            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={excluir.isPending}
                              onClick={() => window.confirm("Excluir este lançamento?") && excluir.mutate(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </AcessoGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <AcessoGate menu={MENU} acao="alterar">
              <Button variant="outline" onClick={() => setConfigurando(true)}><Settings2 className="mr-1 h-4 w-4" /> Meta e parâmetros</Button>
            </AcessoGate>
            <Button variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={onIa}><Sparkles className="mr-1 h-4 w-4" /> De onde vem? (I.A)</Button>
          </div>
          {i.fonte === "manual" && (
            <AcessoGate menu={MENU} acao="incluir">
              <Button onClick={() => setLancando(true)}><Plus className="mr-1 h-4 w-4" /> Lançar valor</Button>
            </AcessoGate>
          )}
        </DialogFooter>

        {lancando && <DialogLancamento i={i} onClose={() => setLancando(false)} onSalvo={() => { onMudou(); qc.invalidateQueries({ queryKey: [K, "lancamentos", i.codigo] }); }} />}
        {configurando && <DialogParametros i={i} onClose={() => setConfigurando(false)} onSalvo={onMudou} />}
      </DialogContent>
    </Dialog>
  );
}

function DialogLancamento({ i, onClose, onSalvo }: { i: IndicadorGerencial; onClose: () => void; onSalvo: () => void }) {
  const ultimo = i.resultado?.valor != null ? i.resultado : null;
  const [f, setF] = useState({
    referencia: hojeIso(), valor: "", afetado: ultimo?.afetado ?? "", causa: ultimo?.causa ?? "", responsavel: i.responsavel ?? "",
    impacto: "", observacao: "",
  });
  const [linhas, setLinhas] = useState<{ nome: string; valor: string }[]>(
    (ultimo?.detalhe ?? []).map((l) => ({ nome: l.nome, valor: l.valor == null ? "" : String(l.valor).replace(".", ",") })),
  );
  const salvar = useMutation({
    mutationFn: async () => {
      const valor = numOuNull(f.valor);
      if (valor == null || !Number.isFinite(valor)) throw new Error("Informe o valor.");
      const detalhe = linhas.filter((l) => l.nome.trim()).map((l) => ({ nome: l.nome.trim(), valor: numOuNull(l.valor) }));
      const { error } = await sb.from("TVG_LANCAMENTO").insert({
        indicador: i.codigo, referencia: f.referencia, valor, afetado: f.afetado.trim() || null, causa: f.causa.trim() || null,
        responsavel: f.responsavel.trim() || null, impacto: numOuNull(f.impacto), detalhe, observacao: f.observacao.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Lançado — a TV mostra na próxima atualização (até 5 min)."); onSalvo(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const unidade = i.unidade === "pct" ? "%" : i.unidade === "brl" ? "R$" : i.unidade === "dias" ? "dias" : "quantidade";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Lançar — {i.nome}</DialogTitle><DialogDescription>{i.regra}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label className="text-xs">Referência</Label><Input type="date" value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} /></div>
          <div><Label className="text-xs">Valor ({unidade}) *</Label><Input inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder={textoMeta(i)} /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Contrato / setor afetado</Label><Input value={f.afetado} onChange={(e) => setF({ ...f, afetado: e.target.value })} placeholder="Ex.: 3 contratos · pior: UFRGS Limpeza" /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Causa principal</Label><Input value={f.causa} onChange={(e) => setF({ ...f, causa: e.target.value })} placeholder="Ex.: posto descoberto" /></div>
          <div><Label className="text-xs">Responsável pela ação</Label><Input value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })} /></div>
          <div><Label className="text-xs">Impacto (R$, opcional)</Label><Input inputMode="decimal" value={f.impacto} onChange={(e) => setF({ ...f, impacto: e.target.value })} placeholder="ordena a TV pelo impacto" /></div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Detalhamento (por contrato, cidade, rubrica…)</Label>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setLinhas([...linhas, { nome: "", valor: "" }])}><Plus className="mr-1 h-3.5 w-3.5" /> Linha</Button>
          </div>
          {linhas.length === 0 ? <p className="text-xs text-muted-foreground">Opcional — aparece no detalhe e na página “Onde agir” da TV quando o indicador está fora da meta.</p>
            : linhas.map((l, k) => (
              <div key={k} className="mb-1 flex gap-2">
                <Input className="h-8" value={l.nome} placeholder="Contrato / item" onChange={(e) => setLinhas(linhas.map((x, j) => (j === k ? { ...x, nome: e.target.value } : x)))} />
                <Input className="h-8 w-32" inputMode="decimal" value={l.valor} placeholder="Valor" onChange={(e) => setLinhas(linhas.map((x, j) => (j === k ? { ...x, valor: e.target.value } : x)))} />
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setLinhas(linhas.filter((_, j) => j !== k))}><X className="h-4 w-4" /></Button>
              </div>
            ))}
        </div>
        <div><Label className="text-xs">Observação</Label><Textarea rows={2} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Lançar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogParametros({ i, onClose, onSalvo }: { i: IndicadorGerencial; onClose: () => void; onSalvo: () => void }) {
  const txt = (v: number | string | null) => (v == null ? "" : String(v).replace(".", ","));
  const [f, setF] = useState({
    meta: txt(i.meta), alerta: txt(i.alerta), sentido: i.sentido, periodicidade: i.periodicidade, responsavel: i.responsavel ?? "",
    parametro: txt(i.parametro), na_tv: i.na_tv,
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await sb.from("TVG_INDICADOR").update({
        meta: numOuNull(f.meta), alerta: numOuNull(f.alerta), sentido: f.sentido, periodicidade: f.periodicidade,
        responsavel: f.responsavel.trim() || null, parametro: numOuNull(f.parametro), na_tv: f.na_tv,
      }).eq("codigo", i.codigo);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Parâmetros salvos."); onSalvo(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const exemplo = useMemo(() => (f.sentido === "menor" ? "quanto menor, melhor (ex.: atrasos, glosas)" : "quanto maior, melhor (ex.: % entregue, margem)"), [f.sentido]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> {i.nome}</DialogTitle>
          <DialogDescription>Meta e regra do semáforo desta TV. {i.fonte === "espelho" ? "O número vem de outra TV; a meta daqui vale só aqui." : ""}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label className="text-xs">Sentido</Label>
            <Select value={f.sentido} onValueChange={(v) => setF({ ...f, sentido: v as typeof f.sentido })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="menor">Quanto menor, melhor</SelectItem><SelectItem value="maior">Quanto maior, melhor</SelectItem></SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">{exemplo}</p></div>
          <div><Label className="text-xs">Periodicidade</Label>
            <Select value={f.periodicidade} onValueChange={(v) => setF({ ...f, periodicidade: v as typeof f.periodicidade })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ROTULO_PERIODICIDADE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label className="text-xs">Meta (verde)</Label><Input inputMode="decimal" value={f.meta} onChange={(e) => setF({ ...f, meta: e.target.value })} placeholder="vazio = sem semáforo" /></div>
          <div><Label className="text-xs">Limite de atenção (amarelo)</Label><Input inputMode="decimal" value={f.alerta} onChange={(e) => setF({ ...f, alerta: e.target.value })} placeholder="além dele = vermelho" /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Responsável pela ação</Label><Input value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })} placeholder="Ex.: Operação, Faturamento, DP" /></div>
          {i.parametro_rotulo && (
            <div className="sm:col-span-2"><Label className="text-xs">{i.parametro_rotulo} (cálculo)</Label><Input inputMode="decimal" value={f.parametro} onChange={(e) => setF({ ...f, parametro: e.target.value })} /></div>
          )}
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.na_tv} onCheckedChange={(v) => setF({ ...f, na_tv: v })} /> Mostrar na TV</label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Metas da equipe (TV Licitações, 15/10/2026, mig 20261015000003) -------------
// Chamado: "ser possível colocar as pessoas que vão ter que cumprir as metas;
// ser possível definir as metas; o acompanhamento pela Capa de Edital, só os
// contratos ganhos a partir de 01/09/2026, pelo responsável, valor estimado ÷
// prazo do contrato; meta por contrato soma a quantidade de contratos ganhos".
// O responsável da Capa é texto livre e aparece de vários jeitos — por isso a
// pessoa tem a lista de "nomes na Capa de Edital" que contam para ela.

interface MetaCadastro {
  id: string; painel: string; nome: string; nomes_capa: string[]; user_id: string | null; tipo: "valor" | "contratos";
  meta: number; ganhos_desde: string; cor: string | null; ordem: number; ativo: boolean;
}
type FormMeta = { id?: string; nome: string; nomes_capa: string[]; user_id: string; tipo: "valor" | "contratos"; meta: string; ganhos_desde: string; cor: string; ordem: string };
const FORM_VAZIO: FormMeta = { nome: "", nomes_capa: [], user_id: "", tipo: "valor", meta: "", ganhos_desde: "2026-09-01", cor: "", ordem: "100" };

function MetasEquipe({ slug, equipe, onMudou }: { slug: string; equipe: MetaEquipe[]; onMudou: () => void }) {
  const qc = useQueryClient();
  const cadastro = useQuery({
    queryKey: [K, "metas-equipe", slug],
    queryFn: async (): Promise<MetaCadastro[]> => {
      const { data, error } = await sb.from("TVG_META_EQUIPE").select("*").eq("painel", slug).order("ordem").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  const responsaveis = useQuery({
    queryKey: [K, "responsaveis-capa"], staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ nome: string; editais: number; ganhos: number }[]> => {
      const { data, error } = await sb.rpc("tvg_responsaveis_capa");
      if (error) throw error;
      return data ?? [];
    },
  });
  const pessoasComFoto = useQuery({
    queryKey: [K, "perfis-com-foto"], staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ id: string; display_name: string | null; avatar_url: string }[]> => {
      const { data } = await sb.from("profiles").select("id, display_name, avatar_url").not("avatar_url", "is", null).order("display_name").limit(500);
      return data ?? [];
    },
  });
  const [form, setForm] = useState<FormMeta | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const atualizar = () => { qc.invalidateQueries({ queryKey: [K, "metas-equipe", slug] }); onMudou(); };

  const salvar = useMutation({
    mutationFn: async (f: FormMeta) => {
      const meta = numOuNull(f.meta);
      const { error } = await sb.rpc("tvg_meta_equipe_salvar", { p: {
        id: f.id ?? null, painel: slug, nome: f.nome.trim(), nomes_capa: f.nomes_capa, user_id: f.user_id || null,
        tipo: f.tipo, meta, ganhos_desde: f.ganhos_desde, cor: f.cor || null, ordem: Number(f.ordem) || 100,
      } });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Meta salva."); setForm(null); atualizar(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const excluir = useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.rpc("tvg_meta_equipe_excluir", { p_id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Pessoa removida das metas."); atualizar(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const porId = new Map(equipe.map((m) => [m.id, m]));
  const editar = (m: MetaCadastro) => setForm({
    id: m.id, nome: m.nome, nomes_capa: m.nomes_capa ?? [], user_id: m.user_id ?? "", tipo: m.tipo,
    meta: String(m.meta).replace(".", ","), ganhos_desde: m.ganhos_desde, cor: m.cor ?? "", ordem: String(m.ordem),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Metas da equipe — aparecem na TV no quadro “Desempenho da equipe”</p>
          <p className="text-xs text-muted-foreground">
            Conta os editais com status <b>Ganhamos</b> na Capa de Edital a partir da data de cada pessoa (padrão 01/09/2026), pelo
            responsável. Meta em valor: valor estimado ÷ meses do prazo do contrato (sem prazo informado, 12 meses). Meta por contratos: a quantidade ganha.
          </p>
        </div>
        <AcessoGate menu={MENU} acao="alterar">
          <Button size="sm" onClick={() => setForm({ ...FORM_VAZIO })}><Plus className="mr-1 h-4 w-4" /> Adicionar pessoa</Button>
        </AcessoGate>
      </div>

      {cadastro.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        : !(cadastro.data ?? []).length ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Ninguém com meta ainda. Enquanto não houver, a TV mostra o quadro “Onde agir agora”.</p>
        : (
          <div className="divide-y rounded-lg border">
            {(cadastro.data ?? []).map((m, k) => {
              const r = porId.get(m.id);
              const pct = Math.min(100, Math.max(0, Number(r?.pct) || 0));
              const cor = m.cor || CORES_EQUIPE[k % CORES_EQUIPE.length];
              return (
                <div key={m.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: cor }} />
                    <div className="min-w-[180px] flex-1">
                      <p className="text-sm font-semibold">{m.nome} {!m.ativo && <Badge variant="outline" className="ml-1 text-[10px]">inativa</Badge>}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Na Capa: {m.nomes_capa?.length ? m.nomes_capa.join(" · ") : <span className="text-amber-600">nenhum nome ligado — só conta se o responsável for “{m.nome}”</span>} · desde {fmtData(m.ganhos_desde)}
                      </p>
                    </div>
                    <div className="w-56">
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor }} /></div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        <b className="text-foreground">{formatarMetaEquipe(r?.realizado ?? 0, m.tipo)}</b> de {formatarMetaEquipe(m.meta, m.tipo)} · {Math.round(Number(r?.pct) || 0)}%
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAberto(aberto === m.id ? null : m.id)}>
                      {r?.contratos ?? 0} contrato(s) {aberto === m.id ? "▲" : "▼"}
                    </Button>
                    <AcessoGate menu={MENU} acao="alterar">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => editar(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Remover"
                        onClick={() => window.confirm(`Tirar ${m.nome} das metas?`) && excluir.mutate(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </AcessoGate>
                  </div>
                  {aberto === m.id && (
                    <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs">
                      {!r?.itens?.length ? <p className="text-muted-foreground">Nenhum edital ganho contando para esta pessoa.</p> : (
                        <table className="w-full">
                          <thead><tr className="text-left text-[10px] uppercase text-muted-foreground"><th className="py-1">Edital</th><th>Ganho em</th><th className="text-right">Valor estimado</th><th className="text-right">Prazo</th><th className="text-right">Por mês</th></tr></thead>
                          <tbody>
                            {r.itens.map((x, j) => (
                              <tr key={j} className="border-t border-border/50">
                                <td className="py-1 pr-2">{x.objeto}{x.cidade ? <span className="text-muted-foreground"> · {x.cidade}</span> : null}</td>
                                <td>{fmtData(x.ganho_em)}</td>
                                <td className="text-right tabular-nums">{x.valor_estimado != null ? formatarValor(x.valor_estimado, "brl", false) : "—"}</td>
                                <td className="text-right">{x.prazo_meses} m{x.prazo_assumido && <span className="text-amber-600" title="Prazo do contrato não informado na Capa — 12 meses assumidos">*</span>}</td>
                                <td className="text-right font-semibold tabular-nums">{formatarValor(x.mensal, "brl", false)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {r?.itens?.some((x) => x.prazo_assumido) && <p className="mt-1 text-[10px] text-amber-700">* prazo do contrato vazio na Capa de Edital — contados 12 meses. Preencha o prazo na Capa para a conta ficar exata.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar meta" : "Adicionar pessoa à meta"}</DialogTitle>
            <DialogDescription>Quem cumpre a meta, de quanto e quais nomes da Capa de Edital contam para ela.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1"><Label>Nome na TV *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Xaiane" /></div>
                <div className="space-y-1">
                  <Label>Tipo de meta</Label>
                  <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as FormMeta["tipo"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="valor">Valor (R$ por mês dos contratos)</SelectItem>
                      <SelectItem value="contratos">Quantidade de contratos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Meta *</Label><Input value={form.meta} inputMode="decimal" onChange={(e) => setForm({ ...form, meta: e.target.value })} placeholder={form.tipo === "valor" ? "Ex.: 766000" : "Ex.: 1"} /></div>
                <div className="space-y-1"><Label>Contar ganhos desde</Label><Input type="date" value={form.ganhos_desde} onChange={(e) => setForm({ ...form, ganhos_desde: e.target.value })} /></div>
                <div className="space-y-1"><Label>Ordem na TV</Label><Input value={form.ordem} inputMode="numeric" onChange={(e) => setForm({ ...form, ordem: e.target.value })} /></div>
              </div>
              <div className="space-y-1">
                <Label>Nomes na Capa de Edital que contam para esta pessoa</Label>
                <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-2">
                  {(responsaveis.data ?? []).map((r) => (
                    <label key={r.nome} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted">
                      <input type="checkbox" checked={form.nomes_capa.includes(r.nome)}
                        onChange={(e) => setForm({ ...form, nomes_capa: e.target.checked ? [...form.nomes_capa, r.nome] : form.nomes_capa.filter((x) => x !== r.nome) })} />
                      <span className="flex-1">{r.nome}</span>
                      <span className="text-muted-foreground">{r.editais} edital(is) · {r.ganhos} ganho(s)</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">O mesmo responsável aparece escrito de jeitos diferentes — marque todos que são desta pessoa.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Foto (login da pessoa, opcional)</Label>
                  <Select value={form.user_id || "__nenhum"} onValueChange={(v) => setForm({ ...form, user_id: v === "__nenhum" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__nenhum">Sem foto (iniciais)</SelectItem>
                      {(pessoasComFoto.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name ?? p.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Cor</Label>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {CORES_EQUIPE.map((c) => (
                      <button key={c} type="button" title={c} onClick={() => setForm({ ...form, cor: form.cor === c ? "" : c })}
                        className="h-7 w-7 rounded-full border-2" style={{ background: c, borderColor: form.cor === c ? "#0f172a" : "transparent" }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={salvar.isPending || !form?.nome.trim() || !form?.meta.trim()} onClick={() => form && salvar.mutate(form)}>
              {salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
