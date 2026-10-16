import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, FileDown, Send } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissoes } from "@/context/PermissoesContext";
import type { ContratoERP } from "@/hooks/useContratosERP";
import { useEnviarNfsEmLote, useItensNfEmissaoEmLote, type NfEmissaoRow } from "@/hooks/useNfEmissao";
import type { NfEmissaoModeloRow } from "@/hooks/useNfEmissaoModelo";
import { ROTULO_FONTE_EXEC } from "@/pages/controladoria/faturamento/composicao";
import { useBaseFaturamento } from "@/pages/controladoria/faturamento/useBaseFaturamento";
import {
  competenciaInicialDaLista, conferenciaDoMes, entraNosTotais, linhaDaLista, problemasParaEnviar, totaisDaLista,
  type ItemDaLista, type LinhaLista, type NfDaLista,
} from "./listaFinal";
import { registrarLogNf } from "./registrarLogNf";
import { STATUS_CLASS, STATUS_LABEL, competenciaAnterior, fmtCompetenciaCurta, fmtDate, fmtMoney, proximaCompetencia } from "./shared";

// SIS-2026-0671: Lista final da Emissão de NF — a "primeira aba" da planilha modelo (Lista NFs): todas as variações do
// contrato na competência com o valor mensal total e as faltas, a conferência com o executável e o envio em lote ao Financeiro.
interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contrato: ContratoERP;
  nfs: NfEmissaoRow[];
  modelosAtivos: NfEmissaoModeloRow[];
  competenciaSugerida: string;
}

const NUM = "whitespace-nowrap px-2 text-right tabular-nums";

export function ListaFinalDialog({ open, onOpenChange, contrato, nfs, modelosAtivos, competenciaSugerida }: Props) {
  const { can } = usePermissoes();
  // Mesmo acesso de "incluir" da Emissão de NF (o banco exige o mesmo para marcar a NF como enviada).
  const podeEnviar = can("incluir", "financeiro", "nf-emissao");
  const base = useBaseFaturamento();
  const enviar = useEnviarNfsEmLote();

  const [competenciaSel, setCompetenciaSel] = useState<string | null>(null);
  const competencia = competenciaSel ?? competenciaInicialDaLista(nfs, competenciaSugerida);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);

  const nfsDaCompetencia = useMemo(
    () => nfs.filter((n) => n.competencia.slice(0, 7) === competencia).sort((a, b) => (a.variacao ?? "").localeCompare(b.variacao ?? "", "pt-BR", { numeric: true })),
    [nfs, competencia],
  );
  const { data: itensTodos = [], isLoading: carregandoItens } = useItensNfEmissaoEmLote(nfsDaCompetencia.map((n) => n.id));
  const itensPorNf = useMemo(() => {
    const m = new Map<string, ItemDaLista[]>();
    for (const i of itensTodos as ItemDaLista[]) m.set(i.nf_emissao_id, [...(m.get(i.nf_emissao_id) ?? []), i]);
    return m;
  }, [itensTodos]);

  const linhas: LinhaLista[] = useMemo(
    () => nfsDaCompetencia.map((n) => linhaDaLista(n as unknown as NfDaLista, itensPorNf.get(n.id) ?? [])),
    [nfsDaCompetencia, itensPorNf],
  );
  const totais = useMemo(() => totaisDaLista(linhas), [linhas]);

  const exec = base.carregando ? null : base.origemExecutavel(contrato, competencia);
  const conferencia = useMemo(
    () => conferenciaDoMes(linhas, exec?.valor ?? 0, modelosAtivos.map((m) => m.variacao)),
    [linhas, exec, modelosAtivos],
  );

  const rascunhos = linhas.filter((l) => l.nf.status === "rascunho");
  const marcadasValidas = rascunhos.filter((l) => marcadas.has(l.nf.id));
  const analise = useMemo(
    () => marcadasValidas.map((l) => ({ linha: l, problemas: problemasParaEnviar(l.nf, itensPorNf.get(l.nf.id) ?? []) })),
    [marcadasValidas, itensPorNf],
  );
  const aEnviar = analise.filter((a) => a.problemas.length === 0);
  const comProblema = analise.filter((a) => a.problemas.length > 0);

  function trocarCompetencia(c: string) {
    setCompetenciaSel(c);
    setMarcadas(new Set());
  }
  const alternar = (id: string) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todasMarcadas = rascunhos.length > 0 && rascunhos.every((l) => marcadas.has(l.nf.id));

  async function confirmarEnvio() {
    try {
      const enviadas = await enviar.mutateAsync(aEnviar.map((a) => a.linha.nf.id));
      for (const id of enviadas) await registrarLogNf(id, "nf_enviada", "Enviada para o Financeiro (envio em lote pela Lista final)");
      const ignoradas = aEnviar.length - enviadas.length;
      toast.success(`${enviadas.length} NF(s) enviada(s) para o Financeiro.${ignoradas > 0 ? ` ${ignoradas} já não estavam mais em rascunho.` : ""}`);
      setMarcadas(new Set());
      setConfirmando(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar as NFs.");
    }
  }

  function exportar() {
    if (linhas.length === 0) { toast.error("Não há NFs nesta competência."); return; }
    const linhasXlsx = linhas.map((l) => ({
      Competência: fmtCompetenciaCurta(competencia),
      Variação: l.nf.variacao ?? "",
      "Nº nota": l.nf.numero_nf ?? "",
      "Data emissão": fmtDate(l.nf.data_emissao),
      Código: l.nf.tipo_nota,
      "Cliente/serviço/contrato": `${contrato.cliente ?? ""} - ${contrato.nome}`,
      "Situação site P.M.T.": l.nf.situacao_site_pmt ?? "",
      "Situa Domínio": l.nf.situacao_dominio ?? "",
      "Valor contrato exec.": l.exec,
      "Valor contábil": l.contabil,
      "Vlr liq.": l.liquido,
      ISSQN: l.nf.issqn_total || 0, INSS: l.nf.inss_total || 0, IR: l.nf.ir_total || 0,
      COFINS: l.nf.cofins_total || 0, PIS: l.nf.pis_total || 0, CSLL: l.nf.csll_total || 0,
      "Total Ret.": l.retencoes,
      Faltas: l.faltas,
      "Posto não implementado": l.postoNaoImplementado,
      "Multas antes da emissão": l.multasAntes, "Multas depois da emissão": l.multasDepois,
      "Glosas antes da emissão": l.glosasAntes, "Glosas depois da emissão": l.glosasDepois,
      "Outros descontos antes da emissão": l.outrosAntes, "Outros descontos após emissão": l.outrosDepois,
      "Desconto de conta vinculada": l.contaVinculada,
      Status: STATUS_LABEL[l.nf.status] ?? l.nf.status,
      "Entra nos totais": entraNosTotais(l.nf) ? "Sim" : "Não",
    }));
    const resumo: (string | number)[][] = [
      [`Lista final — ${contrato.nome}`, ""],
      ["Competência", fmtCompetenciaCurta(competencia)],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      ["", ""],
      ["Executável do mês", conferencia.executavel],
      ["Emitido (NFs Código N)", conferencia.emitido],
      ["Diferença (executável − emitido)", conferencia.diferenca],
      ["Variações do modelo sem NF", conferencia.variacoesSemNf.join("; ") || "nenhuma"],
      ["", ""],
      ["Total valor contrato exec.", totais.exec], ["Total valor contábil", totais.contabil], ["Total líquido", totais.liquido],
      ["Total retenções", totais.retencoes], ["Total faltas", totais.faltas],
      ["Obs.: NF cancelada ou substituída aparece na lista mas não entra nos totais.", ""],
    ];
    import("xlsx").then((XLSX) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasXlsx), "Lista NFs");
      const ws = XLSX.utils.aoa_to_sheet(resumo);
      ws["!cols"] = [{ wch: 46 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, "Conferência");
      XLSX.writeFile(wb, `Lista_NFs_${contrato.nome.replace(/[^\w]+/g, "_")}_${competencia}.xlsx`);
    });
  }

  const temDiferenca = !!exec && exec.valor > 0 && Math.abs(conferencia.diferenca) > 0.005;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1400px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lista final — {contrato.nome}</DialogTitle>
            <DialogDescription>
              Todas as NFs do contrato na competência, com o valor mensal total e as faltas, para conferir antes de enviar ao Financeiro.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => trocarCompetencia(competenciaAnterior(competencia))}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="w-24 text-center text-sm font-semibold tabular-nums">{fmtCompetenciaCurta(competencia)}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => trocarCompetencia(proximaCompetencia(competencia))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportar}><FileDown className="h-3.5 w-3.5" />Exportar Excel</Button>
              {podeEnviar && (
                <Button size="sm" className="gap-1.5" disabled={marcadasValidas.length === 0} onClick={() => setConfirmando(true)}>
                  <Send className="h-3.5 w-3.5" />Enviar selecionadas ({marcadasValidas.length})
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Executável do mês</p>
              <p className="text-lg font-semibold tabular-nums">{exec ? fmtMoney(exec.valor) : "…"}</p>
              {exec && <p className="text-[11px] text-muted-foreground">{ROTULO_FONTE_EXEC[exec.fonte]}</p>}
            </div>
            <div className="rounded-md border p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Emitido (NFs Código N)</p>
              <p className="text-lg font-semibold tabular-nums">{fmtMoney(conferencia.emitido)}</p>
              <p className="text-[11px] text-muted-foreground">soma do valor do contrato exec. das notas</p>
            </div>
            <div className={`rounded-md border p-3 ${temDiferenca ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20" : ""}`}>
              <p className="text-[11px] uppercase text-muted-foreground">Diferença (executável − emitido)</p>
              <p className={`text-lg font-semibold tabular-nums ${temDiferenca ? "text-amber-700 dark:text-amber-300" : ""}`}>{exec ? fmtMoney(conferencia.diferenca) : "…"}</p>
              <p className="text-[11px] text-muted-foreground">
                {!exec ? "" : exec.valor <= 0 ? "sem executável cadastrado para este mês" : conferencia.diferenca > 0 ? "falta emitir" : conferencia.diferenca < 0 ? "emitido acima do executável" : "fechado"}
              </p>
            </div>
          </div>

          {conferencia.variacoesSemNf.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {conferencia.variacoesSemNf.length} variação(ões) do modelo ainda sem NF em {fmtCompetenciaCurta(competencia)}:{" "}
                {conferencia.variacoesSemNf.slice(0, 8).join("; ")}{conferencia.variacoesSemNf.length > 8 ? "…" : ""}
              </span>
            </div>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  {podeEnviar && (
                    <TableHead className="w-8 px-2">
                      <Checkbox
                        checked={todasMarcadas}
                        disabled={rascunhos.length === 0}
                        onCheckedChange={(v) => setMarcadas(v ? new Set(rascunhos.map((l) => l.nf.id)) : new Set())}
                        aria-label="Marcar todas as NFs em rascunho"
                      />
                    </TableHead>
                  )}
                  <TableHead className="min-w-[200px] px-2">Variação</TableHead>
                  <TableHead className="px-2">Nº NF</TableHead>
                  <TableHead className="px-2">Emissão</TableHead>
                  <TableHead className="px-2">Cód.</TableHead>
                  <TableHead className="px-2 text-right">Valor contrato exec.</TableHead>
                  <TableHead className="px-2 text-right">Valor contábil</TableHead>
                  <TableHead className="px-2 text-right">Líquido</TableHead>
                  <TableHead className="px-2 text-right">Retenções</TableHead>
                  <TableHead className="px-2 text-right">Faltas</TableHead>
                  <TableHead className="px-2 text-right">Posto não impl.</TableHead>
                  <TableHead className="px-2 text-right" title="Multas + glosas + outros descontos aplicados antes da emissão">Desc. antes da NF</TableHead>
                  <TableHead className="px-2 text-right" title="Multas + glosas + outros descontos aplicados depois da emissão">Desc. depois da NF</TableHead>
                  <TableHead className="px-2 text-right">Conta vinculada</TableHead>
                  <TableHead className="px-2">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carregandoItens && <TableRow><TableCell colSpan={15} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!carregandoItens && linhas.length === 0 && (
                  <TableRow><TableCell colSpan={15} className="py-8 text-center text-muted-foreground">Nenhuma NF em {fmtCompetenciaCurta(competencia)}.</TableCell></TableRow>
                )}
                {linhas.map((l) => {
                  const conta = entraNosTotais(l.nf);
                  const problemas = l.nf.status === "rascunho" ? problemasParaEnviar(l.nf, itensPorNf.get(l.nf.id) ?? []) : [];
                  return (
                    <TableRow key={l.nf.id} className={conta ? undefined : "text-muted-foreground line-through"}>
                      {podeEnviar && (
                        <TableCell className="px-2">
                          {l.nf.status === "rascunho" && (
                            <Checkbox checked={marcadas.has(l.nf.id)} onCheckedChange={() => alternar(l.nf.id)} aria-label={`Marcar ${l.nf.variacao ?? "NF"}`} />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="px-2">
                        <span className="block max-w-[260px] truncate" title={l.nf.variacao ?? ""}>{l.nf.variacao ?? "-"}</span>
                        {problemas.length > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400" title={problemas.join(" ")}>
                            <AlertTriangle className="h-3 w-3" />{problemas[0]}{problemas.length > 1 ? ` (+${problemas.length - 1})` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 font-mono">{l.nf.numero_nf ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap px-2">{fmtDate(l.nf.data_emissao)}</TableCell>
                      <TableCell className="px-2">{l.nf.tipo_nota}</TableCell>
                      <TableCell className={NUM}>{fmtMoney(l.exec)}</TableCell>
                      <TableCell className={NUM}>{fmtMoney(l.contabil)}</TableCell>
                      <TableCell className={NUM}>{fmtMoney(l.liquido)}</TableCell>
                      <TableCell className={NUM}>{fmtMoney(l.retencoes)}</TableCell>
                      <TableCell className={NUM}>{l.faltas ? fmtMoney(l.faltas) : "—"}</TableCell>
                      <TableCell className={NUM}>{l.postoNaoImplementado ? fmtMoney(l.postoNaoImplementado) : "—"}</TableCell>
                      <TableCell className={NUM}>{l.descontosAntes ? fmtMoney(l.descontosAntes) : "—"}</TableCell>
                      <TableCell className={NUM}>{l.descontosDepois ? fmtMoney(l.descontosDepois) : "—"}</TableCell>
                      <TableCell className={NUM}>{l.contaVinculada ? fmtMoney(l.contaVinculada) : "—"}</TableCell>
                      <TableCell className="px-2"><Badge className={STATUS_CLASS[l.nf.status]}>{STATUS_LABEL[l.nf.status]}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {linhas.length > 0 && (
                <TableFooter>
                  <TableRow className="font-semibold">
                    <TableCell colSpan={podeEnviar ? 5 : 4} className="px-2">Total ({totais.notas} NF{totais.notas === 1 ? "" : "s"})</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.exec)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.contabil)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.liquido)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.retencoes)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.faltas)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.postoNaoImplementado)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.descontosAntes)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.descontosDepois)}</TableCell>
                    <TableCell className={NUM}>{fmtMoney(totais.contaVinculada)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            NF cancelada ou substituída aparece na lista, mas não entra nos totais. A conferência com o executável conta só as notas Código N.
          </p>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar {aEnviar.length} NF(s) para o Financeiro?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {contrato.nome} — {fmtCompetenciaCurta(competencia)}. Total líquido das notas a enviar:{" "}
                  <strong>{fmtMoney(aEnviar.reduce((s, a) => s + a.linha.liquido, 0))}</strong>.
                </p>
                {temDiferenca && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    Atenção: o emitido nas NFs Código N ({fmtMoney(conferencia.emitido)}) difere do executável do mês ({fmtMoney(conferencia.executavel)}) em {fmtMoney(Math.abs(conferencia.diferenca))}
                    {conferencia.diferenca > 0 ? " (falta emitir)" : " (acima do executável)"}.
                    {conferencia.variacoesSemNf.length > 0 ? ` Variações sem NF: ${conferencia.variacoesSemNf.slice(0, 5).join("; ")}${conferencia.variacoesSemNf.length > 5 ? "…" : ""}.` : ""}
                  </p>
                )}
                {comProblema.length > 0 && (
                  <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                    <p className="font-medium">{comProblema.length} NF(s) marcada(s) não serão enviadas:</p>
                    <ul className="list-disc pl-5">
                      {comProblema.slice(0, 8).map((a) => <li key={a.linha.nf.id}>{a.linha.nf.variacao ?? "NF"}: {a.problemas[0]}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviar.isPending}>Voltar</AlertDialogCancel>
            <Button onClick={() => void confirmarEnvio()} disabled={enviar.isPending || aEnviar.length === 0}>
              {enviar.isPending ? "Enviando…" : `Enviar ${aEnviar.length} NF(s)`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
