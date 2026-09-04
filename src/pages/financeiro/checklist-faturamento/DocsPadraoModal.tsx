import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDocsPadrao, useSalvarDocPadrao, useExcluirDocPadrao } from "@/hooks/useChecklistFaturamento";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";

// SIS-2026-0304 (achado revisando com o usuário): o catálogo de
// documentos é o `doc_tipos` que já existe em Licitações > Documentos —
// por EMPRESA, não global (mesmo nome pode existir em várias empresas,
// cada uma com seu próprio registro). Este modal é só um atalho pra
// gerenciar isso sem sair do Checklist; a fonte da verdade continua
// sendo /app/documentos.
export function DocsPadraoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const [empresaId, setEmpresaId] = useState("");
  const { data: docs = [] } = useDocsPadrao(empresaId || null);
  const salvar = useSalvarDocPadrao();
  const excluir = useExcluirDocPadrao();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  useEffect(() => {
    if (!open) { setNome(""); setDescricao(""); }
    else if (!empresaId && empresas.length > 0) setEmpresaId(empresas[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, empresas]);

  async function adicionar() {
    if (!empresaId) return toast.error("Selecione a empresa.");
    if (!nome.trim()) return toast.error("Informe o nome do documento.");
    try {
      await salvar.mutateAsync({ empresaId, nome, descricao: descricao.trim() || null });
      toast.success("Documento adicionado.");
      setNome("");
      setDescricao("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao adicionar documento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Documentos-Padrão</DialogTitle>
          <DialogDescription>
            Mesmo catálogo de "Licitações &gt; Documentos" (por empresa) — o que você adicionar ou remover aqui também aparece lá.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label className="text-xs">Empresa</Label>
          <Select value={empresaId} onValueChange={setEmpresaId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Comprovante de VT" />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <Button size="sm" onClick={adicionar} disabled={salvar.isPending}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
          </Button>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-sm">{d.nome}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.descricao ?? "—"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => excluir.mutate({ id: d.id, empresaId: d.empresa_id })}>
                      <Trash2 className="h-3 w-3" />
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
