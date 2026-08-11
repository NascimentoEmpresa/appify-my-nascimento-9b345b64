import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CartaoPerfil } from "@/components/perfil/CartaoPerfil";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { maskFone } from "@/lib/telefone";
import { Search, Pencil, ShieldCheck, Building2, UserPlus, Eye, EyeOff, KeyRound, Copy, AlertTriangle, Upload, Trash2, Link2, Link2Off, Loader2, IdCard } from "lucide-react";

// Situações de desligamento (mesma regra das RPCs de vínculo): nunca vincula
// nem aparece na busca.

// Cadastro EMPREGADOS ligado a um login (colunas leves p/ a lista).
interface EmpregadoVinc {
  auth_user_id: string;
  ID: number;
  Nome: string | null;
  "Situação": string | null;
  "Título do Cargo": string | null;
  Setor_ERP: string | null;
}

// Setor é só um rótulo descritivo (departamento da pessoa) — não define
// nenhuma permissão. Catálogo vem de setor_catalogo (criar/renomear/excluir
// setor é feito em Administração → Setores, não aqui).
function useSetoresDisponiveis() {
  const q = useQuery({
    queryKey: ["setores_catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setor_catalogo")
        .select("nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });
  return q.data ?? [];
}

const LINK_ACESSO = `${window.location.origin}/login`;

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  empresa_id: string | null;
  avatar_url: string | null;
  telefone: string | null;
  cargo: string | null;
}

export function UsuariosReal() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeEditar = can("alterar", undefined, "administracao");
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const setoresCatalogo = useSetoresDisponiveis();

  const profilesQ = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,display_name,empresa_id,avatar_url,telefone,cargo")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const empresasQ = useQuery({
    queryKey: ["empresas-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id,codigo,razao_social,nome_fantasia").order("razao_social");
      if (error) throw error;
      return data ?? [];
    },
  });

  const setoresQ = useQuery({
    queryKey: ["all-user-setores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_setor").select("user_id,setor");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Colaboradores (EMPREGADOS) já vinculados a um login — p/ mostrar o nome
  // oficial da Senior e habilitar Detalhes/Vincular por linha.
  const vinculadosQ = useQuery({
    queryKey: ["admin-empregados-vinculados"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("EMPREGADOS")
        .select('auth_user_id,"ID","Nome","Situação","Título do Cargo","Setor_ERP"')
        .not("auth_user_id", "is", null);
      if (error) throw error;
      return (data ?? []) as EmpregadoVinc[];
    },
  });

  const vincByUser = useMemo(() => {
    const m = new Map<string, EmpregadoVinc>();
    (vinculadosQ.data ?? []).forEach((e) => { if (e.auth_user_id) m.set(e.auth_user_id, e); });
    return m;
  }, [vinculadosQ.data]);

  const invalidarVinculo = () => {
    qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    qc.invalidateQueries({ queryKey: ["admin-empregados-vinculados"] });
  };

  const setoresByUser = useMemo(() => {
    const m = new Map<string, string[]>();
    (setoresQ.data ?? []).forEach((r: any) => {
      const arr = m.get(r.user_id) ?? [];
      arr.push(r.setor as string);
      m.set(r.user_id, arr);
    });
    return m;
  }, [setoresQ.data]);

  const empresasById = useMemo(() => {
    const m = new Map<string, { codigo: string; razao_social: string }>();
    (empresasQ.data ?? []).forEach((e: any) => m.set(e.id, e));
    return m;
  }, [empresasQ.data]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return profilesQ.data ?? [];
    return (profilesQ.data ?? []).filter((p) =>
      (p.display_name ?? "").toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q)
    );
  }, [profilesQ.data, busca]);

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Gestão de usuários</h2>
          <p className="text-xs text-muted-foreground">
            {(profilesQ.data ?? []).length} usuário(s) · {(empresasQ.data ?? []).length} empresa(s)
          </p>
        </div>
        {podeEditar && (
          <NovoUsuarioDialog
            empresas={empresasQ.data ?? []}
            setoresCatalogo={setoresCatalogo}
            onCreated={() => {
              qc.invalidateQueries({ queryKey: ["admin-profiles"] });
              qc.invalidateQueries({ queryKey: ["all-user-setores"] });
              qc.invalidateQueries({ queryKey: ["setores_catalogo"] });
            }}
          />
        )}
      </header>

      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Usuário</th>
            <th className="px-3 py-3 text-left">Setor</th>
            <th className="px-3 py-3 text-left">Empresa</th>
            <th className="px-5 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {profilesQ.isLoading && (
            <tr><td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">Carregando…</td></tr>
          )}
          {!profilesQ.isLoading && filtrados.length === 0 && (
            <tr><td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">Nenhum usuário.</td></tr>
          )}
          {filtrados.map((u) => {
            const userSetores = setoresByUser.get(u.id) ?? [];
            const emp = u.empresa_id ? empresasById.get(u.empresa_id) : null;
            const ehVoce = u.id === user?.id;
            const vinc = vincByUser.get(u.id);
            // Nome oficial da Senior tem prioridade sobre o display_name digitado.
            const nomeExibicao = (vinc?.Nome?.trim()) || u.display_name || "—";
            return (
              <tr key={u.id} className="hover:bg-muted/40">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-primary text-xs font-semibold text-primary-foreground">
                        {(nomeExibicao ?? u.email ?? "?").split(" ").map((s) => s[0]).slice(0,2).join("").toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {nomeExibicao} {ehVoce && <Badge variant="outline" className="ml-1 text-[10px]">você</Badge>}
                        {vinc && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-success align-middle"><Link2 className="h-3 w-3" /> vinculado</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{u.email}</p>
                      {u.cargo && <p className="text-[11px] text-muted-foreground">{u.cargo}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {userSetores.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    {userSetores.map((s) => (
                      <Badge key={s} variant="secondary" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs">
                  {emp ? (
                    <span className="inline-flex items-center gap-1.5"><Building2 className="h-3 w-3 text-muted-foreground" />{emp.codigo} — {emp.razao_social}</span>
                  ) : <span className="text-muted-foreground">— sem vínculo —</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  {(() => {
                    // Compõe por capacidade: Detalhes/Vincular delegáveis; Editar só admin.
                    const acoes = [
                      // A ficha vale para todo mundo: sem cadastro da Senior
                      // ela ainda mostra conta, foto e Discord. Antes só quem
                      // era vinculado tinha "Detalhes", e o resto ficava opaco.
                      podeEditar && (
                        <ColaboradorDetalheDialog key="det" empregadoId={vinc?.ID ?? null} userId={u.id} podeDesvincular={podeEditar && !!vinc} onChanged={invalidarVinculo} />
                      ),
                      podeEditar && !vinc && (
                        <VincularColaboradorDialog key="vin" userId={u.id} nomeUsuario={u.display_name ?? u.email ?? ""} onLinked={invalidarVinculo} />
                      ),
                      podeEditar && (
                        <EditarUsuarioDialog
                          key="edit"
                          profile={u}
                          empresas={empresasQ.data ?? []}
                          currentSetores={userSetores}
                          setoresCatalogo={setoresCatalogo}
                          onSaved={() => {
                            qc.invalidateQueries({ queryKey: ["admin-profiles"] });
                            qc.invalidateQueries({ queryKey: ["all-user-setores"] });
                            qc.invalidateQueries({ queryKey: ["setores_catalogo"] });
                          }}
                        />
                      ),
                    ].filter(Boolean);
                    return acoes.length
                      ? <div className="flex items-center justify-end gap-1">{acoes}</div>
                      : <span className="text-[11px] text-muted-foreground">—</span>;
                  })()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function EditarUsuarioDialog({
  profile, empresas, currentSetores, setoresCatalogo, onSaved,
}: {
  profile: ProfileRow;
  empresas: { id: string; codigo: string; razao_social: string }[];
  currentSetores: string[];
  setoresCatalogo: string[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [cargo, setCargo] = useState(profile.cargo ?? "");
  const [telefone, setTelefone] = useState(maskFone(profile.telefone ?? ""));
  const [empresaId, setEmpresaId] = useState<string>(profile.empresa_id ?? "_none");
  const [selectedSetores, setSelectedSetores] = useState<string[]>(currentSetores);
  const [acessaTodas, setAcessaTodas] = useState<boolean>(false);
  const [empresasAtua, setEmpresasAtua] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deletando, setDeletando] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const catalogoExibido = useMemo(() => {
    const set = new Set([...setoresCatalogo, ...selectedSetores]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [setoresCatalogo, selectedSetores]);

  // Carrega flag acessa_todas_empresas e vínculos user_empresa quando o dialog abre.
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("acessa_todas_empresas")
        .eq("id", profile.id)
        .maybeSingle();
      const { data: vinc } = await supabase
        .from("user_empresa")
        .select("empresa_id")
        .eq("user_id", profile.id);
      if (cancel) return;
      setAcessaTodas(!!(prof as any)?.acessa_todas_empresas);
      setEmpresasAtua(new Set((vinc ?? []).map((v: any) => v.empresa_id)));
    })();
    return () => { cancel = true; };
  }, [open, profile.id]);

  // Re-sincroniza com currentSetores quando o cache atualiza após abrir o dialog.
  useEffect(() => {
    setSelectedSetores(currentSetores);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSetores.join("|")]);

  const toggleSetor = (s: string) => {
    setSelectedSetores((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const toggleEmpresaAtua = (id: string) => {
    setEmpresasAtua((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const salvar = async () => {
    setSaving(true);
    try {
      // 1) profile (inclui flag acessa_todas_empresas)
      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          display_name: displayName || null,
          cargo: cargo.trim() || null,
          empresa_id: empresaId === "_none" ? null : empresaId,
          acessa_todas_empresas: acessaTodas,
          telefone: telefone.replace(/\D/g, "") ? `55${telefone.replace(/\D/g, "")}` : null,
        } as any)
        .eq("id", profile.id);
      if (pErr) throw pErr;

      // 2) setor — diff (rótulo puramente descritivo, sem efeito em permissão)
      const toAdd = selectedSetores.filter((s) => !currentSetores.includes(s));
      const toRemove = currentSetores.filter((s) => !selectedSetores.includes(s));

      if (toRemove.length > 0) {
        const { error: dErr } = await supabase
          .from("user_setor").delete()
          .eq("user_id", profile.id).in("setor", toRemove);
        if (dErr) throw dErr;
      }
      if (toAdd.length > 0) {
        const { error: iErr } = await supabase
          .from("user_setor")
          .insert(toAdd.map((s) => ({ user_id: profile.id, setor: s })));
        if (iErr) throw iErr;
      }

      // 3) user_empresa — só quando acessa_todas = false (caso contrário a flag basta)
      if (!acessaTodas) {
        const { data: atuais } = await supabase
          .from("user_empresa").select("empresa_id").eq("user_id", profile.id);
        const set = new Set((atuais ?? []).map((v: any) => v.empresa_id));
        const adicionar = [...empresasAtua].filter((id) => !set.has(id));
        const remover = [...set].filter((id) => !empresasAtua.has(id));
        if (adicionar.length > 0) {
          const { error } = await supabase.from("user_empresa")
            .insert(adicionar.map((eid) => ({ user_id: profile.id, empresa_id: eid, created_by: profile.id })));
          if (error) throw error;
        }
        if (remover.length > 0) {
          const { error } = await supabase.from("user_empresa")
            .delete().eq("user_id", profile.id).in("empresa_id", remover);
          if (error) throw error;
        }
      }

      toast({ title: "Usuário atualizado" });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deletar = async () => {
  setDeletando(true);
  try {
    const { data, error } = await supabase.functions.invoke("admin-delete-user", {
      body: { user_id: profile.id },
    });
    if (error) {
      const ctx = (error as any).context;
      let msg = error.message;
      try {
        if (ctx && typeof ctx.json === "function") {
          const j = await ctx.json();
          if (j?.error) msg = j.error;
        }
      } catch { /* */ }
      throw new Error(msg);
    }
    if ((data as any)?.error) throw new Error((data as any).error);
    toast({ title: "Usuário excluído" });
    setOpen(false);
    onSaved();
  } catch (e: any) {
    toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" });
  } finally {
    setDeletando(false);
    setConfirmDelete(false);
  }
};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5"><Pencil className="h-3.5 w-3.5" />Editar</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{profile.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <AvatarUploadSection profile={profile} />

          <div>
            <Label>Nome de exibição</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ex.: Messias Souza" />
          </div>
          <div>
            <Label>Cargo</Label>
            <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex.: Analista Financeiro II" />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={telefone} onChange={(e) => setTelefone(maskFone(e.target.value))} placeholder="(51) 99659-4681" />
          </div>
          <div>
            <Label>Empresa padrão (de cadastro)</Label>
            <Select value={empresaId} onValueChange={setEmpresaId}>
              <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Sem vínculo —</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Acesso multi-empresa */}
          <div className="rounded-lg border border-primary/40 bg-primary-soft/30 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox className="mt-0.5" checked={acessaTodas} onCheckedChange={(v) => setAcessaTodas(!!v)} />
              <span className="flex flex-col">
                <span className="text-sm font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Acessa todas as empresas do grupo
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Recomendado para equipe administrativa (presidência, controladoria, financeiro, fiscal). Permite trocar livremente entre as empresas no seletor da topbar.
                </span>
              </span>
            </label>

            {!acessaTodas && (
              <div className="pt-2 border-t border-border/60">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Empresas em que atua</Label>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Marque cada empresa que este usuário pode operar. Ele só verá e poderá lançar dados nas marcadas.
                </p>
                <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                  {empresas.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
                      <Checkbox checked={empresasAtua.has(e.id)} onCheckedChange={() => toggleEmpresaAtua(e.id)} />
                      <span className="font-medium">{e.codigo}</span>
                      <span className="text-muted-foreground truncate">— {e.razao_social}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Setor</Label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Só um rótulo informativo (departamento da pessoa) — não concede nenhum acesso. Pra criar, renomear ou excluir um setor, use Administração → Setores.
            </p>
            {catalogoExibido.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum setor cadastrado ainda — crie um em Administração → Setores.</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {catalogoExibido.map((s) => (
                  <label key={s} className="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
                    <Checkbox className="mt-0.5" checked={selectedSetores.includes(s)} onCheckedChange={() => toggleSetor(s)} />
                    <span className="font-medium">{s}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <AlterarEmailSection userId={profile.id} emailAtual={profile.email ?? ""} />
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <ResetSenhaSection userId={profile.id} email={profile.email ?? ""} />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {!confirmDelete ? (
            <Button
              variant="ghost"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deletando}
            >
              <Trash2 className="h-4 w-4" /> Excluir usuário
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Confirma exclusão?
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deletando}>
                Não
              </Button>
              <Button size="sm" variant="destructive" onClick={deletar} disabled={deletando}>
                {deletando ? "Excluindo…" : "Sim, excluir"}
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving || deletando}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving || deletando}>{saving ? "Salvando…" : "Salvar"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

}

function AlterarEmailSection({ userId, emailAtual }: { userId: string; emailAtual: string }) {
  const qc = useQueryClient();
  const [novoEmail, setNovoEmail] = useState(emailAtual);
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setNovoEmail(emailAtual); }, [emailAtual]);

  const mudou = novoEmail.trim().toLowerCase() !== emailAtual.trim().toLowerCase();

  const salvar = async () => {
    setSalvando(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-update-email", {
        body: { user_id: userId, new_email: novoEmail.trim() },
      });
      if (error) {
        const ctx = (error as any).context;
        let msg = error.message;
        try { if (ctx && typeof ctx.json === "function") { const j = await ctx.json(); if (j?.error) msg = j.error; } } catch { /* */ }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "E-mail atualizado", description: "O usuário deve usar o novo e-mail para fazer login." });
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
      setConfirmando(false);
    } catch (e: any) {
      toast({
        title: /already|registered|exists|duplic/i.test(e?.message ?? "") ? "E-mail já usado por outro usuário" : "Erro ao atualizar e-mail",
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold">E-mail de login</p>
      <p className="text-[11px] text-muted-foreground">
        É o e-mail usado pra entrar no sistema. Alterar aqui muda o login imediatamente — avise o usuário.
      </p>
      <Input
        type="email"
        value={novoEmail}
        onChange={(e) => { setNovoEmail(e.target.value); setConfirmando(false); }}
        placeholder="novo@empresa.com.br"
      />
      {mudou && !confirmando && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setConfirmando(true)} disabled={salvando}>
            Salvar novo e-mail
          </Button>
        </div>
      )}
      {mudou && confirmando && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />
            Confirma trocar o login de <strong>{emailAtual}</strong> para <strong>{novoEmail.trim()}</strong>?
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)} disabled={salvando}>Cancelar</Button>
            <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Confirmar troca"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResetSenhaSection({ userId, email }: { userId: string; email: string }) {
  const [loading, setLoading] = useState(false);
  const [novaSenha, setNovaSenha] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const reset = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { user_id: userId },
      });
      if (error) {
        const ctx = (error as any).context;
        let msg = error.message;
        try { if (ctx && typeof ctx.json === "function") { const j = await ctx.json(); if (j?.error) msg = j.error; } } catch { /* */ }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      setNovaSenha((data as any)?.password ?? null);
      setConfirmando(false);
      toast({ title: "Senha resetada", description: "Nova senha gerada. Compartilhe com o usuário." });
    } catch (e: any) {
      toast({ title: "Erro ao resetar senha", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copiar = async (texto: string, msg: string) => {
    try { await navigator.clipboard.writeText(texto); toast({ title: msg }); } catch { /* */ }
  };

  const textoCompleto = novaSenha
    ? [
        "Acesso ao ERP Gestão Nascimento",
        `Link de acesso: ${LINK_ACESSO}`,
        `Login (e-mail): ${email}`,
        `Senha temporária: ${novaSenha}`,
        "",
        "Importante: no primeiro login o sistema solicitará a criação de uma nova senha pessoal.",
      ].join("\n")
    : "";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold"><KeyRound className="h-3.5 w-3.5" /> Resetar senha do usuário</p>
          <p className="text-[11px] text-muted-foreground">Gera uma nova senha temporária. O usuário será obrigado a criar uma nova senha no próximo login.</p>
        </div>
        {!confirmando && !novaSenha && (
          <Button size="sm" variant="outline" onClick={() => setConfirmando(true)} disabled={loading}>Resetar</Button>
        )}
      </div>

      {confirmando && !novaSenha && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" /> Confirma resetar a senha de <strong>{email}</strong>? A senha atual deixará de funcionar.</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button size="sm" onClick={reset} disabled={loading}>{loading ? "Resetando…" : "Confirmar reset"}</Button>
          </div>
        </div>
      )}

      {novaSenha && (
        <div className="rounded-md border border-success/40 bg-success-soft p-3 text-xs space-y-2">
          <p className="font-semibold text-foreground">Nova senha temporária</p>

          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Link de acesso</Label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 select-all rounded bg-background px-2 py-1.5 font-mono text-xs break-all">{LINK_ACESSO}</code>
              <Button size="sm" variant="outline" onClick={() => copiar(LINK_ACESSO, "Link copiado")} className="gap-1.5"><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Senha</Label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 select-all rounded bg-background px-2 py-1.5 font-mono text-sm">{novaSenha}</code>
              <Button size="sm" variant="outline" onClick={() => copiar(novaSenha, "Senha copiada")} className="gap-1.5"><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          </div>

          <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => copiar(textoCompleto, "Credenciais copiadas")}>
            <Copy className="h-3.5 w-3.5" /> Copiar tudo (link + e-mail + senha)
          </Button>

          <p className="leading-relaxed text-muted-foreground">
            <strong>Guarde estas informações em local seguro</strong> e repasse ao usuário por canal confiável.
            Esta senha <strong>não será exibida novamente</strong>. No próximo login, o ERP exigirá a definição de uma nova senha pessoal.
          </p>
        </div>
      )}
    </div>
  );
}

function NovoUsuarioDialog({
  empresas, setoresCatalogo, onCreated,
}: {
  empresas: { id: string; codigo: string; razao_social: string }[];
  setoresCatalogo: string[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [cargo, setCargo] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [empresaId, setEmpresaId] = useState<string>("_none");
  const [selectedSetores, setSelectedSetores] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const catalogoExibido = useMemo(() => {
    const set = new Set([...setoresCatalogo, ...selectedSetores]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [setoresCatalogo, selectedSetores]);

  // Credenciais geradas após criação (mostrado em modal flutuante)
  const [credenciaisCriadas, setCredenciaisCriadas] = useState<{
    email: string; password: string; display_name: string | null;
  } | null>(null);

  const reset = () => {
    setDisplayName(""); setCargo(""); setEmail(""); setPassword(""); setTelefone("");
    setEmpresaId("_none"); setSelectedSetores([]); setShowPwd(false);
  };

  const toggleSetor = (s: string) => {
    setSelectedSetores((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const gerarSenha = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setPassword(s);
    setShowPwd(true);
  };

  const criar = async () => {
    if (!email.trim()) {
      toast({ title: "E-mail obrigatório", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Senha deve ter ao menos 6 caracteres", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: email.trim(),
          password,
          display_name: displayName.trim() || null,
          cargo: cargo.trim() || null,
          empresa_id: empresaId === "_none" ? null : empresaId,
          telefone: telefone.trim() || null,
        },
      });
      if (error) {
        const ctx = (error as any).context;
        let msg = error.message;
        try {
          if (ctx && typeof ctx.json === "function") {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);

      // Setor é só rótulo — gravado à parte, depois que o usuário já existe
      // (user_setor referencia auth.users, não dá pra gravar antes de criar).
      const newUserId = (data as any)?.user_id as string | undefined;
      if (newUserId && selectedSetores.length > 0) {
        const { error: setorErr } = await supabase
          .from("user_setor")
          .insert(selectedSetores.map((s) => ({ user_id: newUserId, setor: s })));
        if (setorErr) {
          toast({ title: "Usuário criado, mas houve erro ao gravar o setor", description: setorErr.message, variant: "destructive" });
        }
      }

      // Mostra modal de credenciais e fecha o de criação
      setCredenciaisCriadas({
        email: email.trim(),
        password,
        display_name: displayName.trim() || null,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (e: any) {
      const m = e?.message ?? "Falha ao criar usuário";
      toast({
        title: /already|registered|exists|duplic/i.test(m) ? "E-mail já cadastrado" : "Erro ao criar usuário",
        description: m,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Novo usuário
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>
              Cria o acesso e vincula setor e empresa. Apenas administradores.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome completo</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ex.: Messias Souza" />
            </div>
            <div>
              <Label>Cargo</Label>
              <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex.: Analista Financeiro II" />
            </div>
            <div>
              <Label>E-mail corporativo *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" />
            </div>
            <div>
              <Label>Senha temporária *</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" onClick={gerarSenha}>Gerar</Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                O usuário será obrigado a definir uma nova senha pessoal no primeiro login.
              </p>
            </div>
            <div>
              <Label>Empresa vinculada</Label>
              <Select value={empresaId} onValueChange={setEmpresaId}>
                <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Sem vínculo —</SelectItem>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={telefone} onChange={(e) => setTelefone(maskFone(e.target.value))} placeholder="(51) 99659-4681" />
            </div>
            <div>
              <Label>Setor</Label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Só um rótulo informativo (departamento da pessoa) — não concede nenhum acesso. Pra criar, renomear ou excluir um setor, use Administração → Setores.
              </p>
              {catalogoExibido.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum setor cadastrado ainda — crie um em Administração → Setores.</p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {catalogoExibido.map((s) => (
                    <label key={s} className="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
                      <Checkbox className="mt-0.5" checked={selectedSetores.includes(s)} onCheckedChange={() => toggleSetor(s)} />
                      <span className="font-medium">{s}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={criar} disabled={saving}>
              {saving ? "Criando…" : "Criar usuário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CredenciaisDialog
        creds={credenciaisCriadas}
        onClose={() => setCredenciaisCriadas(null)}
      />
    </>
  );
}

function CredenciaisDialog({
  creds, onClose,
}: {
  creds: { email: string; password: string; display_name: string | null } | null;
  onClose: () => void;
}) {
  const textoCompleto = creds
    ? [
        "Acesso ao ERP Gestão Nascimento",
        creds.display_name ? `Nome: ${creds.display_name}` : null,
        `Link de acesso: ${LINK_ACESSO}`,
        `Login (e-mail): ${creds.email}`,
        `Senha temporária: ${creds.password}`,
        "",
        "Importante: no primeiro login o sistema solicitará a criação de uma nova senha pessoal.",
      ].filter(Boolean).join("\n")
    : "";

  const copiar = async (texto: string, msg: string) => {
    try { await navigator.clipboard.writeText(texto); toast({ title: msg }); } catch { /* */ }
  };

  return (
    <Dialog open={!!creds} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-success" /> Usuário criado com sucesso
          </DialogTitle>
          <DialogDescription>
            Estas credenciais <strong>não serão exibidas novamente</strong>. Copie e repasse ao usuário por canal seguro.
          </DialogDescription>
        </DialogHeader>

        {creds && (
          <div className="space-y-3">
            {creds.display_name && (
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground">Nome</Label>
                <p className="text-sm font-medium">{creds.display_name}</p>
              </div>
            )}
            <div>
              <Label className="text-[11px] uppercase text-muted-foreground">Link de acesso</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">{LINK_ACESSO}</code>
                <Button size="sm" variant="outline" onClick={() => copiar(LINK_ACESSO, "Link copiado")} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-[11px] uppercase text-muted-foreground">Login (e-mail)</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 font-mono text-sm">{creds.email}</code>
                <Button size="sm" variant="outline" onClick={() => copiar(creds.email, "E-mail copiado")} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-[11px] uppercase text-muted-foreground">Senha temporária</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 font-mono text-sm">{creds.password}</code>
                <Button size="sm" variant="outline" onClick={() => copiar(creds.password, "Senha copiada")} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  <strong>Guarde estas informações em um gerenciador de senhas</strong> antes de fechar.
                  Ao acessar com a senha temporária, o ERP exigirá a definição de uma nova senha pessoal.
                </span>
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => copiar(textoCompleto, "Credenciais copiadas para a área de transferência")}
          >
            <Copy className="h-4 w-4" /> Copiar tudo
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AvatarUploadSection({ profile }: { profile: ProfileRow }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const inputId = `avatar-input-${profile.id}`;

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Selecione uma imagem.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagem muito grande", description: "Tamanho máximo 5 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${profile.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: updErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile.id);
      if (updErr) throw updErr;
      toast({ title: "Foto atualizada" });
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const remover = async () => {
    setUploading(true);
    try {
      const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", profile.id);
      if (error) throw error;
      toast({ title: "Foto removida" });
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const iniciais = (profile.display_name ?? profile.email ?? "?")
    .split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/20 p-3">
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-border" />
      ) : (
        <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-primary text-base font-semibold text-primary-foreground ring-2 ring-border">
          {iniciais}
        </div>
      )}
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold">Foto do perfil</p>
        <p className="text-[11px] text-muted-foreground">PNG ou JPG, até 5 MB.</p>
        <div className="mt-1 flex gap-2">
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => document.getElementById(inputId)?.click()}
            disabled={uploading}
          >
            <Upload className="h-3.5 w-3.5" /> {uploading ? "Enviando…" : "Carregar foto"}
          </Button>
          {profile.avatar_url && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" onClick={remover} disabled={uploading}>
              <Trash2 className="h-3.5 w-3.5" /> Remover
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Ficha do usuário (conta + cadastro da Senior + Discord) ───────────────

/**
 * As colunas da Senior que a ficha mostra — as mesmas doze do `CartaoPerfil`,
 * mais "Nascimento". Espelha o recorte do useVinculoEmpregado: as duas telas
 * montam o mesmo cartão e não faz sentido pedirem coisas diferentes.
 */
const COLS_FICHA_EMPREGADO =
  '"ID","Nome","CPF","Título do Cargo","Setor_ERP","Perfil_ERP","LIDER","Situação","Admissão","Nascimento","Nome da Empresa","Nome Filial","email"';

function ColaboradorDetalheDialog({ empregadoId, userId, podeDesvincular, onChanged }: { empregadoId: number | null; userId: string; podeDesvincular: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [emp, setEmp] = useState<Record<string, any> | null>(null);
  const [perfil, setPerfil] = useState<Record<string, any> | null>(null);
  const [discord, setDiscord] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      // Os três blocos em paralelo: são independentes, e em série a ficha
      // demoraria a soma de três idas ao banco em vez da mais lenta delas.
      // `select("*")` no perfil traz a descrição sem quebrar caso o banco
      // ainda não tenha a coluna — nomear coluna ausente derruba a consulta.
      // Na EMPREGADOS é o contrário: nada é novo ali, e `*` traria as 148
      // colunas da folha — salário e PIS inclusive — pra montar uma ficha de
      // doze campos. A RLS filtra linha, não coluna (ver a migration
      // 20260717190010), então o recorte tem que sair daqui.
      const [rEmp, rPerfil, rDiscord] = await Promise.all([
        empregadoId
          ? (supabase as any)
              .from("EMPREGADOS")
              .select(COLS_FICHA_EMPREGADO)
              .eq("ID", empregadoId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        (supabase as any).from("profiles").select("*").eq("id", userId).maybeSingle(),
        (supabase as any).from("usuario_discord").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (cancel) return;
      setEmp(rEmp?.data ?? null);
      setPerfil(rPerfil?.data ?? null);
      setDiscord(rDiscord?.data ?? null);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [open, empregadoId, userId]);

  const desvincular = async () => {
    setDesvinculando(true);
    try {
      const { data, error } = await (supabase as any).rpc("admin_desvincular_empregado", { p_user_id: userId });
      if (error) throw error;
      if (data && (data as any).ok === false) throw new Error((data as any).error);
      toast({ title: "Vínculo removido" });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      toast({ title: "Erro ao desvincular", description: e?.message, variant: "destructive" });
    } finally {
      setDesvinculando(false);
      setConfirmar(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmar(false); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5"><IdCard className="h-3.5 w-3.5" />Detalhes</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ficha do usuário</DialogTitle>
          <DialogDescription>
            Conta no ERP, cadastro da Senior e vínculo do Discord.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : (
          <CartaoPerfil
            conta={{
              // O nome oficial da Senior manda sobre o display_name digitado —
              // mesma regra da listagem, para a ficha não contradizer a linha.
              nome: (emp?.["Nome"] as string)?.trim() || perfil?.display_name || null,
              email: perfil?.email ?? null,
              avatarUrl: perfil?.avatar_url ?? null,
              cargo: perfil?.cargo ?? null,
              telefone: perfil?.telefone ?? null,
              bio: perfil?.bio ?? null,
            }}
            empregado={emp ? {
              nome: emp["Nome"], cpf: emp["CPF"], cargo: emp["Título do Cargo"],
              setor: emp["Setor_ERP"], perfil: emp["Perfil_ERP"], lider: emp["LIDER"],
              situacao: emp["Situação"], admissao: emp["Admissão"],
              nascimento: emp["Nascimento"], empresa: emp["Nome da Empresa"],
              filial: emp["Nome Filial"], email: emp["email"],
            } : null}
            discord={discord}
          />
        )}
        {!loading && !emp && (
          <p className="text-center text-xs text-muted-foreground">
            Este login ainda não está vinculado a um cadastro da Senior.
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          {podeDesvincular ? (
            !confirmar ? (
              <Button variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmar(true)} disabled={desvinculando}>
                <Link2Off className="h-4 w-4" /> Desvincular
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-destructive">Remover o vínculo?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)} disabled={desvinculando}>Não</Button>
                <Button size="sm" variant="destructive" onClick={desvincular} disabled={desvinculando}>{desvinculando ? "Removendo…" : "Sim"}</Button>
              </div>
            )
          ) : <span />}
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Vincular login a um colaborador (busca no cadastro, sem demitidos) ─────
interface EmpBusca { ID: number; Nome: string | null; CPF: string | null; "Título do Cargo": string | null; Setor_ERP: string | null; "Situação": string | null; auth_user_id: string | null }

function VincularColaboradorDialog({ userId, nomeUsuario, onLinked }: { userId: string; nomeUsuario: string; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<EmpBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [sel, setSel] = useState<EmpBusca | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) { setTermo(""); setResultados([]); setSel(null); return; }
  }, [open]);

  // Busca por nome/CPF via RPC (ignora acento, quebra em palavras, casa CPF por
  // dígitos e já exclui desligados no servidor).
  useEffect(() => {
    const q = termo.trim();
    if (q.length < 2) { setResultados([]); return; }
    let cancel = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("admin_buscar_empregados", { p_termo: q });
      if (cancel) return;
      if (error) { console.error("admin_buscar_empregados", error); setResultados([]); }
      else setResultados((data ?? []) as EmpBusca[]);
      setBuscando(false);
    }, 300);
    return () => { cancel = true; clearTimeout(t); };
  }, [termo]);

  const vincular = async () => {
    if (!sel) return;
    setSalvando(true);
    try {
      const { data, error } = await (supabase as any).rpc("admin_vincular_empregado", { p_user_id: userId, p_empregado_id: sel.ID });
      if (error) throw error;
      if (data && (data as any).ok === false) throw new Error((data as any).error);
      toast({ title: "Colaborador vinculado", description: sel.Nome ?? undefined });
      setOpen(false);
      onLinked();
    } catch (e: any) {
      toast({ title: "Erro ao vincular", description: e?.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5"><Link2 className="h-3.5 w-3.5" />Vincular</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vincular colaborador</DialogTitle>
          <DialogDescription>Ligar <strong>{nomeUsuario}</strong> a um cadastro da Senior. Colaboradores demitidos não aparecem.</DialogDescription>
        </DialogHeader>

        {!sel ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome ou CPF…" className="pl-9" />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {buscando && <p className="px-3 py-3 text-center text-xs text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></p>}
              {!buscando && termo.trim().length >= 2 && resultados.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum colaborador ativo encontrado.</p>
              )}
              {!buscando && termo.trim().length < 2 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">Digite ao menos 2 caracteres.</p>
              )}
              {resultados.map((e) => {
                const jaVinc = !!e.auth_user_id && e.auth_user_id !== userId;
                return (
                  <button key={e.ID} type="button" disabled={jaVinc}
                    onClick={() => setSel(e)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{e.Nome}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{[e["Título do Cargo"], e.Setor_ERP].filter(Boolean).join(" · ")}</span>
                    </span>
                    {jaVinc
                      ? <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">já vinculado</span>
                      : <span className="shrink-0 text-[10px] text-muted-foreground">{e.CPF}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-sm font-semibold">{sel.Nome}</p>
              <p className="text-xs text-muted-foreground">{[sel["Título do Cargo"], sel.Setor_ERP].filter(Boolean).join(" · ")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {sel.CPF && <span className="rounded bg-muted px-2 py-0.5">{sel.CPF}</span>}
                {sel["Situação"] && <span className="rounded bg-success-soft px-2 py-0.5 text-success">{sel["Situação"]}</span>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Ao confirmar, o nome de exibição do usuário passa a ser o nome oficial da Senior.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSel(null)} disabled={salvando}>Voltar</Button>
              <Button onClick={vincular} disabled={salvando} className="gap-1.5">
                {salvando ? <><Loader2 className="h-4 w-4 animate-spin" /> Vinculando…</> : <><Link2 className="h-4 w-4" /> Confirmar vínculo</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

