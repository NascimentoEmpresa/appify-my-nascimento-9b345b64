import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  useCriarTipoSolicitacaoAjuste,
  useExcluirTipoSolicitacaoAjuste,
  useRenomearTipoSolicitacaoAjuste,
  useTiposSolicitacaoAjuste,
} from "@/hooks/useSolicitacaoAjuste";

// SIS-2026-0305: CRUD simples do catálogo de sugestão (SOLICITACAO_AJUSTE_TIPO)
// — só alimenta o autocomplete de descrição de item, sem vínculo com contrato/empresa.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GerenciarTiposModal({ open, onOpenChange }: Props) {
  const { data: tipos = [] } = useTiposSolicitacaoAjuste();
  const criar = useCriarTipoSolicitacaoAjuste();
  const renomear = useRenomearTipoSolicitacaoAjuste();
  const excluir = useExcluirTipoSolicitacaoAjuste();
  const [novoNome, setNovoNome] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState("");

  async function handleCriar() {
    if (!novoNome.trim()) return;
    try {
      await criar.mutateAsync(novoNome);
      setNovoNome("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar tipo.");
    }
  }

  async function handleRenomear() {
    if (!editandoId || !editandoNome.trim()) return;
    try {
      await renomear.mutateAsync({ id: editandoId, nome: editandoNome });
      setEditandoId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao renomear.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* overflow-x-hidden como defesa extra: mesmo que algum conteúdo futuro
          seja mais largo que o previsto, trava aqui em vez de deixar o
          diálogo inteiro ganhar scroll lateral (achado do usuário testando). */}
      <DialogContent className="max-h-[70vh] max-w-sm overflow-x-hidden overflow-y-auto gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-base">Tipos de Documento</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1.5">
          <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Novo tipo..." className="h-8 min-w-0 flex-1 text-sm" onKeyDown={(e) => e.key === "Enter" && handleCriar()} />
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={handleCriar}>
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
        <div className="space-y-0.5">
          {tipos.map((tipo) => (
            <div key={tipo.id} className="flex items-start gap-1 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
              {editandoId === tipo.id ? (
                <>
                  <Input value={editandoNome} onChange={(e) => setEditandoNome(e.target.value)} className="h-7 min-w-0 flex-1 text-sm" autoFocus />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleRenomear}><Check className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditandoId(null)}><X className="h-3.5 w-3.5" /></Button>
                </>
              ) : (
                <>
                  {/* Quebra linha em vez de truncar (achado do usuário: truncar
                      escondia os botões de ação junto) — assim o nome completo
                      e os botões ficam sempre visíveis, o texto só cresce em
                      altura, nunca em largura. */}
                  <span className="min-w-0 flex-1 break-words py-0.5 leading-snug">{tipo.nome}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setEditandoId(tipo.id); setEditandoNome(tipo.nome); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => excluir.mutate(tipo.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
