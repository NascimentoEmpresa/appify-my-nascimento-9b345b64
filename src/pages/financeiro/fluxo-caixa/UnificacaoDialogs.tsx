import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, Plus, Split, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useDesfazerUnificacao, useRatearUnificacao, useUnificacaoDetalhe, useUnificarLancamentos } from "@/hooks/useUnificacaoFluxo";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { distribuirIgualmente } from "./rateioImportado";
import {
  cotasDasSalvas, cotasParaRpcUnif, diferencaCotasUnif, erroCotasUnif, SEM_CONTRATO_UNIF, somaCotasUnif, type CotaUnificacao, type PlanoUnificacao,
} from "./unificacao";

// SIS-2026-0927: diálogos da unificação de lançamentos do Fluxo de Caixa. Texto de erro: o Supabase devolve objeto simples, por isso `.message`.
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR");
const msg = (e: unknown, padrao: string) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : padrao);
export const MENU_UNIFICAR = "financeiro-fluxo-caixa-unificar";

const INFO_TOTAL = (
  <>
    <span className="block">Soma do valor das linhas marcadas = <strong>o pagamento bancário</strong>. É o valor da linha unificada e o que o extrato mostra.</span>
    <AssinaturaRegra chamado="SIS-2026-0927" />
  </>
);
const INFO_RATEIO = (
  <>
    <span className="block">Composição do pagamento por <strong>classificação e centro de custo</strong>. A soma das cotas é obrigatoriamente igual ao total — sem isso não salva.</span>
    <span className="block">É o rateio que Lucratividade, Fechamento e Auditoria leem; o Fluxo mostra uma linha só (“Rateio”).</span>
    <AssinaturaRegra chamado="SIS-2026-0927" />
  </>
);

// ── 1. confirmar a unificação ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ConfirmarUnificacaoDialog({
  aberto, plano, onClose, onUnificada,
}: {
  aberto: boolean;
  plano: PlanoUnificacao | null;
  onClose: () => void;
  /** Recebe o id da unificação criada (para abrir o rateio em seguida, se o usuário pediu). */
  onUnificada: (id: string, ratearAgora: boolean) => void;
}) {
  const unificar = useUnificarLancamentos();
  const [ratearAgora, setRatearAgora] = useState(true);

  async function confirmar() {
    if (!plano?.ok) return;
    try {
      const id = await unificar.mutateAsync(plano.itens);
      toast.success(`${plano.itens.length} lançamentos unificados em ${brl(plano.total)}.`);
      onUnificada(id, ratearAgora);
    } catch (e: unknown) {
      toast.error(msg(e, "Erro ao unificar."));
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o && !unificar.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" />Unificar lançamentos</DialogTitle>
          <DialogDescription>
            Os {plano?.itens.length ?? 0} lançamentos selecionados viram <strong>uma linha só</strong>, com o valor do pagamento bancário. Os originais ficam guardados
            (dá para desfazer) e a composição de cada um vira o rateio da nova linha.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground"><TituloComFormula alinhar="left" titulo="Total a unificar" formula={INFO_TOTAL} /></p>
            <p className="mt-1 text-xs">{plano?.somaTexto}</p>
            <p className="mt-1 text-lg font-bold">{brl(plano?.total ?? 0)}</p>
          </div>
          {plano && !plano.ok && (
            <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="list-disc pl-4">{plano.erros.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={ratearAgora} onChange={(e) => setRatearAgora(e.target.checked)} />
            Abrir o rateio por classificação e centro de custo logo depois de unificar.
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={unificar.isPending}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={!plano?.ok || unificar.isPending}>{unificar.isPending ? "Unificando…" : "Unificar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 2. rateio da linha unificada ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function RatearUnificacaoDialog({ unificacaoId, onClose }: { unificacaoId: string | null; onClose: () => void }) {
  const { data: det, isLoading } = useUnificacaoDetalhe(unificacaoId);
  const { data: contratos = [] } = useContratosAtivos();
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const ratear = useRatearUnificacao();
  const [cotas, setCotas] = useState<CotaUnificacao[]>([]);
  const total = det?.cabecalho.valor_total ? Number(det.cabecalho.valor_total) : 0;
  const empresaId = det?.cabecalho.empresa_id ?? null;

  useEffect(() => {
    if (det?.cotas) setCotas(cotasDasSalvas(det.cotas.map((c) => ({ classificacao_id: c.classificacao_id, contrato_id: c.contrato_id, integrante_empregado_id: c.integrante_empregado_id, valor: c.valor }))));
  }, [det?.cotas]);

  const opcoesContrato = useMemo(
    () => [
      { value: SEM_CONTRATO_UNIF, label: "Sem contrato (administrativo)" },
      ...contratos.filter((c) => !empresaId || c.empresa_id === empresaId).map((c) => ({ value: c.id, label: c.nome, muted: c.status !== "ativo" })),
    ],
    [contratos, empresaId],
  );
  const opcoesClassificacao = useMemo(
    () => classificacoes.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((c) => ({ value: c.id, label: c.nome })),
    [classificacoes],
  );

  const erro = erroCotasUnif(total, cotas);
  const dif = diferencaCotasUnif(total, cotas);
  const mudar = (i: number, parcial: Partial<CotaUnificacao>) => setCotas((cs) => cs.map((c, j) => (j === i ? { ...c, ...parcial } : c)));

  async function salvar() {
    if (erro || !unificacaoId) { if (erro) toast.error(erro); return; }
    try {
      await ratear.mutateAsync({ unificacaoId, cotas: cotasParaRpcUnif(cotas) });
      toast.success("Rateio salvo.");
      onClose();
    } catch (e: unknown) {
      toast.error(msg(e, "Erro ao salvar o rateio."));
    }
  }

  return (
    <Dialog open={!!unificacaoId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Split className="h-4 w-4" />Rateio — {det?.cabecalho.numero ?? "…"}</DialogTitle>
          <DialogDescription>
            Total do pagamento <strong>{brl(total)}</strong>. Distribua entre classificação e centro de custo; a soma tem que fechar o total.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_130px_auto] gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
              <span>Classificação</span><span><TituloComFormula alinhar="left" titulo="Centro de custo" formula={INFO_RATEIO} /></span><span className="text-right">Valor (R$)</span><span className="w-8" />
            </div>
            {cotas.map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_130px_auto] items-center gap-2">
                <SearchableSelect value={c.classificacaoId} onChange={(v) => mudar(i, { classificacaoId: v })} options={opcoesClassificacao} placeholder="Classificação" />
                <SearchableSelect value={c.contratoId} onChange={(v) => mudar(i, { contratoId: v })} options={opcoesContrato} placeholder="Centro de custo" />
                <Input inputMode="decimal" value={c.valor} onChange={(e) => mudar(i, { valor: e.target.value })} placeholder="0,00" className="text-right" />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={cotas.length <= 1}
                  onClick={() => setCotas((cs) => cs.filter((_, j) => j !== i))} title="Remover cota"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setCotas((cs) => [...cs, { contratoId: "", classificacaoId: "", valor: "" }])}>
                  <Plus className="h-3.5 w-3.5" />Adicionar cota
                </Button>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => { const p = distribuirIgualmente(total, cotas.length); setCotas((cs) => cs.map((c, i) => ({ ...c, valor: String(p[i]).replace(".", ",") }))); }}>
                  Dividir igualmente
                </Button>
              </div>
              <p className={`text-xs ${Math.abs(dif) > 0.005 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                Soma {brl(somaCotasUnif(cotas))} de {brl(total)}{Math.abs(dif) > 0.005 && <> — {dif > 0 ? "faltam" : "sobram"} {brl(Math.abs(dif))}</>}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={ratear.isPending}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={ratear.isPending || !!erro || isLoading}>{ratear.isPending ? "Salvando…" : "Salvar rateio"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 3. composição, originais e histórico (com desfazer) ──────────────────────────────────────────────────────────────────────────────

const ROTULO_EVENTO: Record<string, string> = { unificada: "Unificada", rateio_criado: "Rateio criado", rateio_alterado: "Rateio refeito", desfeita: "Desfeita" };

export function UnificacaoDetalheDialog({
  unificacaoId, onClose, onRatear,
}: { unificacaoId: string | null; onClose: () => void; onRatear: (id: string) => void }) {
  const { data: det, isLoading } = useUnificacaoDetalhe(unificacaoId);
  const desfazer = useDesfazerUnificacao();
  const [desfazendo, setDesfazendo] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function confirmarDesfazer() {
    if (!unificacaoId) return;
    try {
      await desfazer.mutateAsync({ unificacaoId, motivo });
      toast.success("Unificação desfeita: os lançamentos originais voltaram ao Fluxo.");
      setDesfazendo(false);
      setMotivo("");
      onClose();
    } catch (e: unknown) {
      toast.error(msg(e, "Erro ao desfazer."));
    }
  }

  return (
    <Dialog open={!!unificacaoId} onOpenChange={(o) => { if (!o) { setDesfazendo(false); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" />Lançamento unificado {det?.cabecalho.numero ?? ""}</DialogTitle>
          <DialogDescription>
            {det ? <>Pagamento de <strong>{brl(Number(det.cabecalho.valor_total))}</strong> em {new Date(`${det.cabecalho.data_pagamento}T00:00:00`).toLocaleDateString("pt-BR")}{det.cabecalho.ativa ? "" : " — unificação desfeita"}.</> : "Carregando…"}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !det ? null : (
          <div className="space-y-4 text-sm">
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground"><TituloComFormula alinhar="left" titulo="Lançamentos originais" formula={<><span className="block">Os lançamentos que formaram este pagamento, com o valor e a composição de antes. Continuam guardados e voltam ao Fluxo se a unificação for desfeita.</span><AssinaturaRegra chamado="SIS-2026-0927" /></>} /></h4>
              <ul className="space-y-1.5">
                {det.originais.map((o) => (
                  <li key={o.id} className="rounded-md border p-2">
                    <div className="flex justify-between gap-2"><span className="font-mono text-xs">{o.id_malote} · {o.origem === "malote" ? "Malote" : "Débito Automático"}</span><span className="font-semibold">{brl(Number(o.valor))}</span></div>
                    <p className="text-xs text-muted-foreground">{o.descricao}</p>
                    {o.detalhe && o.detalhe.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{o.detalhe.map((d) => `${d.classificacao ?? "Sem classificação"} · ${d.contrato}: ${brl(Number(d.valor))}`).join("  |  ")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground"><TituloComFormula alinhar="left" titulo="Rateio atual" formula={INFO_RATEIO} /></h4>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1">Classificação</th><th>Centro de custo</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {det.cotas.map((c) => (
                    <tr key={c.id} className="border-t"><td className="py-1">{c.classificacao_nome ?? "—"}</td><td>{c.contrato_id ? c.contrato_nome : "Sem contrato (administrativo)"}</td><td className="text-right">{brl(c.valor)}</td></tr>
                  ))}
                  <tr className="border-t font-semibold"><td className="py-1" colSpan={2}>Total</td><td className="text-right">{brl(det.cotas.reduce((s, c) => s + c.valor, 0))}</td></tr>
                </tbody>
              </table>
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Histórico</h4>
              <ul className="space-y-1 text-xs">
                {det.eventos.map((e) => (
                  <li key={e.id} className="rounded-md border p-2">
                    <span className="font-semibold">{ROTULO_EVENTO[e.tipo] ?? e.tipo}</span> — {e.descricao}
                    <span className="block text-muted-foreground">{e.usuario_nome ?? "—"} · {dataHora(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
            {desfazendo && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Desfazer a unificação?</p>
                <p>Os lançamentos originais voltam ao Fluxo como eram antes e esta linha unificada deixa de existir. O histórico fica registrado.</p>
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obrigatório)" className="bg-background" rows={2} />
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <AcessoGate menu={MENU_UNIFICAR} acao="visualizar">
            {det?.cabecalho.ativa && (
              desfazendo ? (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setDesfazendo(false)} disabled={desfazer.isPending}>Voltar</Button>
                  <Button variant="destructive" onClick={() => void confirmarDesfazer()} disabled={desfazer.isPending || motivo.trim().length < 5}>
                    {desfazer.isPending ? "Desfazendo…" : "Confirmar e desfazer"}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" className="gap-1" onClick={() => unificacaoId && onRatear(unificacaoId)}><Split className="h-3.5 w-3.5" />Refazer rateio</Button>
                  <Button variant="outline" className="gap-1 text-destructive" onClick={() => setDesfazendo(true)}><Undo2 className="h-3.5 w-3.5" />Desfazer unificação</Button>
                </div>
              )
            )}
          </AcessoGate>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
