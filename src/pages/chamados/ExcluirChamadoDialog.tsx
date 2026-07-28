import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import { BUCKET_CHAMADOS } from "./types";

// Exclusão de chamado com confirmação por SENHA da conta.
// O usuário digita a própria senha; confirmamos via re-autenticação
// (signInWithPassword do mesmo usuário) antes de apagar. O DELETE só passa se a
// RLS liberar (capacidade chamados_sistemas_excluir); eventos e anexos saem por
// cascata e os arquivos do storage são removidos best-effort.
export function ExcluirChamadoDialog({
  open,
  onOpenChange,
  chamadoId,
  numero,
  onExcluido,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamadoId: string | null;
  numero?: string | null;
  onExcluido?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [senha, setSenha] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  const fechar = (v: boolean) => {
    if (excluindo) return;
    if (!v) setSenha("");
    onOpenChange(v);
  };

  const excluir = async () => {
    if (!chamadoId || !senha.trim() || excluindo) return;
    if (!user?.email) { toast({ title: "Sessão inválida", variant: "destructive" }); return; }
    setExcluindo(true);

    // 1) Confirma a senha da conta (re-autenticação do próprio usuário).
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: senha });
    if (authErr) {
      setExcluindo(false);
      toast({ title: "Senha incorreta", description: "Não foi possível confirmar sua identidade.", variant: "destructive" });
      return;
    }

    // 2) Remove os arquivos do storage (best-effort; não bloqueia a exclusão).
    try {
      const { data: anexos } = await (supabase as any)
        .from("CHAMADO_SISTEMA_ANEXO").select("storage_path").eq("chamado_id", chamadoId);
      const paths = (anexos ?? []).map((a: any) => a.storage_path).filter(Boolean);
      if (paths.length) await supabase.storage.from(BUCKET_CHAMADOS).remove(paths);
    } catch { /* ignora falha de limpeza de arquivos */ }

    // 3) Apaga o chamado (cascata remove eventos e anexos).
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").delete().eq("id", chamadoId);
    setExcluindo(false);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Chamado${numero ? ` #${numero}` : ""} excluído` });
    setSenha("");
    onOpenChange(false);
    onExcluido?.();
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Excluir chamado{numero ? ` #${numero}` : ""}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Esta ação é <b>permanente</b> e remove o chamado, todo o histórico e os anexos.
          Para confirmar, digite a <b>senha da sua conta</b>.
        </p>
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Senha da conta"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") excluir(); }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => fechar(false)} disabled={excluindo}>Cancelar</Button>
          <Button variant="destructive" onClick={excluir} disabled={!senha.trim() || excluindo}>
            {excluindo ? "Excluindo…" : "Excluir definitivamente"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
