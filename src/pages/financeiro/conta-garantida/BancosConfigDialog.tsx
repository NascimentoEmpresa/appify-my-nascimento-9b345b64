import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  BancoContaGarantida,
  useBancosContaGarantida,
  useSalvarBancoContaGarantida,
  useToggleBancoAtivo,
} from "@/hooks/useContaGarantida";

const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

interface FormState {
  id?: string;
  nome: string;
  limite: string;
  taxa_mensal: string;
  perc_cdi: string;
  vencimento: string;
}

const EMPTY: FormState = { nome: "", limite: "", taxa_mensal: "", perc_cdi: "", vencimento: "" };

export function BancosConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: bancos = [] } = useBancosContaGarantida();
  const salvar = useSalvarBancoContaGarantida();
  const toggleAtivo = useToggleBancoAtivo();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (!open) setForm(EMPTY);
  }, [open]);

  function editar(b: BancoContaGarantida) {
    setForm({
      id: b.id,
      nome: b.nome,
      limite: String(b.limite || ""),
      taxa_mensal: String(b.taxa_mensal || ""),
      perc_cdi: String(b.perc_cdi || ""),
      vencimento: b.vencimento ?? "",
    });
  }

  async function handleSalvar() {
    if (!form.nome.trim()) {
      toast.error("Informe o nome do banco.");
      return;
    }
    try {
      await salvar.mutateAsync({
        id: form.id,
        nome: form.nome.trim().toUpperCase(),
        limite: Number(form.limite) || 0,
        taxa_mensal: Number(form.taxa_mensal) || 0,
        perc_cdi: Number(form.perc_cdi) || 0,
        vencimento: form.vencimento || null,
        ativo: true,
      });
      toast.success("Banco salvo.");
      setForm(EMPTY);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar banco.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Bancos</DialogTitle>
          <DialogDescription>
            Limite de cheque especial, taxa mensal e %CDI usados no cálculo de dívida/rendimento.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-card p-3 space-y-3">
          <p className="text-sm font-semibold">{form.id ? `Editando: ${form.nome}` : "Adicionar banco"}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex: BRADESCO SN" />
            </div>
            <div>
              <Label className="text-xs">Limite (R$)</Label>
              <Input type="number" step="1000" value={form.limite} onChange={(e) => setForm((f) => ({ ...f, limite: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Vencimento</Label>
              <Input type="date" value={form.vencimento} onChange={(e) => setForm((f) => ({ ...f, vencimento: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Taxa Mensal (%)</Label>
              <Input type="number" step="0.01" value={form.taxa_mensal} onChange={(e) => setForm((f) => ({ ...f, taxa_mensal: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">% CDI</Label>
              <Input type="number" step="0.1" value={form.perc_cdi} onChange={(e) => setForm((f) => ({ ...f, perc_cdi: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSalvar} disabled={salvar.isPending}>
              {form.id ? <Pencil className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {form.id ? "Salvar alterações" : "Adicionar"}
            </Button>
            {form.id && (
              <Button size="sm" variant="outline" onClick={() => setForm(EMPTY)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Banco</TableHead>
                <TableHead>Limite</TableHead>
                <TableHead>Taxa/CDI</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bancos.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.nome}</TableCell>
                  <TableCell>{fmtMoney(b.limite)}</TableCell>
                  <TableCell>
                    {b.taxa_mensal > 0 && <Badge variant="outline" className="text-[10px] mr-1">{b.taxa_mensal}%/mês</Badge>}
                    {b.perc_cdi > 0 && <Badge variant="outline" className="text-[10px]">{b.perc_cdi}% CDI</Badge>}
                  </TableCell>
                  <TableCell>{b.vencimento ? new Date(b.vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "-"}</TableCell>
                  <TableCell>
                    <Switch checked={b.ativo} onCheckedChange={(v) => toggleAtivo.mutate({ id: b.id, ativo: v })} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => editar(b)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
