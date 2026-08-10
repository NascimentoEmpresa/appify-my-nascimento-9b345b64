import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Mail, Smartphone, Save, User as UserIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { VinculoDiscordCard } from "@/components/perfil/VinculoDiscordCard";
import { toast } from "sonner";

type Prefs = { sininho_ativo: boolean; email_ativo: boolean; push_ativo: boolean };

const DEFAULTS: Prefs = { sininho_ativo: true, email_ativo: true, push_ativo: false };

export default function MeuPerfil() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  const perfilQ = useQuery({
    queryKey: ["meu-perfil", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name,email")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const prefsQ = useQuery({
    queryKey: ["sup_aprov_notif_pref", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("sup_aprov_notif_pref")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (prefsQ.data) {
      setPrefs({
        sininho_ativo: prefsQ.data.sininho_ativo,
        email_ativo: prefsQ.data.email_ativo,
        push_ativo: prefsQ.data.push_ativo,
      });
    }
  }, [prefsQ.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sem usuário");
      const { error } = await supabase
        .from("sup_aprov_notif_pref")
        .upsert({ user_id: user.id, ...prefs }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferências de notificação atualizadas");
      qc.invalidateQueries({ queryKey: ["sup_aprov_notif_pref"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meu perfil"
        breadcrumb={["Meu perfil"]}
        subtitle="Dados da conta e preferências de notificação."
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserIcon className="h-4 w-4" /> Conta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Nome</Label>
              <p className="font-medium">{perfilQ.data?.display_name ?? "—"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">E-mail</Label>
              <p className="truncate font-medium">{perfilQ.data?.email ?? user?.email ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <VinculoDiscordCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" /> Notificações
            </CardTitle>
            <CardDescription>
              Defina por onde você quer receber alertas de aprovações pendentes e escalonamentos de alçada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              icon={<Bell className="h-4 w-4" />}
              titulo="Sininho no sistema"
              descricao="Notificações dentro do ERP (ícone superior direito)."
              value={prefs.sininho_ativo}
              onChange={(v) => setPrefs((p) => ({ ...p, sininho_ativo: v }))}
            />
            <ToggleRow
              icon={<Mail className="h-4 w-4" />}
              titulo="E-mail"
              descricao="Receber e-mails de pendências e escalonamentos de SLA."
              value={prefs.email_ativo}
              onChange={(v) => setPrefs((p) => ({ ...p, email_ativo: v }))}
            />
            <ToggleRow
              icon={<Smartphone className="h-4 w-4" />}
              titulo="Push (PWA)"
              descricao="Notificações no celular/desktop quando o app estiver instalado."
              value={prefs.push_ativo}
              onChange={(v) => setPrefs((p) => ({ ...p, push_ativo: v }))}
            />

            <div className="flex justify-end pt-2">
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {salvar.isPending ? "Salvando…" : "Salvar preferências"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  icon, titulo, descricao, value, onChange,
}: {
  icon: React.ReactNode; titulo: string; descricao: string;
  value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
