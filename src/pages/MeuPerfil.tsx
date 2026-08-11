import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Mail, Pencil, Smartphone, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { useMeuDiscord } from "@/hooks/useVinculoDiscord";
import { CartaoPerfil } from "@/components/perfil/CartaoPerfil";
import { VinculoDiscordCard } from "@/components/perfil/VinculoDiscordCard";
import { toast } from "sonner";

type Prefs = { sininho_ativo: boolean; email_ativo: boolean; push_ativo: boolean };

const DEFAULTS: Prefs = { sininho_ativo: true, email_ativo: true, push_ativo: false };

const LIMITE_BIO = 500;

export default function MeuPerfil() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [editandoBio, setEditandoBio] = useState(false);
  const [rascunhoBio, setRascunhoBio] = useState("");

  const perfilQ = useQuery({
    queryKey: ["meu-perfil", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // `*` em vez de listar colunas: a descrição (`bio`) é recente e, se o
      // banco ainda não tiver recebido a migration, nomear a coluna derrubaria
      // a consulta inteira e a ficha apareceria vazia. Assim o que existe vem.
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      return data as Record<string, any> | null;
    },
  });

  const { empregado } = useVinculoEmpregado();
  const discordQ = useMeuDiscord();

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

  const salvarBio = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sem usuário");
      const texto = rascunhoBio.trim();
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ bio: texto || null })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditandoBio(false);
      toast.success("Descrição atualizada.");
      qc.invalidateQueries({ queryKey: ["meu-perfil"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar a descrição."),
  });

  const perfil = perfilQ.data;
  const bioAtual: string = perfil?.bio ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meu perfil"
        breadcrumb={["Meu perfil"]}
        subtitle="Seus dados no ERP, o cadastro da Senior e as preferências de notificação."
      />

      <CartaoPerfil
        conta={{
          nome: perfil?.display_name ?? null,
          email: perfil?.email ?? user?.email ?? null,
          avatarUrl: perfil?.avatar_url ?? null,
          cargo: perfil?.cargo ?? null,
          telefone: perfil?.telefone ?? null,
          bio: bioAtual || null,
        }}
        empregado={empregado}
        discord={discordQ.data}
        acoes={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { setRascunhoBio(bioAtual); setEditandoBio(true); }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {bioAtual ? "Editar descrição" : "Adicionar descrição"}
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
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

      <Dialog open={editandoBio} onOpenChange={setEditandoBio}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descrição do perfil</DialogTitle>
            <DialogDescription>
              Opcional. Serve para dizer o que o cadastro não diz — no que você está
              trabalhando, como prefere ser chamado, em que horário costuma responder.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Textarea
              rows={5}
              maxLength={LIMITE_BIO}
              value={rascunhoBio}
              onChange={(e) => setRascunhoBio(e.target.value)}
              placeholder="Ex.: Cuido dos contratos da regional sul. Respondo melhor pela manhã."
            />
            <p className="text-right text-xs text-muted-foreground">
              {rascunhoBio.length}/{LIMITE_BIO}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditandoBio(false)}>Cancelar</Button>
            <Button onClick={() => salvarBio.mutate()} disabled={salvarBio.isPending}>
              {salvarBio.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
