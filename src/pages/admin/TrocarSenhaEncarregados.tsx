// =====================================================================
// Configurações do ERP › TROCAR SENHA DOS ENCARREGADOS
// (/app/senhas-encarregados, 20/10/2026, mig 20261020000100).
//
// Pedido do Pablo: o escritório (outros setores) redefine a senha dos
// encarregados sem ganhar a Administração inteira. Quem tem a permissão
// "PODE TROCAR A SENHA" (app_menu trocar_senha_encarregados) e não tem a
// Administração cai aqui ao clicar em "Configurações do ERP" (Sidebar) — e vê
// APENAS isto: escolher o usuário (só os do setor Encarregados, pela
// Administração › Setores) e o mesmo card de reset da Administração.
//
// A lista vem de senha_encarregados_listar(); quem decide se pode resetar é
// a Edge admin-reset-password (senha_pode_resetar) — esconder alguém aqui
// não é a barreira.
// =====================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ResetSenhaSection } from "@/components/admin/UsuariosReal";

interface Encarregado { user_id: string; nome: string; email: string | null }

export default function TrocarSenhaEncarregados() {
  const [userId, setUserId] = useState<string>("");

  const { data: usuarios = [], isLoading, error } = useQuery({
    queryKey: ["senha-encarregados"],
    staleTime: 60_000,
    queryFn: async (): Promise<Encarregado[]> => {
      const { data, error } = await (supabase as unknown as {
        rpc: (f: string) => Promise<{ data: Encarregado[] | null; error: { message: string } | null }>;
      }).rpc("senha_encarregados_listar");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const escolhido = usuarios.find((u) => u.user_id === userId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações do ERP"
        breadcrumb={["Configurações do ERP", "Trocar senha"]}
        subtitle="Redefinir a senha dos usuários do setor Encarregados."
      />

      <Card className="max-w-2xl space-y-5 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold">Trocar senha de encarregado</p>
            <p className="text-xs text-muted-foreground">
              Escolha o encarregado e gere uma senha temporária. No próximo login ele é obrigado a criar uma senha nova.
              Aparecem só os usuários do setor <b>Encarregados</b>.
            </p>
          </div>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4 shrink-0" /> {(error as Error).message}
          </p>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando encarregados…</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Selecionar usuário</p>
            <SearchableSelect
              value={userId}
              onChange={setUserId}
              options={usuarios.map((u) => ({ value: u.user_id, label: u.nome, hint: u.email ?? undefined }))}
              placeholder={usuarios.length ? `Escolha entre ${usuarios.length} encarregado(s)…` : "Nenhum usuário no setor Encarregados"}
              searchPlaceholder="Buscar por nome ou e-mail…"
              emptyLabel="Nenhum encarregado com esse nome"
              disabled={!usuarios.length}
            />
          </div>
        )}

        {escolhido && (
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            {/* key: trocar de usuário zera o card (senha gerada, confirmação). */}
            <ResetSenhaSection key={escolhido.user_id} userId={escolhido.user_id} email={escolhido.email ?? escolhido.nome} />
          </div>
        )}
      </Card>
    </div>
  );
}
