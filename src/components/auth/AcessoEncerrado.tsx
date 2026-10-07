import { useState } from "react";
import { LogOut, UserX, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tela de quem tem login vinculado a colaborador demitido (mig
 * 20261006160000): o ERP não abre, mas o Portal do Colaborador continua —
 * holerite, ponto e histórico ficam lá, com o login por CPF.
 */
export function AcessoEncerrado({ nome, situacao }: { nome: string | null; situacao: string | null }) {
  const [saindo, setSaindo] = useState(false);
  const sair = async (destino: string) => {
    setSaindo(true);
    try { await supabase.auth.signOut(); } finally { window.location.assign(destino); }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <UserX className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold">Acesso ao ERP encerrado</h1>
          <p className="text-sm text-muted-foreground">
            {nome ? <><b className="text-foreground">{nome}</b>, o</> : "O"} seu cadastro consta como
            {" "}<b className="text-foreground">{situacao ?? "desligado"}</b> na Senior, por isso este login não acessa mais o ERP.
          </p>
          <p className="text-sm text-muted-foreground">
            Holerite, ponto e o seu histórico continuam disponíveis no <b className="text-foreground">Portal do Colaborador</b>, com o seu CPF.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button disabled={saindo} onClick={() => sair("/colaborador/entrar")} className="gap-2">
            <IdCard className="h-4 w-4" /> Ir para o Portal do Colaborador
          </Button>
          <Button variant="outline" disabled={saindo} onClick={() => sair("/login")} className="gap-2">
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Se você foi readmitido ou acha que é um engano, procure o RH ou o setor de Sistemas.</p>
      </div>
    </div>
  );
}
