import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaixaEmail } from "@/components/email/CaixaEmail";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  CAIXA_PESSOAL, useRemetentes, useSalvarRemetente, type RemetenteEmail,
} from "@/hooks/useCaixaEmail";
import { CAIXAS_EMAIL_LIBERADAS, emailValido } from "@/lib/email/caixa";
import { EmailEmBreve } from "./MeuEmail";

/**
 * Módulo E-mail › Remetentes e histórico geral (/app/email/remetentes).
 *
 * REMETENTES: o endereço de onde cada pessoa envia. Sem linha aqui, a Edge
 * usa o e-mail do login SE for @haggltda.com.br (secret EMAIL_DOMINIOS troca); com
 * linha ativa, vale a linha. Desativar corta o envio daquela pessoa sem
 * mexer na permissão da tela. Um endereço ativo é de uma pessoa só (índice
 * único no banco) — dois usuários no mesmo "De" e o histórico deixa de dizer
 * quem mandou.
 *
 * HISTÓRICO GERAL: tudo o que saiu pelo módulo, de todos (rascunho alheio
 * nunca aparece — RLS). Só leitura.
 *
 * Gate: `email_admin` — visualizar (ver as duas abas), alterar (editar remetente).
 */

const sb = supabase as any;

interface Perfil { id: string; display_name: string | null; email: string | null }

function usePerfis(ativo: boolean) {
  return useQuery({
    queryKey: ["email_msg", "perfis"],
    enabled: ativo,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("profiles")
        .select("id, display_name, email").eq("ativo", true)
        .order("display_name").order("id").range(0, 4999);
      if (error) throw error;
      return (data ?? []) as Perfil[];
    },
  });
}

export default function RemetentesEmail() {
  const { can } = usePermissoes();
  const podeVer = can("visualizar", "email", "email_admin");
  const podeAlterar = can("alterar", "email", "email_admin");

  const perfis = usePerfis(podeVer && CAIXAS_EMAIL_LIBERADAS);
  const remetentes = useRemetentes(podeVer && CAIXAS_EMAIL_LIBERADAS);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<{ perfil: Perfil; atual: RemetenteEmail | null } | null>(null);

  const porUsuario = useMemo(() => new Map((remetentes.data ?? []).map((r) => [r.user_id, r])), [remetentes.data]);

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const todas = (perfis.data ?? []).map((p) => ({ p, r: porUsuario.get(p.id) ?? null }));
    if (!t) return todas;
    return todas.filter(({ p, r }) =>
      [p.display_name, p.email, r?.email, r?.nome_exibicao].filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [perfis.data, porUsuario, busca]);

  if (!CAIXAS_EMAIL_LIBERADAS) return <EmailEmBreve />;

  if (!podeVer) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <p className="font-medium">Sem acesso</p>
        <p className="text-sm text-muted-foreground">Esta tela pede a ação 'visualizar' em E-mail — Remetentes e histórico geral.</p>
      </div>
    );
  }

  const configurados = (remetentes.data ?? []).filter((r) => r.ativo).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Remetentes e histórico geral"
        subtitle="De qual endereço cada pessoa envia, e tudo o que saiu pelo módulo E-mail."
        module="E-mail"
        breadcrumb={["Remetentes e histórico geral"]}
      />

      <Tabs defaultValue="remetentes">
        <TabsList>
          <TabsTrigger value="remetentes">Remetentes</TabsTrigger>
          <TabsTrigger value="historico">Histórico geral</TabsTrigger>
        </TabsList>

        <TabsContent value="remetentes" className="space-y-4">
          <Card>
            <CardContent className="space-y-1 p-4 text-sm text-muted-foreground">
              <p><b className="text-foreground">{configurados}</b> pessoa(s) com endereço definido aqui.</p>
              <p>
                Quem não tem linha aqui envia pelo e-mail do próprio login, desde que seja <b className="text-foreground">@haggltda.com.br</b>.
                Defina aqui quem entra no ERP com outro e-mail (pessoal, por exemplo) ou quem deve enviar de outro endereço.
              </p>
            </CardContent>
          </Card>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou e-mail…" className="pl-9" />
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              {perfis.isLoading || remetentes.isLoading ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
              ) : perfis.error || remetentes.error ? (
                <p className="py-12 text-center text-sm text-destructive">{((perfis.error || remetentes.error) as Error).message}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pessoa</TableHead>
                      <TableHead>E-mail do login</TableHead>
                      <TableHead>Envia como</TableHead>
                      <TableHead className="w-24 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map(({ p, r }) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.display_name ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{p.email ?? "—"}</TableCell>
                        <TableCell>
                          {r ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={r.ativo ? "" : "text-muted-foreground line-through"}>
                                {r.nome_exibicao ? `${r.nome_exibicao} <${r.email}>` : r.email}
                              </span>
                              {!r.ativo && <Badge variant="secondary">Desativado</Badge>}
                            </span>
                          ) : (
                            (p.email ?? "").toLowerCase().endsWith("@haggltda.com.br")
                              ? <span className="text-xs text-muted-foreground">{p.email} (o login)</span>
                              : <span className="text-xs text-amber-700 dark:text-amber-300">Não envia — login fora de @haggltda.com.br</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {podeAlterar && (
                            <Button size="icon" variant="ghost" title="Definir endereço" onClick={() => setEditando({ perfil: p, atual: r })}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden p-0">
            <CaixaEmail
              caixa={CAIXA_PESSOAL}
              titulo="Histórico geral"
              subtitulo="Tudo o que saiu pelo módulo"
              sugestoes={[]}
              podeVer
              podeEscrever={false}
              podeExcluir={false}
              mostrarAutor
            />
          </Card>
        </TabsContent>
      </Tabs>

      {editando && <EditarRemetente {...editando} onFechar={() => setEditando(null)} />}
    </div>
  );
}

function EditarRemetente({ perfil, atual, onFechar }: { perfil: Perfil; atual: RemetenteEmail | null; onFechar: () => void }) {
  const [email, setEmail] = useState(atual?.email ?? perfil.email ?? "");
  const [nome, setNome] = useState(atual?.nome_exibicao ?? perfil.display_name ?? "");
  const [ativo, setAtivo] = useState(atual?.ativo ?? true);
  const salvar = useSalvarRemetente();

  const confirmar = async () => {
    const e = email.trim().toLowerCase();
    if (!emailValido(e)) { toast.error("Informe um e-mail válido."); return; }
    try {
      await salvar.mutateAsync({ user_id: perfil.id, email: e, nome_exibicao: nome, ativo });
      toast.success("Remetente salvo.");
      onFechar();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar.");
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Endereço de envio — {perfil.display_name ?? perfil.email}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label>E-mail de envio</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" />
            <p className="mt-1 text-xs text-muted-foreground">A caixa real da pessoa — é para lá que as respostas vão.</p>
          </div>
          <div>
            <Label>Nome que aparece no "De"</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value.slice(0, 80))} placeholder="Fulano de Tal" />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={ativo} onCheckedChange={setAtivo} />
            {ativo ? "Ativo — pode enviar por este endereço" : "Desativado — não envia pelo módulo"}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
