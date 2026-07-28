import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, FileCheck, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useContratosERP } from "@/hooks/useContratosERP";
import {
  NfEmissaoRow,
  NfEmissaoItemRow,
  useNfsEmissao,
  useItensNfEmissao,
  useRegistrarPagamentoNf,
} from "@/hooks/useNfEmissao";
import { calcularItem, calcularTotaisNf, ItemCalculado } from "@/pages/financeiro/nf-emissao/calculos";
import { fmtMoney, fmtDate } from "@/pages/financeiro/nf-emissao/shared";
import { ItensNfEditor, ItemForm } from "@/pages/financeiro/nf-emissao/ItensNfEditor";
import { registrarLogNf } from "@/pages/financeiro/nf-emissao/registrarLogNf";
import { HistoricoNfPainel } from "@/pages/financeiro/nf-emissao/HistoricoNfPainel";

function itemRowParaForm(r: NfEmissaoItemRow): ItemForm {
  return {
    identificacao: r.identificacao ?? "",
    valor_contrato_exec: r.valor_contrato_exec,
    vlr_va: r.vlr_va,
    vlr_vt: r.vlr_vt,
    vlr_materiais: r.vlr_materiais,
    faltas: r.faltas,
    posto_nao_implementado: r.posto_nao_implementado,
    multas: r.multas,
    glosas: r.glosas,
    outros_descontos: r.outros_descontos,
    multas_pos_emissao: r.multas_pos_emissao,
    glosas_pos_emissao: r.glosas_pos_emissao,
    outros_descontos_pos_emissao: r.outros_descontos_pos_emissao,
    qtd_colaboradores: r.qtd_colaboradores,
    inss_categoria: r.inss_categoria,
  };
}

export default function NotasConcluidasTab() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;
  const { data: nfs = [], isLoading } = useNfsEmissao(empresaId);
  const { data: contratos = [] } = useContratosERP();

  const [busca, setBusca] = useState("");
  const [contratoSel, setContratoSel] = useState<string | null>(null);
  const [nfSelecionada, setNfSelecionada] = useState<NfEmissaoRow | null>(null);

  const concluidas = useMemo(() => nfs.filter((n) => n.status === "concluida"), [nfs]);

  const contratosComNotas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contratos
      .map((c) => ({ contrato: c, notas: concluidas.filter((n) => n.contrato_id === c.id) }))
      .filter(({ contrato, notas }) => {
        if (notas.length === 0) return false;
        if (!termo) return true;
        return contrato.nome.toLowerCase().includes(termo) || contrato.cliente.toLowerCase().includes(termo);
      })
      .sort((a, b) => a.contrato.nome.localeCompare(b.contrato.nome));
  }, [contratos, concluidas, busca]);

  const contratoAtual = contratos.find((c) => c.id === contratoSel) ?? null;
  const nfsDoContrato = useMemo(() => concluidas.filter((n) => n.contrato_id === contratoSel), [concluidas, contratoSel]);

  return (
    <div className="grid grid-cols-5 gap-4 min-h-[600px]">
      <div className="col-span-2 card-elevated flex flex-col overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar contrato…"
              className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {!isLoading && contratosComNotas.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma NF concluída ainda. Conclua notas em Controle de Notas pra elas aparecerem aqui.
            </p>
          )}
          {contratosComNotas.map(({ contrato: c, notas }) => {
            const pendentes = notas.filter((n) => !n.data_pagamento).length;
            const ativo = contratoSel === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setContratoSel(c.id)}
                className={`flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30 ${ativo ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{c.nome}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.cliente}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {notas.length}
                  </span>
                  {pendentes > 0 && (
                    <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {pendentes} pend.
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="col-span-3 card-elevated flex flex-col overflow-hidden">
        {!contratoAtual ? (
          <div className="flex h-full items-center justify-center py-20">
            <div className="text-center">
              <FileCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Selecione um contrato</p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">{contratoAtual.nome}</p>
              <p className="text-xs text-muted-foreground">{contratoAtual.cliente}</p>
            </div>
            <div className="overflow-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Variação</TableHead>
                    <TableHead>Nº NF</TableHead>
                    <TableHead>Valor Líquido</TableHead>
                    <TableHead>Pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nfsDoContrato.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Nenhuma NF concluída para este contrato.
                      </TableCell>
                    </TableRow>
                  )}
                  {nfsDoContrato.map((nf) => (
                    <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setNfSelecionada(nf)}>
                      <TableCell>
                        {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                      </TableCell>
                      <TableCell>{nf.variacao ?? "-"}</TableCell>
                      <TableCell>{nf.numero_nf ?? "-"}</TableCell>
                      <TableCell>{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                      <TableCell>
                        {nf.data_pagamento ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            Pago em {fmtDate(nf.data_pagamento)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                            Pendente
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <NfPagamentoDialog nf={nfSelecionada} onClose={() => setNfSelecionada(null)} />
    </div>
  );
}

function NfPagamentoDialog({ nf, onClose }: { nf: NfEmissaoRow | null; onClose: () => void }) {
  const { data: itensExistentes = [] } = useItensNfEmissao(nf?.id);
  const registrarPagamento = useRegistrarPagamentoNf();

  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [valorPago, setValorPago] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  useEffect(() => {
    if (!nf) return;
    setValorPago(String(nf.valor_pago ?? nf.vlr_liquido_total ?? 0));
    setDataPagamento(nf.data_pagamento ?? new Date().toISOString().slice(0, 10));
  }, [nf?.id]);

  const itens: ItemForm[] = useMemo(() => itensExistentes.map(itemRowParaForm), [itensExistentes]);

  const pctFiscais = nf
    ? { issqn_pct: nf.issqn_pct, ir_pct: nf.ir_pct, cofins_pct: nf.cofins_pct, pis_pct: nf.pis_pct, csll_pct: nf.csll_pct }
    : null;

  const itensCalculados: ItemCalculado[] = useMemo(() => {
    if (!pctFiscais) return [];
    return itens.map((it) => calcularItem(it, pctFiscais));
  }, [itens, pctFiscais]);

  const totais = useMemo(() => calcularTotaisNf(itensCalculados), [itensCalculados]);

  function toggleExpandido(i: number) {
    setExpandidos((exp) => {
      const n = new Set(exp);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  async function handleSalvarPagamento() {
    if (!nf) return;
    const valor = Number(valorPago);
    if (!dataPagamento || isNaN(valor) || valor <= 0) {
      toast.error("Informe um valor e uma data de pagamento válidos.");
      return;
    }
    try {
      await registrarPagamento.mutateAsync({ id: nf.id, data_pagamento: dataPagamento, valor_pago: valor });
      await registrarLogNf(nf.id, "nf_paga", `Pagamento registrado: ${fmtMoney(valor)} em ${fmtDate(dataPagamento)}`);
      toast.success("Pagamento registrado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar pagamento.");
    }
  }

  async function handleRemoverPagamento() {
    if (!nf) return;
    try {
      await registrarPagamento.mutateAsync({ id: nf.id, data_pagamento: null, valor_pago: null });
      await registrarLogNf(nf.id, "pagamento_removido", "Registro de pagamento removido");
      toast.success("Registro de pagamento removido.");
      setConfirmandoRemocao(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover pagamento.");
    }
  }

  return (
    <Dialog open={!!nf} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-screen h-screen max-w-none max-h-screen overflow-y-auto overflow-x-hidden rounded-none sm:rounded-none">
        <DialogHeader>
          <DialogTitle>NF Concluída</DialogTitle>
          <DialogDescription>Confira os dados validados e registre o pagamento quando ele acontecer.</DialogDescription>
        </DialogHeader>

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Contrato</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.contrato?.nome ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Variação</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.variacao ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Nº NF</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.numero_nf ?? "-"}
                </div>
              </div>
            </div>
          </section>
        )}

        {nf && (
          <ItensNfEditor
            itens={itens}
            itensCalculados={itensCalculados}
            totais={totais}
            pctFiscais={pctFiscais}
            postosVigentes={[]}
            contratoId={nf.contrato_id}
            expandidos={expandidos}
            mostrarPosEmissao
            readOnly
            onUpdateItem={() => {}}
            onAddItem={() => {}}
            onRemoveItem={() => {}}
            onToggleExpandido={toggleExpandido}
            onSelecionarPosto={() => {}}
            onQtdColaboradoresChange={() => {}}
          />
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CircleDollarSign className="h-4 w-4" /> Pagamento
            </div>
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <Label>Valor Pago</Label>
                <Input type="number" step="0.01" value={valorPago} onChange={(e) => setValorPago(e.target.value)} />
              </div>
              <div>
                <Label>Data de Pagamento</Label>
                <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
              </div>
              <Button onClick={handleSalvarPagamento} disabled={registrarPagamento.isPending}>
                {nf.data_pagamento ? "Atualizar pagamento" : "Registrar pagamento"}
              </Button>
              {nf.data_pagamento && (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirmandoRemocao(true)}>
                  Remover registro
                </Button>
              )}
            </div>
          </section>
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="text-sm font-semibold">Histórico</div>
            <HistoricoNfPainel nfEmissaoId={nf.id} />
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmandoRemocao} onOpenChange={setConfirmandoRemocao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover registro de pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A NF volta a aparecer como pendente de pagamento. Essa ação também fica no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleRemoverPagamento}>
              Confirmar remoção
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
