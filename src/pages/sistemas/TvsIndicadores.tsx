import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Loader2, MonitorPlay, Pencil, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
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
import {
  COR_SITUACAO, PAINEIS_GERENCIAIS, VISUAIS_GERENCIAIS, type VisualGerencial, ROTULO_FONTE, ROTULO_PERIODICIDADE, ROTULO_SITUACAO, formatarValor, frase, indicadoresDaTv,
  lancamentoAtrasado, placar, situacao, subindicadores, textoMeta, type IndicadorGerencial, type LinhaDetalhe, type PainelGerencial,
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
  const [visual, setVisual] = useState<VisualGerencial>("painel");
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

        {selecionado && painel.data && (
          <DetalheIndicador i={selecionado} painel={painel.data} onClose={() => setAberto(null)} onAbrir={setAberto}
            onMudou={() => qc.invalidateQueries({ queryKey: [K] })} />
        )}

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
              {verTv && <TvRelatorio key={visual} previa token="" item={{ id: `previa-${slug}`, tipo: "relatorio", relatorio: slug, rel_visual: visual, titulo: null, url: null, arquivo: null, texto: null, cor: null, duracao_seg: 45 }} />}
            </div>
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
        {i.resultado?.valor == null ? <span className="text-base font-semibold text-muted-foreground">{i.resultado?.erro ? "Erro no cálculo" : "Aguardando lançamento"}</span> : formatarValor(i.resultado.valor, i.unidade)}
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

function DetalheIndicador({ i, painel, onClose, onAbrir, onMudou }: {
  i: IndicadorGerencial; painel: PainelGerencial; onClose: () => void; onAbrir: (c: string) => void; onMudou: () => void;
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
            <p className="text-4xl font-black tabular-nums" style={{ color: cor }}>{r.valor == null ? "—" : formatarValor(r.valor, i.unidade, false)}</p>
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
                    <span className="font-bold tabular-nums">{x.resultado?.valor == null ? "—" : formatarValor(x.resultado.valor, x.unidade)}</span>
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
          <AcessoGate menu={MENU} acao="alterar">
            <Button variant="outline" onClick={() => setConfigurando(true)}><Settings2 className="mr-1 h-4 w-4" /> Meta e parâmetros</Button>
          </AcessoGate>
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
