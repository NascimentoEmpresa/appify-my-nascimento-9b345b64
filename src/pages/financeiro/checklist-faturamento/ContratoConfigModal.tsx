import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  useDocsPadrao, useContratoDocs, useVincularDoc, useDesvincularDoc,
  useContratoConfig, useSalvarContratoConfig, ContratoChecklist,
} from "@/hooks/useChecklistFaturamento";

// SIS-2026-0304: por contrato — quais documentos ele exige (vínculo com o
// catálogo `doc_tipos` DA MESMA EMPRESA do contrato) e o dia-limite padrão
// de entrega (dia do mês SEGUINTE à competência, mesma regra do legado).
export function ContratoConfigModal({ open, onClose, contrato }: { open: boolean; onClose: () => void; contrato: ContratoChecklist | null }) {
  const { data: docsPadrao = [] } = useDocsPadrao(contrato?.empresa_id ?? null);
  const { data: vinculos = [] } = useContratoDocs(contrato?.id ?? null);
  const { data: config } = useContratoConfig(contrato?.id ?? null);
  const vincular = useVincularDoc();
  const desvincular = useDesvincularDoc();
  const salvarConfig = useSalvarContratoConfig();

  const [docParaAdicionar, setDocParaAdicionar] = useState("");
  const [diaLimite, setDiaLimite] = useState("");

  useEffect(() => {
    if (open) setDiaLimite(config?.dia_limite_padrao ? String(config.dia_limite_padrao) : "");
  }, [open, config?.dia_limite_padrao]);

  const docsJaVinculados = new Set(vinculos.map((v) => v.doc_id));
  const docsDisponiveis = docsPadrao.filter((d) => !docsJaVinculados.has(d.id));

  async function adicionarVinculo() {
    if (!contrato || !docParaAdicionar) return;
    try {
      await vincular.mutateAsync({ contratoId: contrato.id, empresaId: contrato.empresa_id, docId: docParaAdicionar });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao vincular documento.");
    }
    setDocParaAdicionar("");
  }

  async function salvarDiaLimite() {
    if (!contrato) return;
    const dia = diaLimite ? Number(diaLimite) : null;
    if (dia != null && (dia < 1 || dia > 31)) return toast.error("Dia inválido — use de 1 a 31.");
    try {
      await salvarConfig.mutateAsync({ contrato_id: contrato.id, dia_limite_padrao: dia, comp_inicio: config?.comp_inicio ?? null });
      toast.success("Dia-limite padrão salvo.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar dia-limite.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Checklist — {contrato?.nome}</DialogTitle>
          <DialogDescription>Documentos exigidos deste contrato e o dia-limite padrão de entrega.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs">Dia-limite padrão (dia do mês seguinte à competência)</Label>
          <div className="flex gap-2">
            <Input type="number" min={1} max={31} className="w-24" value={diaLimite} onChange={(e) => setDiaLimite(e.target.value)} placeholder="Ex: 25" />
            <Button size="sm" variant="outline" onClick={salvarDiaLimite} disabled={salvarConfig.isPending}>Salvar</Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Documentos exigidos</Label>
          <div className="flex gap-2">
            <Select value={docParaAdicionar} onValueChange={setDocParaAdicionar}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um documento" /></SelectTrigger>
              <SelectContent>
                {docsDisponiveis.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={adicionarVinculo} disabled={!docParaAdicionar || vincular.isPending}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="rounded-md border divide-y">
            {vinculos.length === 0 && <p className="p-3 text-xs text-muted-foreground text-center">Nenhum documento vinculado ainda.</p>}
            {vinculos.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{v.doc?.nome}</span>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                  onClick={() => desvincular.mutate({ id: v.id, contratoId: v.contrato_id })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
