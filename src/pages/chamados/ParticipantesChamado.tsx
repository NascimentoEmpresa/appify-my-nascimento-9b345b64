import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useUsuariosAtivos } from "./StatusValidacao";
import type { Participante } from "./ChatChamado";

// =====================================================================
// PARTICIPANTES EXTRAS do chamado (mig 20261009000003, 09/10/2026).
//
// Botão "Adicionar participante" logo abaixo do "Abrir PR" (Ações rápidas).
// Quem é incluído enxerga o chamado e a conversa como o solicitante e, depois
// de concluído, também AVALIA — e não abre outro chamado enquanto não avaliar
// (a trava é a mesma do solicitante, no banco). Incluir/remover só pelas RPCs,
// que conferem se quem pede é o responsável ou a gestão.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function BotaoAdicionarParticipante({ chamado }: {
  chamado: { id: string; numero?: string | null; solicitante_id: string; responsavel_id: string | null };
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  // A mesma lista do "Quem tem acesso" da conversa — já traz o nome.
  const { data: todos = [] } = useQuery({
    queryKey: ["chamado-participantes", chamado.id],
    queryFn: async () => {
      const { data } = await sb.rpc("chamado_participantes", { p_chamado_id: chamado.id });
      return (data ?? []) as Participante[];
    },
  });
  const extras = todos.filter((p) => p.papel === "participante");
  const usuarios = useUsuariosAtivos(aberto);

  const opcoes = useMemo(() => {
    const fora = new Set([chamado.solicitante_id, chamado.responsavel_id, ...extras.map((p) => p.user_id)]);
    return (usuarios.data ?? []).filter((u) => !fora.has(u.id))
      .map((u) => ({ value: u.id, label: u.display_name, hint: u.setor ?? undefined }));
  }, [usuarios.data, extras, chamado.solicitante_id, chamado.responsavel_id]);

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["chamado-participantes", chamado.id] });
    qc.invalidateQueries({ queryKey: ["chamado-eventos", chamado.id] });
    qc.invalidateQueries({ queryKey: ["chamado", chamado.id] });
  };

  const adicionar = async () => {
    if (!escolhido) return;
    setSalvando(escolhido);
    const { error } = await sb.rpc("chamado_participante_adicionar", { p_chamado_id: chamado.id, p_user_id: escolhido });
    setSalvando(null);
    if (error) { toast({ title: "Não foi possível incluir", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Participante incluído", description: "Ele já vê o chamado e a conversa — e avalia quando for concluído." });
    setEscolhido("");
    atualizar();
  };

  const remover = async (p: Participante) => {
    setSalvando(p.user_id);
    const { error } = await sb.rpc("chamado_participante_remover", { p_chamado_id: chamado.id, p_user_id: p.user_id });
    setSalvando(null);
    if (error) { toast({ title: "Não foi possível remover", description: error.message, variant: "destructive" }); return; }
    atualizar();
  };

  return (
    <>
      <Button variant="outline" className="w-full justify-start gap-2 transition-transform active:scale-95" onClick={() => setAberto(true)}>
        <UserPlus className="h-4 w-4 text-primary" /> Adicionar participante
        {extras.length > 0 && <span className="ml-auto rounded-full bg-primary/10 px-2 text-xs font-semibold text-primary">{extras.length}</span>}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Participantes{chamado.numero ? ` #${chamado.numero}` : ""}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Quem for incluído acompanha o chamado e a conversa e, quando o chamado for concluído, também avalia —
              não abre outro chamado enquanto não avaliar.
            </p>
          </DialogHeader>

          <div className="flex gap-2">
            <SearchableSelect className="flex-1" value={escolhido} onChange={setEscolhido} options={opcoes}
              placeholder={usuarios.isLoading ? "Carregando usuários…" : "Escolha a pessoa"} searchPlaceholder="Buscar por nome ou setor…"
              emptyLabel="Ninguém encontrado" />
            <Button onClick={adicionar} disabled={!escolhido || !!salvando} className="gap-1.5">
              {salvando === escolhido && escolhido ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Incluir
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Participantes extras ({extras.length})</p>
            {extras.length === 0 && <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Ninguém incluído ainda.</p>}
            {extras.map((p) => (
              <div key={p.user_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="truncate font-medium">{p.nome}</span>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive hover:text-destructive" disabled={!!salvando} onClick={() => remover(p)}>
                  {salvando === p.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remover
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
