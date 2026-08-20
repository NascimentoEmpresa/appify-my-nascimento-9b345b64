import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { Plus, Trash2, ChevronDown, ChevronRight, BookOpen, UserCog, X, CheckSquare, Save, Layers, Boxes, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FormCap } from "@/hooks/useFormPerms";

const FORM_MENU_CODIGO = "central_servicos_formularios";
const REUNIOES_MENU_CODIGO = "central_servicos_reunioes";

interface Modulo { id: string; codigo: string; nome: string; ordem: number; ativo: boolean; icone: string | null }
interface Menu { id: string; modulo_id: string; codigo: string; nome: string; rota: string | null; ordem: number; ativo: boolean }
interface ProfileRow { id: string; display_name: string | null; email: string | null }

// Remove acentos antes de virar slug - "Solicitações" → "solicitacoes", não "solicitações".
// Sem isso, o código salvo no banco diverge do que outras partes do sistema esperam
// (ex: comparações de menu_codigo) por causa de caracteres acentuados invisíveis na UI.
const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(text: string): string {
  return text
    .trim()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

type View = "catalogo" | "acesso" | "por_modulo";

interface PerfilAcesso { id: string; nome: string; descricao: string | null; concede_tudo: boolean; ativo: boolean }

export function ModulosMenusTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");
  const [view, setView] = useState<View>("catalogo");
  const [showAddForm, setShowAddForm] = useState(false);

  const modulosQ = useQuery({
    queryKey: ["app_modulo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_modulo").select("*").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as Modulo[];
    },
  });

  const menusQ = useQuery({
    queryKey: ["app_menu"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_menu").select("*").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as Menu[];
    },
  });

  return (
    <section className="card-elevated">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <div className="flex-1">
          <h2 className="font-display text-sm font-bold">Módulos & Menus</h2>
          <p className="text-xs text-muted-foreground">Catálogo do ERP e controle de acesso por usuário.</p>
        </div>

        {podeGerenciar && view === "catalogo" && (
          <Button
            size="sm"
            variant={showAddForm ? "secondary" : "default"}
            className="gap-1.5"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAddForm ? "Cancelar" : "Adicionar módulo"}
          </Button>
        )}

        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <button
            onClick={() => { setView("catalogo"); setShowAddForm(false); }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "catalogo" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Catálogo
          </button>
          <button
            onClick={() => { setView("acesso"); setShowAddForm(false); }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "acesso" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <UserCog className="h-3.5 w-3.5" />
            Acesso por Usuário
          </button>
          <button
            onClick={() => { setView("por_modulo"); setShowAddForm(false); }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "por_modulo" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Boxes className="h-3.5 w-3.5" />
            Por Módulo
          </button>
        </div>
      </header>

      {view === "catalogo" && (
        <CatalogoView
          podeGerenciar={podeGerenciar}
          modulosQ={modulosQ}
          menusQ={menusQ}
          showAddForm={showAddForm}
          onAddFormClose={() => setShowAddForm(false)}
          onModuloChange={() => { qc.invalidateQueries({ queryKey: ["app_modulo"] }); qc.invalidateQueries({ queryKey: ["app_menu"] }); }}
          onMenuChange={() => qc.invalidateQueries({ queryKey: ["app_menu"] })}
        />
      )}

      {view === "acesso" && (
        <UserAccessPanel
          podeGerenciar={podeGerenciar}
          modulos={modulosQ.data ?? []}
          menus={menusQ.data ?? []}
        />
      )}

      {view === "por_modulo" && (
        <ModuleAccessPanel
          podeGerenciar={podeGerenciar}
          modulos={modulosQ.data ?? []}
          menus={menusQ.data ?? []}
        />
      )}
    </section>
  );
}

// ─── View: Catálogo ────────────────────────────────────────────────────────────

function CatalogoView({ podeGerenciar, modulosQ, menusQ, showAddForm, onAddFormClose, onModuloChange, onMenuChange }: {
  podeGerenciar: boolean;
  modulosQ: any;
  menusQ: any;
  showAddForm: boolean;
  onAddFormClose: () => void;
  onModuloChange: () => void;
  onMenuChange: () => void;
}) {
  const [novoModulo, setNovoModulo] = useState({ codigo: "", nome: "", icone: "" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const addModulo = async () => {
    if (!novoModulo.codigo || !novoModulo.nome) { toast({ title: "Código e nome obrigatórios", variant: "destructive" }); return; }
    const { error } = await supabase.from("app_modulo").insert({
      codigo: slugify(novoModulo.codigo),
      nome: novoModulo.nome.trim(),
      icone: novoModulo.icone || null,
      ordem: ((modulosQ.data ?? []).length + 1) * 10,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setNovoModulo({ codigo: "", nome: "", icone: "" });
    onModuloChange();
    onAddFormClose();
    toast({ title: "Módulo criado" });
  };

  const removerModulo = async (id: string) => {
    if (!confirm("Excluir este módulo e todos os seus menus?")) return;
    const { error } = await supabase.from("app_modulo").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    onModuloChange();
  };

  const toggleExpand = (id: string) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };

  return (
    <>
      {podeGerenciar && showAddForm && (
        <div className="grid gap-2 border-b border-border bg-muted/30 px-5 py-3 sm:grid-cols-[1fr_1fr_180px_auto]">
          <Input placeholder="Código (ex: financeiro)" value={novoModulo.codigo} onChange={(e) => setNovoModulo({ ...novoModulo, codigo: e.target.value })} />
          <Input placeholder="Nome" value={novoModulo.nome} onChange={(e) => setNovoModulo({ ...novoModulo, nome: e.target.value })} />
          <Input placeholder="Ícone (opcional)" value={novoModulo.icone} onChange={(e) => setNovoModulo({ ...novoModulo, icone: e.target.value })} />
          <Button onClick={addModulo} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Salvar módulo</Button>
        </div>
      )}
      <div className="divide-y divide-border">
        {modulosQ.isLoading && <p className="px-5 py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
        {(modulosQ.data ?? []).map((m: Modulo) => {
          const menus = (menusQ.data ?? []).filter((x: Menu) => x.modulo_id === m.id);
          const open = expanded.has(m.id);
          return (
            <div key={m.id}>
              <div className="flex items-center gap-2 px-5 py-3 hover:bg-muted/40">
                <button onClick={() => toggleExpand(m.id)} className="text-muted-foreground">
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="flex-1">
                  <p className="text-sm font-medium">{m.nome}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">{m.codigo} · ordem {m.ordem} · {menus.length} menu(s)</p>
                </div>
                {podeGerenciar && (
                  <Button size="sm" variant="ghost" onClick={() => removerModulo(m.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
              </div>
              {open && (
                <MenusEditor moduloId={m.id} menus={menus} podeGerenciar={podeGerenciar} onChange={onMenuChange} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MenusEditor({ moduloId, menus, podeGerenciar, onChange }: { moduloId: string; menus: Menu[]; podeGerenciar: boolean; onChange: () => void }) {
  const [novo, setNovo] = useState({ codigo: "", nome: "", rota: "" });

  const add = async () => {
    if (!novo.codigo || !novo.nome) return;
    const rotaTrim = novo.rota.trim();
    // RouteGuard compara a rota com pathname exato (com barra inicial) - sem isso,
    // matchMenuCode nunca encontra a rota e o switch de permissão fica sem efeito.
    const rotaNormalizada = rotaTrim ? (rotaTrim.startsWith("/") ? rotaTrim : `/${rotaTrim}`) : null;
    const { error } = await supabase.from("app_menu").insert({
      modulo_id: moduloId,
      codigo: slugify(novo.codigo),
      nome: novo.nome.trim(),
      rota: rotaNormalizada,
      ordem: (menus.length + 1) * 10,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setNovo({ codigo: "", nome: "", rota: "" });
    onChange();
  };
  const remover = async (id: string) => {
    const { error } = await supabase.from("app_menu").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    onChange();
  };

  return (
    <div className="bg-muted/20 px-12 py-3">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {menus.map((mn) => (
            <tr key={mn.id}>
              <td className="py-2 text-sm">{mn.nome}</td>
              <td className="py-2 text-[11px] font-mono text-muted-foreground">{mn.codigo}</td>
              <td className="py-2 text-[11px] font-mono text-muted-foreground">{mn.rota ?? "-"}</td>
              <td className="py-2 text-right">
                {podeGerenciar && <Button size="sm" variant="ghost" onClick={() => remover(mn.id)}><Trash2 className="h-3 w-3" /></Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {podeGerenciar && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder="código" value={novo.codigo} onChange={(e) => setNovo({ ...novo, codigo: e.target.value })} className="h-8 text-xs" />
          <Input placeholder="nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className="h-8 text-xs" />
          <Input placeholder="rota (opcional)" value={novo.rota} onChange={(e) => setNovo({ ...novo, rota: e.target.value })} className="h-8 text-xs" />
          <Button size="sm" onClick={add} className="h-8 gap-1"><Plus className="h-3 w-3" /> Menu</Button>
        </div>
      )}
    </div>
  );
}

// ─── View: Acesso por Usuário ──────────────────────────────────────────────────

// O enum app_acao do banco. Tipado aqui porque o insert em
// screen_permission_user exige a união exata, não `string`.
type AppAcao = "visualizar" | "incluir" | "alterar" | "excluir" | "aprovar" | "exportar" | "executar_ia" | "alterar_dre";

// LIBERAR A TELA É LIBERAR A TELA.
//
// Marcar o menu aqui concede as ações de trabalho junto — visualizar, incluir,
// alterar, aprovar e exportar. Não depende de perfil de acesso: o toggle sozinho
// tem que fazer a tela funcionar, senão o admin marca, o usuário entra e os
// botões não aparecem (ou aparecem e o RLS recusa a gravação).
//
// Antes isso valia só para uma lista fixa de 7 menus escrita neste arquivo, e
// todo menu novo nascia fora dela. O resultado foi 45 pessoas com o
// Recrutamento marcado e nenhuma conseguindo aprovar uma vaga — o toggle dizia
// "liberado" e gravava apenas 'visualizar'. Regra fixa vale mais que lista:
// não há como esquecer de cadastrar a tela nova.
//
// Duas ações ficam DE FORA de propósito, e continuam vindo de perfil:
//   • excluir      — liberar a tela não é autorizar apagar registro;
//   • executar_ia / alterar_dre — capacidades caras/sensíveis, concedidas caso
//     a caso, nunca de brinde junto com a tela.
const ACOES_DO_TOGGLE_PADRAO: readonly AppAcao[] =
  ["visualizar", "incluir", "alterar", "aprovar", "exportar"];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura mantida: os dois lugares que gravam permissão chamam por menu.
const ACOES_DO_TOGGLE = (_codigo: string): AppAcao[] => [...ACOES_DO_TOGGLE_PADRAO];

// Ordem canônica de exibição dos switches de ação. Serve só pra apresentação:
// quais ações cada menu realmente tem vem da tabela `app_menu_acao`, populada
// pela auditoria das três fontes de verdade (RLS, corpo das funções e chamadas
// can() no frontend) — ver 20260910000002_app_menu_acao_relevante.sql.
//
// Antes esta lista era fixa e global: TODO menu mostrava os mesmos 3 switches
// (Excluir / Executar IA / Alterar DRE), o que colocava "Alterar DRE" no
// Suprimentos. Pior, 'executar_ia' e 'alterar_dre' não são checadas em canto
// nenhum do sistema — aqueles dois switches nunca controlaram nada.
const ORDEM_ACOES: readonly AppAcao[] = [
  "visualizar", "incluir", "alterar", "excluir", "aprovar", "exportar", "executar_ia", "alterar_dre",
];
const ACAO_LABEL: Record<AppAcao, string> = {
  visualizar: "Visualizar", incluir: "Incluir", alterar: "Alterar", excluir: "Excluir",
  aprovar: "Aprovar", exportar: "Exportar", executar_ia: "Executar IA", alterar_dre: "Alterar DRE",
};

function UserAccessPanel({ podeGerenciar, modulos, menus }: { podeGerenciar: boolean; modulos: Modulo[]; menus: Menu[] }) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Map of menu_codigo → desired allow value (staged, not yet saved)
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  // Map of "menu_codigo::acao" → desired allow value, pras ações extras
  // (incluir/alterar/excluir) independentes do switch principal.
  const [pendingAcoes, setPendingAcoes] = useState<Map<string, boolean>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const qc = useQueryClient();

  const profilesQ = useQuery({
    queryKey: ["profiles-access-panel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  // Acesso efetivo real do usuário via RPC (combina role + overrides individuais).
  // É isso que deve ser exibido nos switches - não apenas os registros explícitos.
  const effectiveQ = useQuery({
    queryKey: ["effective-menus-for-user", selectedUserId],
    enabled: !!selectedUserId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_accessible_menus", {
        _user: selectedUserId as string,
        _acao: "visualizar",
        _empresa: null,
      });
      if (error) {
        console.warn("effective menus admin panel error", error);
        return new Set<string>();
      }
      return new Set<string>((data ?? []).map((r: any) => r.menu_codigo));
    },
  });

  // Quais ações são REAIS em cada menu (app_menu_acao). Antes a tela mostrava os
  // mesmos 3 switches em todo menu, e dois deles ('executar_ia'/'alterar_dre')
  // não são checados em lugar nenhum do sistema — Suprimentos exibia
  // "Alterar DRE" sem que aquilo controlasse coisa alguma.
  const menuAcoesQ = useQuery({
    queryKey: ["app-menu-acao"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("app_menu_acao").select("menu_codigo, acao");
      if (error) { console.warn("app_menu_acao error", error); return new Map<string, AppAcao[]>(); }
      const m = new Map<string, AppAcao[]>();
      (data ?? []).forEach((r: any) => {
        m.set(r.menu_codigo, [...(m.get(r.menu_codigo) ?? []), r.acao as AppAcao]);
      });
      // Ordem canônica pra os switches não dançarem de posição entre menus.
      for (const [k, v] of m) m.set(k, ORDEM_ACOES.filter((a) => v.includes(a)));
      return m;
    },
  });

  // Ações com switch próprio neste menu: todas as reais menos 'visualizar'
  // (que é o switch principal da linha).
  const acoesDoMenu = useCallback(
    (codigo: string): AppAcao[] => (menuAcoesQ.data?.get(codigo) ?? []).filter((a) => a !== "visualizar"),
    [menuAcoesQ.data],
  );

  // União de tudo que pode aparecer — define quantas RPCs precisamos consultar.
  const acoesConsultadas = useMemo<AppAcao[]>(() => {
    const s = new Set<AppAcao>();
    for (const lista of menuAcoesQ.data?.values() ?? []) lista.forEach((a) => { if (a !== "visualizar") s.add(a); });
    return ORDEM_ACOES.filter((a) => s.has(a));
  }, [menuAcoesQ.data]);

  // Acesso efetivo por ação, uma RPC por ação (mesma list_accessible_menus já
  // usada acima, só variando _acao — sem SQL novo).
  const effectiveAcoesQ = useQuery({
    queryKey: ["effective-menus-acoes-for-user", selectedUserId, acoesConsultadas.join(",")],
    enabled: !!selectedUserId && acoesConsultadas.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const resultados = await Promise.all(
          acoesConsultadas.map((acao) =>
            supabase.rpc("list_accessible_menus", { _user: selectedUserId as string, _acao: acao, _empresa: null })
              .then(({ data, error }) => {
                if (error) { console.warn("effective menus (ação) error", acao, error); return [acao, new Set<string>()] as const; }
                return [acao, new Set<string>((data ?? []).map((r: any) => r.menu_codigo))] as const;
              })
              .catch((err) => { console.warn("effective menus (ação) catch", acao, err); return [acao, new Set<string>()] as const; }),
          ),
        );
        return new Map<AppAcao, Set<string>>(resultados);
      } catch (err) {
        console.warn("effectiveAcoesQ error", err);
        return new Map<AppAcao, Set<string>>();
      }
    },
  });

  // Clear pending changes when user is switched
  useEffect(() => { setPending(new Map()); setPendingAcoes(new Map()); }, [selectedUserId]);

  // Acesso efetivo atual (role + overrides). Base para os switches e para detectar mudança real.
  const dbHasAccess = (codigo: string) =>
    effectiveQ.data?.has(codigo) ?? false;

  // Show pending value if staged, otherwise DB value
  const hasAccess = (codigo: string) =>
    pending.has(codigo) ? pending.get(codigo)! : dbHasAccess(codigo);

  const stageChange = (codigo: string, newValue: boolean) => {
    setPending((prev) => {
      const next = new Map(prev);
      // If new value matches DB, no change needed - remove from pending
      if (newValue === dbHasAccess(codigo)) { next.delete(codigo); } else { next.set(codigo, newValue); }
      return next;
    });
  };

  const dbHasAcao = (codigo: string, acao: AppAcao) => effectiveAcoesQ.data?.get(acao)?.has(codigo) ?? false;
  const acaoKey = (codigo: string, acao: AppAcao) => `${codigo}::${acao}`;
  const hasAcao = (codigo: string, acao: AppAcao) => {
    const k = acaoKey(codigo, acao);
    return pendingAcoes.has(k) ? pendingAcoes.get(k)! : dbHasAcao(codigo, acao);
  };
  const stageAcao = (codigo: string, acao: AppAcao, newValue: boolean) => {
    const k = acaoKey(codigo, acao);
    setPendingAcoes((prev) => {
      const next = new Map(prev);
      if (newValue === dbHasAcao(codigo, acao)) next.delete(k); else next.set(k, newValue);
      return next;
    });
  };

  // Marcar/desmarcar o módulo inteiro — telas E ações de cada tela.
  //
  // As ações entram junto de propósito: liberar só a tela e deixar as ações
  // desligadas é justamente o estado que trava o usuário no dia a dia (ele
  // enxerga e não consegue trabalhar), que é o problema que este painel existe
  // pra evitar. É mais fácil desmarcar uma ação sobrando do que caçar uma
  // faltando.
  const stageAll = (modMenus: Menu[], allHaveAccess: boolean) => {
    const newValue = !allHaveAccess;
    setPending((prev) => {
      const next = new Map(prev);
      modMenus.forEach((mn) => {
        if (newValue === dbHasAccess(mn.codigo)) next.delete(mn.codigo); else next.set(mn.codigo, newValue);
      });
      return next;
    });
    setPendingAcoes((prev) => {
      const next = new Map(prev);
      modMenus.forEach((mn) => {
        acoesDoMenu(mn.codigo).forEach((acao) => {
          const k = acaoKey(mn.codigo, acao);
          if (newValue === dbHasAcao(mn.codigo, acao)) next.delete(k); else next.set(k, newValue);
        });
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedUserId || !podeGerenciar || (pending.size === 0 && pendingAcoes.size === 0)) return;
    setIsSaving(true);
    try {
      for (const [codigo, allow] of pending) {
        // O toggle da tela vale pelo pacote inteiro de trabalho, não só "ver"
        // (ACOES_DO_TOGGLE_PADRAO). As ações de fora do pacote têm switch
        // próprio e são gravadas no laço de `pendingAcoes`, logo abaixo.
        const acoes = ACOES_DO_TOGGLE(codigo);
        const { error: delErr } = await supabase.from("screen_permission_user").delete()
          .eq("user_id", selectedUserId).eq("menu_codigo", codigo)
          .in("acao", acoes).is("empresa_id", null);
        if (delErr) console.warn("delete perm error", delErr);

        const { error } = await supabase.from("screen_permission_user").insert(
          acoes.map((acao) => ({
            user_id: selectedUserId, menu_codigo: codigo, acao, allow, empresa_id: null,
          })),
        );
        if (error) throw error;
      }

      for (const [key, allow] of pendingAcoes) {
        const [codigo, acao] = key.split("::") as [string, AppAcao];
        const { error: delErr } = await supabase.from("screen_permission_user").delete()
          .eq("user_id", selectedUserId).eq("menu_codigo", codigo).eq("acao", acao).is("empresa_id", null);
        if (delErr) console.warn("delete perm (ação extra) error", delErr);

        const { error } = await supabase.from("screen_permission_user").insert({
          user_id: selectedUserId, menu_codigo: codigo, acao, allow, empresa_id: null,
        });
        if (error) throw error;
      }

      // refetchQueries aguarda o re-fetch completar antes de limpar pending,
      // evitando o flicker onde os switches voltam ao estado anterior por um instante.
      await qc.refetchQueries({ queryKey: ["effective-menus-for-user", selectedUserId] });
      await qc.refetchQueries({ queryKey: ["effective-menus-acoes-for-user", selectedUserId] });
      await qc.invalidateQueries({ queryKey: ["accessible-menus"] });
      setPending(new Map());
      setPendingAcoes(new Map());
      toast({ title: "Permissões salvas com sucesso" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar permissões", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleExpand = (id: string) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };

  const totalPending = pending.size + pendingAcoes.size;
  const hasPending = totalPending > 0;

  return (
    <div>
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium whitespace-nowrap">Selecionar usuário</label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Escolha um usuário…" />
            </SelectTrigger>
            <SelectContent>
              {(profilesQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.display_name || p.email || p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasPending && (
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              disabled={isSaving}
              onClick={handleSave}
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "Salvando…" : `Salvar ${totalPending} alteraç${totalPending === 1 ? "ão" : "ões"}`}
            </Button>
          )}

          {!podeGerenciar && (
            <p className="text-xs text-muted-foreground">Apenas administradores podem alterar permissões.</p>
          )}
        </div>
      </div>

      {!selectedUserId && (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Selecione um usuário acima para ver e configurar seus acessos.
        </p>
      )}

      {selectedUserId && effectiveQ.isLoading && (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">Carregando permissões…</p>
      )}

      {selectedUserId && !effectiveQ.isLoading && (
        <div className="divide-y divide-border">
          <PerfisAtribuidosSection
            userId={selectedUserId}
            podeGerenciar={podeGerenciar}
            expanded={expanded.has("__perfis__")}
            onToggleExpand={() => toggleExpand("__perfis__")}
          />
          {modulos.map((m) => {
            // Só menus ATIVOS. Menu desativado não é liberável: tanto
            // `can_access` quanto `list_accessible_menus` exigem `ativo = true`,
            // então o switch gravava a permissão, dizia "salvas com sucesso" e
            // voltava sozinho para desligado no refetch — parecia bug de save e
            // era menu desligado (21 dos 192 estão assim). Quem quiser liberá-lo
            // ativa o menu primeiro, na aba Módulos & Menus.
            const modMenus = menus.filter((x) => x.modulo_id === m.id && x.ativo);
            const open = expanded.has(m.id);
            const moduloAccess = hasAccess(m.codigo);
            const liberados = modMenus.filter((mn) => hasAccess(mn.codigo)).length;
            // "Tudo liberado" só quando as telas E as ações delas estão ligadas —
            // senão o botão diria "Remover todos" com ações ainda desmarcadas.
            const allHaveAccess = modMenus.length > 0
              && liberados === modMenus.length
              && modMenus.every((mn) => acoesDoMenu(mn.codigo).every((a) => hasAcao(mn.codigo, a)));

            return (
              <div key={m.id}>
                <div className="flex items-center gap-2 px-5 py-3 hover:bg-muted/40">
                  {modMenus.length > 0 ? (
                    <button onClick={() => toggleExpand(m.id)} className="text-muted-foreground">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{m.nome}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{m.codigo}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {modMenus.length === 0 && (
                      <Switch
                        checked={moduloAccess}
                        disabled={!podeGerenciar}
                        onCheckedChange={() => stageChange(m.codigo, !moduloAccess)}
                        aria-label={`Acesso ao módulo ${m.nome}`}
                      />
                    )}
                    {modMenus.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {liberados}/{modMenus.length} menus liberados
                      </span>
                    )}
                  </div>
                </div>

                {open && modMenus.length > 0 && (
                  <div className="bg-muted/20 divide-y divide-border/60">
                    {podeGerenciar && (
                      <div className="flex items-center justify-end px-12 py-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => stageAll(modMenus, allHaveAccess)}
                        >
                          <CheckSquare className="h-3.5 w-3.5" />
                          {allHaveAccess ? "Remover todos" : "Selecionar todos"}
                        </Button>
                      </div>
                    )}
                    {modMenus.map((mn) => {
                      const menuAccess = hasAccess(mn.codigo);
                      const isPending = pending.has(mn.codigo);
                      const isForm = mn.codigo === FORM_MENU_CODIGO;
                      const isReunioes = mn.codigo === REUNIOES_MENU_CODIGO;
                      const capsOpen = expanded.has(mn.id);
                      const acoesDesteMenu = acoesDoMenu(mn.codigo);
                      const comAcoesExtras = acoesDesteMenu.length > 0;
                      const acoesKey = `${mn.id}::acoes`;
                      const acoesOpen = expanded.has(acoesKey);
                      return (
                        <div key={mn.id}>
                          <div className={cn("flex items-center gap-2 px-12 py-2.5 hover:bg-muted/40", isPending && "bg-amber-50/50 dark:bg-amber-950/20")}>
                            {(isForm || isReunioes) && podeGerenciar ? (
                              <button onClick={() => toggleExpand(mn.id)} className="text-muted-foreground" title="Permissões do usuário neste menu">
                                {capsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            ) : (
                              <span className="h-4 w-4" />
                            )}
                            <div className="flex-1">
                              <p className="text-sm">{mn.nome}</p>
                              <p className="text-[11px] font-mono text-muted-foreground">{mn.codigo}{mn.rota ? ` · ${mn.rota}` : ""}</p>
                            </div>
                            <Switch
                              checked={menuAccess}
                              disabled={!podeGerenciar}
                              onCheckedChange={() => stageChange(mn.codigo, !menuAccess)}
                              aria-label={`Acesso ao menu ${mn.nome}`}
                            />
                            {comAcoesExtras && podeGerenciar && (
                              <button
                                onClick={() => toggleExpand(acoesKey)}
                                className={cn("text-muted-foreground hover:text-foreground", acoesOpen && "text-foreground")}
                                title={`Ações desta tela: ${acoesDesteMenu.map((a) => ACAO_LABEL[a]).join(" · ")}`}
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {isForm && podeGerenciar && capsOpen && (
                            <div className="border-t border-border/60 bg-background px-12 py-2">
                              <FormPermsUsuario userId={selectedUserId} onToast={(m, t) => toast({ title: m, variant: t === "err" ? "destructive" : "default" })} />
                            </div>
                          )}
                          {isReunioes && podeGerenciar && capsOpen && (
                            <div className="border-t border-border/60 bg-background px-12 py-2">
                              <ObservadorAutomaticoReuniao userId={selectedUserId} onToast={(m, t) => toast({ title: m, variant: t === "err" ? "destructive" : "default" })} />
                            </div>
                          )}
                          {comAcoesExtras && podeGerenciar && acoesOpen && (
                            <div className="border-t border-border/60 bg-background px-12 py-2">
                              <div className="flex flex-wrap items-center gap-4">
                                {acoesDesteMenu.map((acao) => {
                                  const on = hasAcao(mn.codigo, acao);
                                  const acaoPending = pendingAcoes.has(acaoKey(mn.codigo, acao));
                                  return (
                                    <label key={acao} className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs", acaoPending && "bg-amber-50/50 dark:bg-amber-950/20")}>
                                      <Switch
                                        checked={on}
                                        onCheckedChange={() => stageAcao(mn.codigo, acao, !on)}
                                        aria-label={`${ACAO_LABEL[acao]} em ${mn.nome}`}
                                      />
                                      {ACAO_LABEL[acao]}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── View: Por Módulo ───────────────────────────────────────────────────────────
// Caminho inverso da "Acesso por Usuário" acima: em vez de escolher a pessoa e
// ver os módulos, escolhe o módulo (ou desce até um menu/submódulo específico)
// e vê/marca as pessoas. Mesmas tabelas, mesmas regras de precedência — só o
// eixo de leitura/escrita é trocado (RPC list_users_with_menu_access em vez de
// list_accessible_menus; grava em screen_permission_user com a mesma lógica de
// ACOES_DO_TOGGLE que a visão por usuário já usa).
function ModuleAccessPanel({ podeGerenciar, modulos, menus }: { podeGerenciar: boolean; modulos: Modulo[]; menus: Menu[] }) {
  const [selectedModuloId, setSelectedModuloId] = useState<string>("");
  const [selectedMenuCodigo, setSelectedMenuCodigo] = useState<string | null>(null);

  const moduloSelecionado = modulos.find((m) => m.id === selectedModuloId) ?? null;
  // Só menus ATIVOS, pelo mesmo motivo da visão por usuário: menu desativado
  // não é liberável (`can_access` e `list_accessible_menus` exigem
  // `ativo = true`), então marcar alguém nele grava a permissão, diz que
  // salvou e volta sozinho no refetch. 21 dos 192 menus estão desativados.
  const menusDoModulo = menus.filter((mn) => mn.modulo_id === selectedModuloId && mn.ativo);

  // Módulo-folha (sem submenus): ele mesmo é o menu_codigo a marcar pessoas.
  useEffect(() => {
    if (!moduloSelecionado) { setSelectedMenuCodigo(null); return; }
    setSelectedMenuCodigo(menusDoModulo.length === 0 ? moduloSelecionado.codigo : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModuloId]);

  return (
    <div>
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium whitespace-nowrap">Selecionar módulo</label>
          <Select value={selectedModuloId} onValueChange={setSelectedModuloId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Escolha um módulo…" />
            </SelectTrigger>
            <SelectContent>
              {modulos.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!podeGerenciar && (
            <p className="text-xs text-muted-foreground">Apenas administradores podem alterar permissões.</p>
          )}
        </div>
      </div>

      {!selectedModuloId && (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Selecione um módulo acima pra ver ou marcar quem tem acesso a ele.
        </p>
      )}

      {selectedModuloId && menusDoModulo.length > 0 && (
        <div className="divide-y divide-border">
          {menusDoModulo.map((mn) => {
            const aberto = selectedMenuCodigo === mn.codigo;
            return (
              <div key={mn.id}>
                <button
                  onClick={() => setSelectedMenuCodigo(aberto ? null : mn.codigo)}
                  className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-muted/40"
                >
                  {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{mn.nome}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{mn.codigo}{mn.rota ? ` · ${mn.rota}` : ""}</p>
                  </div>
                </button>
                {aberto && (
                  <div className="border-t border-border/60 bg-muted/20 px-5 py-3">
                    <PessoasComAcessoAoMenu menuCodigo={mn.codigo} podeGerenciar={podeGerenciar} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedModuloId && menusDoModulo.length === 0 && selectedMenuCodigo && (
        <div className="px-5 py-3">
          <PessoasComAcessoAoMenu menuCodigo={selectedMenuCodigo} podeGerenciar={podeGerenciar} />
        </div>
      )}
    </div>
  );
}

function PessoasComAcessoAoMenu({ menuCodigo, podeGerenciar }: { menuCodigo: string; podeGerenciar: boolean }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [acao, setAcao] = useState<AppAcao>("visualizar");

  // O seletor mostra só as ações que existem de verdade NESTE menu — mesma
  // fonte da visão por usuário (app_menu_acao). Antes era uma lista fixa de 4,
  // que oferecia "Excluir" em tela que não tem exclusão e escondia "Aprovar"
  // em tela de aprovação.
  const menuAcoesQ = useQuery({
    queryKey: ["app-menu-acao"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("app_menu_acao").select("menu_codigo, acao");
      if (error) { console.warn("app_menu_acao error", error); return new Map<string, AppAcao[]>(); }
      const m = new Map<string, AppAcao[]>();
      (data ?? []).forEach((r: any) => {
        m.set(r.menu_codigo, [...(m.get(r.menu_codigo) ?? []), r.acao as AppAcao]);
      });
      for (const [k, v] of m) m.set(k, ORDEM_ACOES.filter((a) => v.includes(a)));
      return m;
    },
  });

  // 'visualizar' sempre entra: é o acesso à tela em si, mesmo que nenhuma
  // policy a cheque explicitamente.
  const ACOES_SELETOR = useMemo<AppAcao[]>(() => {
    const reais = (menuAcoesQ.data?.get(menuCodigo) ?? []).filter((a) => a !== "visualizar");
    return ["visualizar", ...reais];
  }, [menuAcoesQ.data, menuCodigo]);
  const podeTrocarAcao = ACOES_SELETOR.length > 1;

  const profilesQ = useQuery({
    queryKey: ["profiles-access-panel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const acessoQ = useQuery({
    queryKey: ["users-with-menu-access", menuCodigo, acao],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_users_with_menu_access", {
        _menu: menuCodigo, _acao: acao,
      });
      if (error) throw error;
      const m = new Map<string, boolean>();
      (data ?? []).forEach((r: any) => m.set(r.user_id, !!r.allowed));
      return m;
    },
  });

  useEffect(() => { setPending(new Map()); setBusca(""); setAcao("visualizar"); }, [menuCodigo]);
  useEffect(() => { setPending(new Map()); }, [acao]);

  const dbHasAccess = (userId: string) => acessoQ.data?.get(userId) ?? false;
  const hasAccess = (userId: string) => (pending.has(userId) ? pending.get(userId)! : dbHasAccess(userId));

  const stageChange = (userId: string, newValue: boolean) => {
    setPending((prev) => {
      const next = new Map(prev);
      if (newValue === dbHasAccess(userId)) next.delete(userId); else next.set(userId, newValue);
      return next;
    });
  };

  const handleSave = async () => {
    if (!podeGerenciar || pending.size === 0) return;
    setIsSaving(true);
    try {
      // Na aba "Visualizar" de um menu com pacote próprio (ex.: Recrutamento),
      // o toggle vale pelas ações do pacote inteiro — mesmo comportamento da
      // "Acesso por Usuário". Nas outras abas (Incluir/Alterar/Excluir), grava
      // só aquela ação específica.
      const acoes = acao === "visualizar" ? ACOES_DO_TOGGLE(menuCodigo) : [acao];
      for (const [userId, allow] of pending) {
        const { error: delErr } = await supabase.from("screen_permission_user").delete()
          .eq("user_id", userId).eq("menu_codigo", menuCodigo).in("acao", acoes).is("empresa_id", null);
        if (delErr) console.warn("delete perm error", delErr);

        const { error } = await supabase.from("screen_permission_user").insert(
          acoes.map((a) => ({ user_id: userId, menu_codigo: menuCodigo, acao: a, allow, empresa_id: null })),
        );
        if (error) throw error;
      }
      await qc.refetchQueries({ queryKey: ["users-with-menu-access", menuCodigo, acao] });
      await qc.invalidateQueries({ queryKey: ["users-with-menu-access"] });
      await qc.invalidateQueries({ queryKey: ["accessible-menus"] });
      await qc.invalidateQueries({ queryKey: ["effective-menus-for-user"] });
      await qc.invalidateQueries({ queryKey: ["effective-menus-acoes-for-user"] });
      setPending(new Map());
      toast({ title: "Permissões salvas com sucesso" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar permissões", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // Quem já tem acesso vem primeiro, em ordem alfabética; depois de esgotá-los,
  // quem não tem, também em ordem alfabética. Sem isso a pergunta que traz
  // alguém a esta tela — "quem enxerga este menu?" — só se responde rolando as
  // 176 pessoas caçando switch ligado.
  //
  // Ordena pelo estado SALVO (dbHasAccess), nunca pelo hasAccess: a tela empilha
  // as mudanças até o "Salvar", e seguir o estado ao vivo faria a linha saltar de
  // grupo no instante do clique — quem desmarca várias pessoas seguidas erraria o
  // alvo. Por isso `pending` NÃO entra nas dependências: é o que mantém a linha
  // parada embaixo do cursor. A lista se reorganiza depois de salvar.
  const { comAcesso, semAcesso } = useMemo(() => {
    const q = busca.trim().toLowerCase();
    // Mesmo encadeamento que a linha renderiza; ordenar por display_name puro
    // colocaria quem só tem e-mail num lugar e o mostraria em outro.
    const nomeDe = (p: ProfileRow) => p.display_name || p.email || p.id;
    const filtradas = (profilesQ.data ?? []).filter((p) =>
      !q || (p.display_name ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q));

    const ordenar = (lista: ProfileRow[]) =>
      // "pt-BR" + sensitivity base para ÁLVARO cair junto de ALVARO, e não no fim.
      [...lista].sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR", { sensitivity: "base" }));

    return {
      comAcesso: ordenar(filtradas.filter((p) => dbHasAccess(p.id))),
      semAcesso: ordenar(filtradas.filter((p) => !dbHasAccess(p.id))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilesQ.data, acessoQ.data, busca]);

  const nenhuma = comAcesso.length === 0 && semAcesso.length === 0;
  const carregando = profilesQ.isLoading || acessoQ.isLoading;

  // O toggle segue o estado AO VIVO (hasAccess), mesmo com a lista ordenada pelo
  // salvo: a pessoa precisa ver na hora o que acabou de clicar. O fundo âmbar é
  // o que avisa que aquilo ainda não foi gravado.
  const linhaPessoa = (p: ProfileRow) => {
    const on = hasAccess(p.id);
    const isPending = pending.has(p.id);
    return (
      <div key={p.id} className={cn("flex items-center gap-2 px-3 py-2 hover:bg-muted/40", isPending && "bg-amber-50/50 dark:bg-amber-950/20")}>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm">{p.display_name || p.email || p.id}</p>
          {p.display_name && p.email && <p className="truncate text-[11px] text-muted-foreground">{p.email}</p>}
        </div>
        <Switch
          checked={on}
          disabled={!podeGerenciar}
          onCheckedChange={() => stageChange(p.id, !on)}
          aria-label={`Acesso de ${p.display_name || p.email} a este menu`}
        />
      </div>
    );
  };
  const hasPending = pending.size > 0;

  return (
    <div>
      {podeTrocarAcao && (
        <div className="mb-2 flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5 w-fit">
          {ACOES_SELETOR.map((a) => (
            <button
              key={a}
              onClick={() => setAcao(a)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                acao === a ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {ACAO_LABEL[a]}
            </button>
          ))}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        {hasPending && (
          <Button size="sm" className="gap-1.5" disabled={isSaving} onClick={handleSave}>
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Salvando…" : `Salvar ${pending.size} alteraç${pending.size === 1 ? "ão" : "ões"}`}
          </Button>
        )}
      </div>

      {carregando && <p className="py-4 text-center text-xs text-muted-foreground">Carregando…</p>}

      {!carregando && (
        <div className="max-h-96 divide-y divide-border/60 overflow-y-auto rounded-md border border-border bg-background">
          {nenhuma && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhuma pessoa encontrada.</p>
          )}
          {/* Grupo vazio não rende cabeçalho: menu que ninguém acessa mostra só
              "SEM ACESSO". A contagem segue o que está visível — com busca
              digitada, ela conta o resultado da busca, não o total. */}
          {comAcesso.length > 0 && <CabecalhoGrupo rotulo="Com acesso" quantidade={comAcesso.length} />}
          {comAcesso.map(linhaPessoa)}
          {semAcesso.length > 0 && <CabecalhoGrupo rotulo="Sem acesso" quantidade={semAcesso.length} />}
          {semAcesso.map(linhaPessoa)}
        </div>
      )}
    </div>
  );
}

// Faixa que marca a fronteira entre os dois grupos da lista. Sem ela a divisão
// fica invisível — a lista só muda de switch ligado para desligado. `sticky`
// porque o contêiner rola (max-h-96): sem isso o rótulo some ao descer.
function CabecalhoGrupo({ rotulo, quantidade }: { rotulo: string; quantidade: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted/80 px-3 py-1.5 backdrop-blur-sm">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <span className="text-[10px] tabular-nums text-muted-foreground">({quantidade})</span>
    </div>
  );
}

// ─── Observador automático em reuniões de Comitê/Gerencial/Diretoria ───────────
// Presença de uma linha em reuniao_observador_automatico = flag ligada pra
// aquele usuário (mesmo padrão de CS_FORM_ACESSOS abaixo). Aplicado via
// trigger no banco (adicionar_observadores_automaticos_reuniao), não aqui —
// esse painel só liga/desliga a flag.
function ObservadorAutomaticoReuniao({ userId, onToast }: { userId: string; onToast: (m: string, t?: string) => void }) {
  const [ativo, setAtivo] = useState(false);
  const [loading, setLoading] = useState(true);
  const erroPerm = (m: string) => /row-level|permission|policy/i.test(m) ? "Só administradores alteram permissões." : "Erro: " + m;

  useEffect(() => {
    setLoading(true);
    (supabase as any)
      .from("reuniao_observador_automatico")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }: any) => { setAtivo(!!data); setLoading(false); });
  }, [userId]);

  const toggle = async () => {
    if (ativo) {
      const { error } = await (supabase as any).from("reuniao_observador_automatico").delete().eq("user_id", userId);
      if (error) { onToast(erroPerm(error.message), "err"); return; }
    } else {
      const { error } = await (supabase as any).from("reuniao_observador_automatico").insert({ user_id: userId });
      if (error) { onToast(erroPerm(error.message), "err"); return; }
    }
    setAtivo((v) => !v);
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex-1">
        <p className="text-sm">Observadora automática em reuniões de Comitê, Gerencial ou Diretoria</p>
        <p className="text-[11px] text-muted-foreground">
          Ao criar uma reunião desses tipos, esta pessoa é adicionada como observadora automaticamente —
          a não ser que ela seja a criadora/organizadora/responsável, ou já esteja convidada.
        </p>
      </div>
      <Switch checked={ativo} disabled={loading} onCheckedChange={toggle} aria-label="Observadora automática em reuniões de Comitê, Gerencial ou Diretoria" />
    </div>
  );
}

// ─── Permissões do Nascimento Formulários (capacidades por usuário) ─────────────
// As regras/permissões ficam aqui no Módulos & Menus, não no módulo de origem.
// Capacidades SOMENTE POR USUÁRIO. 'responder' já é de todos por padrão; o
// resto é liberado por usuário nos toggles abaixo.
// 'ver_setor' é o único papel parametrizado: uma linha por setor liberado
// (papel='ver_setor' + setor='JURIDICO'), e a leitura das respostas é a UNIÃO
// de ver_tudo + ver_proprias + os setores marcados (public.cs_form_cap_setor).

const CAPS: { papel: FormCap; rotulo: string; desc: string }[] = [
  { papel: "editar_criar",     rotulo: "Editar / Criar",           desc: "Criar e editar formularios" },
  { papel: "responder",        rotulo: "Responder",                desc: "Abrir e enviar respostas (padrao de todos)" },
  { papel: "encerrar_excluir", rotulo: "Encerrar / Excluir",       desc: "Publicar, encerrar, reabrir e excluir" },
  { papel: "ver_tudo",         rotulo: "Visualizar tudo",          desc: "Ver todas as respostas" },
  { papel: "ver_proprias",     rotulo: "So as proprias respostas", desc: "So o que a propria pessoa enviou" },
  { papel: "ver_lixeira",      rotulo: "Lixeira de formularios",   desc: "Ver e restaurar formularios apagados (30 dias)" },
];

// Lista de capacidades como linhas com Switch à direita (mesmo padrão dos menus).
function CapToggles({ caps, onToggle }: { caps: Set<string>; onToggle: (papel: FormCap) => void }) {
  return (
    <div className="divide-y divide-border/60">
      {CAPS.map((c) => (
        <div key={c.papel} className="flex items-center gap-3 py-2.5">
          <div className="flex-1">
            <p className="text-sm">{c.rotulo}</p>
            <p className="text-[11px] text-muted-foreground">{c.desc}</p>
          </div>
          <Switch checked={caps.has(c.papel)} onCheckedChange={() => onToggle(c.papel)} aria-label={c.rotulo} />
        </div>
      ))}
    </div>
  );
}

// Bloco "por setor": switch mestre que abre um toggle por setor do cadastro
// (EMPREGADOS.Setor_ERP). Desligar o mestre revoga todos. Reusado por
// "Visualizar respostas por setor" (ver_setor), "Criar formularios por setor"
// (criar_setor) — muda so os rotulos e os handlers.
function SetorToggles({ titulo, descricao, rotuloLinha, descLinha, ariaLinha, setores, marcados, onToggle, onLimpar }: {
  titulo: string; descricao: string;
  rotuloLinha: (s: string) => string; descLinha: (s: string) => string; ariaLinha: (s: string) => string;
  setores: string[]; marcados: Set<string>;
  onToggle: (setor: string) => void; onLimpar: () => void;
}) {
  const [aberto, setAberto] = useState(marcados.size > 0);
  useEffect(() => { if (marcados.size > 0) setAberto(true); }, [marcados.size]);

  return (
    <>
      <div className="flex items-center gap-3 py-2.5">
        <div className="flex-1">
          <p className="text-sm">{titulo}</p>
          <p className="text-[11px] text-muted-foreground">{descricao}</p>
        </div>
        <Switch checked={aberto} aria-label={titulo}
          onCheckedChange={(v) => { setAberto(v); if (!v && marcados.size) onLimpar(); }} />
      </div>
      {aberto && (
        <div className="pb-2 pl-3">
          {setores.length === 0 && <p className="py-2 text-[11px] text-muted-foreground">Carregando setores...</p>}
          {setores.map((s) => (
            <div key={s} className="flex items-center gap-3 rounded-md py-2 pl-2 pr-1 hover:bg-muted/40">
              <div className="flex-1">
                <p className="text-[13px]">{rotuloLinha(s)}</p>
                <p className="text-[11px] text-muted-foreground">{descLinha(s)}</p>
              </div>
              <Switch checked={marcados.has(s.toUpperCase())} onCheckedChange={() => onToggle(s)} aria-label={ariaLinha(s)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Capacidades de UM usuário, na cascata de "Acesso por Usuário".
function FormPermsUsuario({ userId, onToast }: { userId: string; onToast: (m: string, t?: string) => void }) {
  const [caps, setCaps] = useState<Set<string>>(new Set());
  const [setoresVer, setSetoresVer] = useState<Set<string>>(new Set());    // ver_setor (upper)
  const [setoresCriar, setSetoresCriar] = useState<Set<string>>(new Set()); // criar_setor (upper)
  const [setoresErp, setSetoresErp] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const erroPerm = (m: string) => /row-level|permission|policy/i.test(m) ? "So administradores alteram permissoes." : "Erro: " + m;

  const load = useCallback(async () => {
    setLoading(true);
    const uRes = await (supabase as any).from("CS_FORM_ACESSOS").select("papel, setor").eq("user_id", userId).neq("papel", "dashboard");
    const linhas = uRes.data ?? [];
    const setoresDe = (papel: string) => new Set<string>(linhas.filter((r: any) => r.papel === papel && r.setor).map((r: any) => String(r.setor).trim().toUpperCase()));
    setCaps(new Set<string>(linhas.map((r: any) => r.papel)));
    setSetoresVer(setoresDe("ver_setor"));
    setSetoresCriar(setoresDe("criar_setor"));
    setLoading(false);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  // Setores para os grants — a lista não é fixa no código. Une DOIS domínios: o
  // Setor_ERP do cadastro (EMPREGADOS) E o setor carimbado nas respostas
  // (CS_FORM_RESPOSTAS). As permissões por setor recortam justamente pelo setor
  // da resposta (cs_form_cap_setor), então setores que só aparecem em respostas
  // (ex.: COMPRAS, LICITAÇÃO, TREINAMENTOS, JURÍDICO — sem colaborador com esse
  // Setor_ERP) precisam ser concedíveis também.
  //
  // Vem da RPC cs_form_setores_catalogo (SECURITY DEFINER, só nomes): ler
  // CS_FORM_RESPOSTAS direto não serve mais porque a RLS não tem bypass de admin
  // — sem 'ver_tudo' o admin não enxergaria as respostas e os setores só-de-
  // resposta sumiriam da lista. A RPC devolve os nomes sem expor conteúdo.
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("cs_form_setores_catalogo");
      // Dedup SEM acento/caixa (JURIDICO == JURÍDICO) e fora o placeholder PADRAO
      // (= "sem setor"). A RPC já faz isso; aqui é rede de segurança e mantém a
      // 1ª grafia que veio (a RPC devolve a da resposta primeiro).
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
      const porChave = new Map<string, string>();  // CHAVE(sem acento) → rótulo de exibição
      (data ?? []).forEach((r: any) => { const l = String(r.setor ?? "").trim(); if (!l) return; const k = norm(l); if (k === "PADRAO" || porChave.has(k)) return; porChave.set(k, l); });
      setSetoresErp([...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR")));
    })();
  }, []);

  // ver_tudo x ver_proprias sao contraditorios: ligar um desliga o outro (senao
  // ver_tudo mascara o "so as proprias" e a pessoa acaba vendo tudo).
  const OPOSTO: Partial<Record<FormCap, FormCap>> = { ver_tudo: "ver_proprias", ver_proprias: "ver_tudo" };

  const toggle = async (papel: FormCap) => {
    const tem = caps.has(papel);
    const oposto = !tem ? OPOSTO[papel] : undefined;  // ao LIGAR, remover o contrario
    if (tem) {
      const { error } = await (supabase as any).from("CS_FORM_ACESSOS").delete().eq("user_id", userId).eq("papel", papel);
      if (error) { onToast(erroPerm(error.message), "err"); return; }
    } else {
      if (oposto && caps.has(oposto)) await (supabase as any).from("CS_FORM_ACESSOS").delete().eq("user_id", userId).eq("papel", oposto);
      const { error } = await (supabase as any).from("CS_FORM_ACESSOS").insert({ papel, user_id: userId });
      if (error) { onToast(erroPerm(error.message), "err"); return; }
    }
    setCaps(c => {
      const n = new Set(c);
      if (tem) n.delete(papel);
      else { n.add(papel); if (oposto) n.delete(oposto); }
      return n;
    });
  };

  // Fabrica de handlers p/ os dois blocos por setor (ver_setor / criar_setor):
  // gravam/removem 1 linha por (usuario, setor) e refletem no estado local.
  const fazSetorHandlers = (papel: "ver_setor" | "criar_setor", marcados: Set<string>, setMarcados: (f: (s: Set<string>) => Set<string>) => void) => ({
    onToggle: async (setor: string) => {
      const chave = setor.trim().toUpperCase();
      const tem = marcados.has(chave);
      const { error } = tem
        ? await (supabase as any).from("CS_FORM_ACESSOS").delete().eq("user_id", userId).eq("papel", papel).eq("setor", setor)
        : await (supabase as any).from("CS_FORM_ACESSOS").insert({ papel, user_id: userId, setor });
      if (error) { onToast(erroPerm(error.message), "err"); return; }
      setMarcados(s => { const n = new Set(s); tem ? n.delete(chave) : n.add(chave); return n; });
    },
    onLimpar: async () => {
      const { error } = await (supabase as any).from("CS_FORM_ACESSOS").delete().eq("user_id", userId).eq("papel", papel);
      if (error) { onToast(erroPerm(error.message), "err"); return; }
      setMarcados(() => new Set());
    },
  });
  const verSetorH = fazSetorHandlers("ver_setor", setoresVer, setSetoresVer);
  const criarSetorH = fazSetorHandlers("criar_setor", setoresCriar, setSetoresCriar);

  if (loading) return <div className="py-2 text-xs text-muted-foreground">Carregando permissoes...</div>;

  return (
    <div className="py-1">
      <div className="mb-1 text-[11.5px] text-muted-foreground">
        O que <b>este usuario</b> pode fazer nos formularios. <span className="text-muted-foreground/70">Responder ja e liberado a todos.</span>
      </div>
      <div className="divide-y divide-border/60">
        <CapToggles caps={caps} onToggle={toggle} />
        <SetorToggles
          titulo="Visualizar respostas por setor"
          descricao="Ver respostas dos formularios filtradas pelo setor de quem respondeu"
          rotuloLinha={(s) => `Visualizar respostas - ${s}`}
          descLinha={(s) => `Ver respostas de quem e do setor de ${s}`}
          ariaLinha={(s) => `Ver respostas de ${s}`}
          setores={setoresErp} marcados={setoresVer} onToggle={verSetorH.onToggle} onLimpar={verSetorH.onLimpar} />
        <SetorToggles
          titulo="Criar formularios por setor"
          descricao="Criar formularios de um setor e ver todas as respostas desses formularios"
          rotuloLinha={(s) => `Criar formularios - ${s}`}
          descLinha={(s) => `So cria formularios do ${s} e ve todas as respostas deles`}
          ariaLinha={(s) => `Criar formularios de ${s}`}
          setores={setoresErp} marcados={setoresCriar} onToggle={criarSetorH.onToggle} onLimpar={criarSetorH.onLimpar} />
      </div>
    </div>
  );
}

// ─── Perfis atribuídos (dentro de Acesso por Usuário) ───────────────────────────
// Grupos reutilizáveis de permissão — em vez de ligar switch por switch pra
// cada pessoa, o admin monta o perfil uma vez (aba "Perfis de Acesso") e só
// atribui aqui. Renderizado como mais uma linha da mesma árvore de módulos
// (mesmo padrão visual), só que cada "filho" é um perfil em vez de um menu.
// Os switches dos módulos abaixo continuam mostrando o acesso EFETIVO
// (perfil(is) + exceções) — mexer num switch individual de módulo/menu cria
// uma exceção só pra esta pessoa, sem tirar ela do(s) perfil(is).
function PerfisAtribuidosSection({ userId, podeGerenciar, expanded, onToggleExpand }: {
  userId: string; podeGerenciar: boolean; expanded: boolean; onToggleExpand: () => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const perfisQ = useQuery({
    queryKey: ["perfil_acesso_ativos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("perfil_acesso").select("id,nome,descricao,concede_tudo,ativo").eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as PerfilAcesso[];
    },
  });

  const atribuidosQ = useQuery({
    queryKey: ["usuario_perfil_acesso", userId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("usuario_perfil_acesso").select("perfil_id").eq("user_id", userId);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.perfil_id as string));
    },
  });

  const toggle = async (perfilId: string, atribuido: boolean) => {
    if (!podeGerenciar) return;
    setSaving(perfilId);
    try {
      if (atribuido) {
        const { error } = await (supabase as any).from("usuario_perfil_acesso").delete().eq("user_id", userId).eq("perfil_id", perfilId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("usuario_perfil_acesso").insert({ user_id: userId, perfil_id: perfilId });
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ["usuario_perfil_acesso", userId] });
      await qc.refetchQueries({ queryKey: ["effective-menus-for-user", userId] });
      toast({ title: "Perfis atualizados" });
    } catch (e: any) {
      toast({ title: "Erro ao atualizar perfil", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const perfis = perfisQ.data ?? [];
  const atribuidos = atribuidosQ.data ?? new Set<string>();
  const liberados = perfis.filter((p) => atribuidos.has(p.id)).length;

  return (
    <div>
      <div className="flex items-center gap-2 px-5 py-3 hover:bg-muted/40">
        {perfis.length > 0 ? (
          <button onClick={onToggleExpand} className="text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-4 w-4" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium">Perfis Atribuídos</p>
          <p className="text-[11px] font-mono text-muted-foreground">perfis_acesso</p>
        </div>
        <span className="text-xs text-muted-foreground">{liberados}/{perfis.length} perfis atribuídos</span>
      </div>

      {expanded && perfis.length > 0 && (
        <div className="divide-y divide-border/60 bg-muted/20">
          {perfis.length === 0 && (
            <p className="px-12 py-3 text-xs text-muted-foreground">Nenhum perfil cadastrado ainda — crie um em "Perfis de Acesso".</p>
          )}
          {perfis.map((p) => {
            const on = atribuidos.has(p.id);
            return (
              <div key={p.id} className="flex items-center gap-2 px-12 py-2.5 hover:bg-muted/40">
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-sm">
                    {p.concede_tudo && <Layers className="h-3.5 w-3.5 text-primary" />}
                    {p.nome}
                  </p>
                  {p.descricao && <p className="text-[11px] text-muted-foreground">{p.descricao}</p>}
                </div>
                <Switch
                  checked={on}
                  disabled={!podeGerenciar || saving === p.id}
                  onCheckedChange={() => toggle(p.id, on)}
                  aria-label={`Perfil ${p.nome}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

