import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, History, Layers, Save, Search, Trash2, Users } from "lucide-react";
import { useCargoCatalogo } from "@/components/admin/CargoCampo";
import {
  NIVEIS_CARGO, modeloDoGrupo, pessoasDoGrupo, planejarAplicacao, rotuloNivelCargo, telasDoGrupo,
  telasDoModeloParaPessoa, telasFaltando, telasForaDoModelo,
  type ModeloAcesso, type NivelCargo, type PessoaAcesso,
} from "@/lib/acessoPorSetorCargo";

// Tabelas e RPCs de 10/11/2026 (SIS-2026-0851) — fora do types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface Modulo { id: string; codigo: string; nome: string }
interface Menu { id: string; modulo_id: string; codigo: string; nome: string; rota: string | null; ativo: boolean }

const CLASSE_SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";
// acesso_efetivo_usuarios aceita até 300 ids por chamada (Encarregados, o maior grupo, tem ~94).
const MAX_GRUPO = 300;

// ─── Dados compartilhados ─────────────────────────────────────────────────

function useModelosAcesso() {
  const q = useQuery({
    queryKey: ["acesso_modelos"],
    retry: false,
    queryFn: async () => {
      const [m, t] = await Promise.all([
        sb.from("ACESSO_MODELO").select("id,setor,nivel"),
        sb.from("ACESSO_MODELO_TELA").select("modelo_id,menu_codigo"),
      ]);
      if (m.error) throw m.error;
      if (t.error) throw t.error;
      const telas = new Map<string, string[]>();
      for (const r of (t.data ?? []) as { modelo_id: string; menu_codigo: string }[]) {
        telas.set(r.modelo_id, [...(telas.get(r.modelo_id) ?? []), r.menu_codigo]);
      }
      return ((m.data ?? []) as { id: string; setor: string; nivel: NivelCargo | null }[])
        .map((x): ModeloAcesso => ({ id: x.id, setor: x.setor, nivel: x.nivel, telas: telas.get(x.id) ?? [] }));
    },
  });
  return { modelos: q.data ?? [], disponivel: !q.isError, carregando: q.isLoading };
}

/** Quem tem o perfil "concede tudo" — nunca recebe remoção em massa (J1.B). */
function useAdminGeral() {
  return useQuery({
    queryKey: ["acesso-admin-geral"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: perfis, error } = await sb.from("perfil_acesso").select("id").eq("concede_tudo", true).eq("ativo", true);
      if (error) throw error;
      const ids = ((perfis ?? []) as { id: string }[]).map((p) => p.id);
      if (ids.length === 0) return new Set<string>();
      const { data, error: e2 } = await sb.from("usuario_perfil_acesso").select("user_id").in("perfil_id", ids);
      if (e2) throw e2;
      return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
    },
  });
}

/** O que cada pessoa vê hoje — uma chamada para o grupo inteiro (guardião D7). */
function useEfetivo(ids: string[]) {
  const chave = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["acesso-efetivo-grupo", chave],
    enabled: ids.length > 0 && ids.length <= MAX_GRUPO,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("acesso_efetivo_usuarios", { _usuarios: ids, _acao: "visualizar" });
      if (error) throw error;
      const m = new Map<string, Set<string>>();
      for (const id of ids) m.set(id, new Set());
      for (const r of (data ?? []) as { user_id: string; menu_codigo: string }[]) m.get(r.user_id)?.add(r.menu_codigo);
      return m;
    },
  });
}

function invalidarAcessos(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["effective-menus-for-user", "effective-menus-acoes-for-user", "users-with-menu-access", "accessible-menus", "acesso-efetivo-grupo", "acesso_aplicacoes"]) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}

async function aplicar(params: { modeloId: string | null; setor: string | null; nivel: NivelCargo | null; linhas: unknown[] }) {
  const { data, error } = await sb.rpc("acesso_aplicar_em_massa", {
    _modelo_id: params.modeloId, _setor: params.setor, _nivel: params.nivel, _linhas: params.linhas,
  });
  if (error) throw error;
  return data as { id: number; linhas: number; pessoas: number };
}

const mesmoConjunto = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

// ─── Visão "Por Setor / Cargo" (Módulos & Menus) ──────────────────────────
//
// SIS-2026-0851 (Iury): liberar telas por setor e/ou cargo de uma vez. É o
// caso que faltava entre as duas visões vizinhas: "Acesso por Usuário" é 1
// pessoa × muitas telas, "Por Módulo" é 1 tela × muitas pessoas; aqui é
// muitas telas × muitas pessoas. Grava a MESMA coisa que elas (linha por
// pessoa em screen_permission_user) — a regra está em acessoPorSetorCargo.ts.
export function AcessoPorSetorCargoPanel({ podeGerenciar, modulos, menus, menusComAjustePorPessoa }: {
  podeGerenciar: boolean;
  modulos: Modulo[];
  menus: Menu[];
  /** Telas com configuração fina por pessoa (setores do Malote, papéis de Formulários…) que o modelo não cobre. */
  menusComAjustePorPessoa: readonly string[];
}) {
  const qc = useQueryClient();
  const { cargos } = useCargoCatalogo();
  const { modelos, disponivel: modelosDisponiveis } = useModelosAcesso();
  const adminGeralQ = useAdminGeral();
  const adminGeral = adminGeralQ.data ?? new Set<string>();

  const setoresQ = useQuery({
    queryKey: ["setores_catalogo"],
    queryFn: async () => {
      const { data, error } = await sb.from("setor_catalogo").select("nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as { nome: string }[]).map((r) => r.nome);
    },
  });
  const perfisQ = useQuery({
    queryKey: ["acesso-massa-pessoas"],
    queryFn: async () => {
      const { data, error } = await sb.from("profiles").select("id,display_name,email,cargo,ativo").order("display_name");
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string | null; email: string | null; cargo: string | null; ativo: boolean }[];
    },
  });
  const userSetoresQ = useQuery({
    queryKey: ["all-user-setores"],
    queryFn: async () => {
      const { data, error } = await sb.from("user_setor").select("user_id,setor");
      if (error) throw error;
      return (data ?? []) as { user_id: string; setor: string }[];
    },
  });

  const pessoas = useMemo<PessoaAcesso[]>(() => {
    const nivelPorCargo = new Map(cargos.map((c) => [c.nome, c.nivel] as const));
    const setores = new Map<string, string[]>();
    for (const r of userSetoresQ.data ?? []) setores.set(r.user_id, [...(setores.get(r.user_id) ?? []), r.setor]);
    return (perfisQ.data ?? []).map((p) => ({
      id: p.id,
      nome: p.display_name || p.email || p.id,
      cargo: p.cargo,
      nivel: p.cargo ? nivelPorCargo.get(p.cargo) ?? null : null,
      setores: setores.get(p.id) ?? [],
      ativo: p.ativo,
    }));
  }, [perfisQ.data, userSetoresQ.data, cargos]);
  const nomePorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome] as const)), [pessoas]);

  const menusAtivos = useMemo(() => menus.filter((m) => m.ativo), [menus]);
  const menusValidos = useMemo(() => new Set(menusAtivos.map((m) => m.codigo)), [menusAtivos]);
  const nomeDoMenu = useMemo(() => new Map(menusAtivos.map((m) => [m.codigo, m.nome] as const)), [menusAtivos]);

  const [setor, setSetor] = useState("");
  const [nivel, setNivel] = useState<NivelCargo | null>(null);
  const [edicao, setEdicao] = useState<Set<string> | null>(null);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [previaAberta, setPreviaAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setEdicao(null); setExcluidos(new Set()); }, [setor, nivel]);

  const grupo = useMemo(() => (setor ? pessoasDoGrupo(pessoas, setor, nivel) : []), [pessoas, setor, nivel]);
  const selecionados = useMemo(() => grupo.filter((p) => !excluidos.has(p.id)), [grupo, excluidos]);
  const efetivoQ = useEfetivo(grupo.map((p) => p.id));
  const efetivo = efetivoQ.data;

  const modeloSalvo = setor ? modeloDoGrupo(modelos, setor, nivel) : null;
  const salvas = useMemo(() => new Set(modeloSalvo?.telas ?? []), [modeloSalvo]);
  const proprias = edicao ?? salvas;
  const doSetor = useMemo(() => new Set(nivel && setor ? modeloDoGrupo(modelos, setor, null)?.telas ?? [] : []), [modelos, setor, nivel]);
  const pendente = edicao !== null && !mesmoConjunto(edicao, salvas);
  const totalNoModelo = new Set([...proprias, ...doSetor].filter((t) => menusValidos.has(t))).size;

  const alternar = (codigos: string[], ligar: boolean) => {
    setEdicao((prev) => {
      const next = new Set(prev ?? salvas);
      for (const c of codigos) { if (ligar) next.add(c); else next.delete(c); }
      return next;
    });
  };

  const salvarModelo = async () => {
    if (!setor) return;
    setSalvando(true);
    try {
      const { error } = await sb.rpc("acesso_modelo_salvar", { _setor: setor, _nivel: nivel, _telas: [...proprias] });
      if (error) throw error;
      await qc.refetchQueries({ queryKey: ["acesso_modelos"] });
      setEdicao(null);
      toast({ title: "Modelo salvo", description: "Nada mudou para ninguém ainda — use \"Aplicar\" para liberar." });
    } catch (e) {
      toast({ title: "Erro ao salvar o modelo", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const excluirModelo = async () => {
    if (!modeloSalvo) return;
    const { error } = await sb.from("ACESSO_MODELO").delete().eq("id", modeloSalvo.id);
    if (error) { toast({ title: "Erro ao excluir o modelo", description: error.message, variant: "destructive" }); return; }
    await qc.refetchQueries({ queryKey: ["acesso_modelos"] });
    setEdicao(null);
    toast({ title: "Modelo excluído", description: "Os acessos já aplicados continuam como estão." });
  };

  const copiarDePessoa = async (userId: string) => {
    const { data, error } = await supabase.rpc("list_accessible_menus", { _user: userId, _acao: "visualizar", _empresa: null });
    if (error) { toast({ title: "Não foi possível ler os acessos", description: error.message, variant: "destructive" }); return; }
    setEdicao(new Set(((data ?? []) as { menu_codigo: string }[]).map((r) => r.menu_codigo).filter((c) => menusValidos.has(c))));
    toast({ title: `Telas de ${nomePorId.get(userId) ?? "a pessoa"} copiadas`, description: "Confira e salve o modelo." });
  };

  const q = busca.trim().toLowerCase();
  const arvore = useMemo(() => modulos.map((m) => ({
    modulo: m,
    telas: menusAtivos.filter((mn) => mn.modulo_id === m.id
      && (!q || mn.nome.toLowerCase().includes(q) || mn.codigo.toLowerCase().includes(q) || m.nome.toLowerCase().includes(q))),
  })).filter((x) => x.telas.length > 0), [modulos, menusAtivos, q]);

  if (!modelosDisponiveis) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        A liberação por Setor / Cargo ainda não está no banco (migration do SIS-2026-0851 pendente).
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-muted/30 px-5 py-3">
        <label className="space-y-1 text-xs font-medium">
          <span className="block">Setor</span>
          <select className={cn(CLASSE_SELECT, "w-56")} value={setor} onChange={(e) => setSetor(e.target.value)}>
            <option value="">Escolha um setor…</option>
            {(setoresQ.data ?? []).map((s) => (
              <option key={s} value={s}>{s} ({pessoasDoGrupo(pessoas, s, null).length})</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span className="block">Nível do cargo</span>
          <select className={cn(CLASSE_SELECT, "w-48")} value={nivel ?? ""} onChange={(e) => setNivel((e.target.value || null) as NivelCargo | null)} disabled={!setor}>
            <option value="">Todos os níveis{setor ? ` (${pessoasDoGrupo(pessoas, setor, null).length})` : ""}</option>
            {NIVEIS_CARGO.map((n) => (
              <option key={n.codigo} value={n.codigo}>{n.rotulo}{setor ? ` (${pessoasDoGrupo(pessoas, setor, n.codigo).length})` : ""}</option>
            ))}
          </select>
        </label>
        <p className="max-w-md flex-1 text-[11px] text-muted-foreground">
          Monte as telas de um grupo e aplique a todos de uma vez. Grava o mesmo que o switch de "Acesso por Usuário",
          pessoa a pessoa — quem entrar no grupo depois recebe pelo botão no cadastro do usuário.
        </p>
      </div>

      {!setor && (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Escolha um setor (e, se quiser, um nível de cargo) para montar o acesso do grupo.</p>
      )}

      {setor && (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── Telas do modelo ── */}
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <p className="flex-1 text-sm font-semibold">
                Telas de {setor} · {rotuloNivelCargo(nivel)} <span className="font-normal text-muted-foreground">— {totalNoModelo} tela(s)</span>
              </p>
              {pendente && <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">não salvo</Badge>}
              {podeGerenciar && (
                <>
                  <CopiarDe modelos={modelos} pessoas={pessoas.filter((p) => p.ativo)} atual={modeloSalvo?.id ?? null}
                    onModelo={(m) => setEdicao(new Set(m.telas))} onPessoa={copiarDePessoa} />
                  {pendente && <Button size="sm" variant="ghost" className="h-8" onClick={() => setEdicao(null)}>Descartar</Button>}
                  <Button size="sm" className="h-8 gap-1.5" onClick={salvarModelo} disabled={!pendente || salvando}>
                    <Save className="h-3.5 w-3.5" /> {salvando ? "Salvando…" : "Salvar modelo"}
                  </Button>
                  {modeloSalvo && !pendente && (
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" title="Excluir o modelo deste grupo" onClick={excluirModelo}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="border-b border-border px-5 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar tela ou módulo…" className="h-8 pl-8 text-xs" />
              </div>
            </div>
            <div className="max-h-[560px] divide-y divide-border overflow-y-auto">
              {arvore.map(({ modulo, telas }) => {
                const editaveis = telas.filter((t) => !doSetor.has(t.codigo));
                const marcadas = telas.filter((t) => proprias.has(t.codigo) || doSetor.has(t.codigo)).length;
                const todas = editaveis.length > 0 && editaveis.every((t) => proprias.has(t.codigo));
                const aberto = abertos.has(modulo.id) || !!q;
                return (
                  <div key={modulo.id}>
                    <div className="flex items-center gap-2 px-5 py-2.5 hover:bg-muted/40">
                      <button onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(modulo.id)) n.delete(modulo.id); else n.add(modulo.id); return n; })} className="text-muted-foreground">
                        {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <Checkbox
                        checked={todas ? true : marcadas > 0 ? "indeterminate" : false}
                        disabled={!podeGerenciar || editaveis.length === 0}
                        onCheckedChange={() => alternar(editaveis.map((t) => t.codigo), !todas)}
                        aria-label={`Todas as telas de ${modulo.nome}`}
                      />
                      <p className="flex-1 text-sm font-medium">{modulo.nome}</p>
                      <span className="text-xs text-muted-foreground">{marcadas}/{telas.length}</span>
                    </div>
                    {aberto && (
                      <div className="bg-muted/20">
                        {telas.map((t) => {
                          const herdada = doSetor.has(t.codigo);
                          const marcada = herdada || proprias.has(t.codigo);
                          const veem = efetivo ? grupo.filter((p) => efetivo.get(p.id)?.has(t.codigo)).length : null;
                          return (
                            <label key={t.id} className={cn("flex items-center gap-2 py-2 pl-14 pr-5 hover:bg-muted/40", edicao && marcada !== salvas.has(t.codigo) && !herdada && "bg-amber-50/50 dark:bg-amber-950/20")}>
                              <Checkbox
                                checked={marcada}
                                disabled={!podeGerenciar || herdada}
                                onCheckedChange={() => alternar([t.codigo], !proprias.has(t.codigo))}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{t.nome}</span>
                                <span className="block truncate font-mono text-[10px] text-muted-foreground">{t.codigo}{t.rota ? ` · ${t.rota}` : ""}</span>
                              </span>
                              {herdada && <Badge variant="secondary" className="text-[10px]" title={`Vem do modelo "${setor} · Todos os níveis"`}>do setor</Badge>}
                              {veem !== null && grupo.length > 0 && (
                                <span className="shrink-0 text-[11px] text-muted-foreground" title="Quantas pessoas do grupo já veem esta tela">{veem}/{grupo.length}</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Pessoas, aplicar e histórico ── */}
          <div className="space-y-4 p-4">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-4 w-4 text-muted-foreground" /> Pessoas do grupo ({grupo.length})
              </p>
              {grupo.length > MAX_GRUPO && (
                <p className="text-xs text-destructive">Grupo grande demais para uma aplicação ({grupo.length}). Escolha um nível.</p>
              )}
              {grupo.length === 0 && <p className="text-xs text-muted-foreground">Ninguém neste setor{nivel ? " com este nível" : ""}.</p>}
              <div className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
                {grupo.map((p) => {
                  const ehAdmin = adminGeral.has(p.id);
                  const faltam = efetivo ? telasFaltando(p, modelos, efetivo, menusValidos).length : null;
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/40">
                      <Checkbox
                        checked={!excluidos.has(p.id)}
                        disabled={!podeGerenciar}
                        onCheckedChange={() => setExcluidos((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.nome}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{p.cargo ?? "sem cargo"}{p.nivel ? ` · ${rotuloNivelCargo(p.nivel)}` : ""}</span>
                      </span>
                      {ehAdmin ? (
                        <Badge variant="outline" className="shrink-0 text-[10px]">Admin Geral</Badge>
                      ) : faltam === null ? null : faltam === 0 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Tem todas as telas do modelo" />
                      ) : (
                        <Badge variant="outline" className="shrink-0 border-amber-400 text-[10px] text-amber-700">faltam {faltam}</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {podeGerenciar && (
              <div className="space-y-1.5">
                <Button className="w-full gap-1.5" onClick={() => setPreviaAberta(true)}
                  disabled={pendente || selecionados.length === 0 || !efetivo || grupo.length > MAX_GRUPO}>
                  <Users className="h-4 w-4" /> Aplicar às {selecionados.length} pessoa(s)…
                </Button>
                {pendente && <p className="text-[11px] text-amber-700">Salve o modelo antes de aplicar.</p>}
                {!pendente && efetivoQ.isLoading && <p className="text-[11px] text-muted-foreground">Lendo o acesso atual do grupo…</p>}
              </div>
            )}

            <Historico nomePorId={nomePorId} />
          </div>
        </div>
      )}

      {previaAberta && efetivo && (
        <PreviaAplicacao
          aberta={previaAberta}
          onFechar={() => setPreviaAberta(false)}
          setor={setor}
          nivel={nivel}
          modeloId={modeloSalvo?.id ?? null}
          pessoas={selecionados}
          modelos={modelos}
          efetivo={efetivo}
          adminGeral={adminGeral}
          menusValidos={menusValidos}
          nomeDoMenu={nomeDoMenu}
          menusComAjustePorPessoa={menusComAjustePorPessoa}
          onAplicado={() => invalidarAcessos(qc)}
        />
      )}
    </div>
  );
}

function CopiarDe({ modelos, pessoas, atual, onModelo, onPessoa }: {
  modelos: ModeloAcesso[];
  pessoas: PessoaAcesso[];
  atual: string | null;
  onModelo: (m: ModeloAcesso) => void;
  onPessoa: (userId: string) => void;
}) {
  const outros = modelos.filter((m) => m.id !== atual)
    .sort((a, b) => `${a.setor}${a.nivel ?? ""}`.localeCompare(`${b.setor}${b.nivel ?? ""}`, "pt-BR"));
  return (
    <select
      className="h-8 max-w-[200px] rounded-md border border-input bg-background px-2 text-xs"
      value=""
      aria-label="Copiar telas de outro grupo ou de uma pessoa"
      onChange={(e) => {
        const [tipo, id] = e.target.value.split(":");
        if (tipo === "m") { const m = modelos.find((x) => x.id === id); if (m) onModelo(m); }
        if (tipo === "p" && id) onPessoa(id);
      }}
    >
      <option value="">Copiar de…</option>
      {outros.length > 0 && (
        <optgroup label="Outro grupo">
          {outros.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.setor} · {rotuloNivelCargo(m.nivel)} ({m.telas.length})</option>)}
        </optgroup>
      )}
      <optgroup label="Uma pessoa (as telas que ela vê hoje)">
        {pessoas.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.nome}</option>)}
      </optgroup>
    </select>
  );
}

function PreviaAplicacao({
  aberta, onFechar, setor, nivel, modeloId, pessoas, modelos, efetivo, adminGeral, menusValidos, nomeDoMenu, menusComAjustePorPessoa, onAplicado,
}: {
  aberta: boolean;
  onFechar: () => void;
  setor: string;
  nivel: NivelCargo | null;
  modeloId: string | null;
  pessoas: PessoaAcesso[];
  modelos: ModeloAcesso[];
  efetivo: Map<string, Set<string>>;
  adminGeral: Set<string>;
  menusValidos: Set<string>;
  nomeDoMenu: Map<string, string>;
  menusComAjustePorPessoa: readonly string[];
  onAplicado: () => void;
}) {
  const [remover, setRemover] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState(false);

  const liberar = useMemo(() => telasDoGrupo(modelos, setor, nivel), [modelos, setor, nivel]);
  const fora = useMemo(
    () => [...telasForaDoModelo(pessoas, modelos, efetivo, adminGeral, menusValidos)]
      .sort((a, b) => (nomeDoMenu.get(a[0]) ?? a[0]).localeCompare(nomeDoMenu.get(b[0]) ?? b[0], "pt-BR")),
    [pessoas, modelos, efetivo, adminGeral, menusValidos, nomeDoMenu],
  );
  const plano = useMemo(
    () => planejarAplicacao({ pessoas, liberar, remover, efetivo, adminGeral, menusValidos }),
    [pessoas, liberar, remover, efetivo, adminGeral, menusValidos],
  );

  const resumo = useMemo(() => {
    let pessoasLiberar = 0, pessoasRemover = 0;
    const telasLiberadas = new Set<string>(), telasRemovidas = new Set<string>();
    for (const r of plano.porPessoa.values()) {
      if (r.liberar.length) pessoasLiberar++;
      if (r.remover.length) pessoasRemover++;
      r.liberar.forEach((t) => telasLiberadas.add(t));
      r.remover.forEach((t) => telasRemovidas.add(t));
    }
    return { pessoasLiberar, pessoasRemover, telasLiberadas, telasRemovidas };
  }, [plano]);

  const comAjuste = [...liberar].filter((t) => menusComAjustePorPessoa.includes(t) && menusValidos.has(t));
  const adminsNoGrupo = pessoas.filter((p) => adminGeral.has(p.id)).length;

  const confirmar = async () => {
    setAplicando(true);
    try {
      const r = await aplicar({ modeloId, setor, nivel, linhas: plano.linhas });
      toast({ title: `Aplicado (#${r.id})`, description: `${r.linhas} permissões gravadas para ${r.pessoas} pessoa(s). Quem estiver com o ERP aberto vê a mudança ao recarregar a página.` });
      onAplicado();
      onFechar();
    } catch (e) {
      toast({ title: "Erro ao aplicar — nada foi alterado", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <Dialog open={aberta} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aplicar a {setor} · {rotuloNivelCargo(nivel)}</DialogTitle>
          <DialogDescription>Confira antes de gravar. Nada muda até você confirmar, e a gravação é tudo ou nada.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-success/40 bg-success/5 p-3">
            <p className="font-semibold">Liberar: {resumo.telasLiberadas.size} tela(s) para {resumo.pessoasLiberar} pessoa(s)</p>
            <p className="text-xs text-muted-foreground">
              Já tinham — não mexe: {plano.jaTem} {plano.jaTem === 1 ? "caso" : "casos"} (pessoa × tela). Quem já vê a tela fica com as ações como estão.
            </p>
            {resumo.telasLiberadas.size > 0 && (
              <p className="mt-1 text-xs">{[...resumo.telasLiberadas].map((t) => nomeDoMenu.get(t) ?? t).join(" · ")}</p>
            )}
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="font-semibold">Fora do modelo</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Telas que alguém do grupo tem e o modelo não dá. Só sai o que você marcar.
            </p>
            {fora.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma — o grupo só tem telas do modelo.</p>}
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {fora.map(([tela, qtd]) => (
                <label key={tela} className="flex items-center gap-2 text-xs">
                  <Checkbox checked={remover.has(tela)} onCheckedChange={() => setRemover((s) => { const n = new Set(s); if (n.has(tela)) n.delete(tela); else n.add(tela); return n; })} />
                  <span className="flex-1">{nomeDoMenu.get(tela) ?? tela}</span>
                  <span className="text-muted-foreground">{qtd} pessoa(s)</span>
                </label>
              ))}
            </div>
            {resumo.telasRemovidas.size > 0 && (
              <p className="mt-2 text-xs font-medium text-destructive">Remover: {resumo.telasRemovidas.size} tela(s) de {resumo.pessoasRemover} pessoa(s)</p>
            )}
          </div>

          {adminsNoGrupo > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {adminsNoGrupo} Administrador(es) Geral(is) no grupo: recebem as liberações, mas nunca remoção em massa.
            </p>
          )}

          {comAjuste.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>
                {comAjuste.map((t) => nomeDoMenu.get(t) ?? t).join(", ")}: além da tela, têm ajuste por pessoa (setores, papéis) que
                o modelo não cobre — configure em "Acesso por Usuário".
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={aplicando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={aplicando || plano.linhas.length === 0}>
            {aplicando ? "Aplicando…" : plano.linhas.length === 0 ? "Nada a mudar" : `Aplicar (${plano.linhas.length} permissões)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Historico({ nomePorId }: { nomePorId: Map<string, string> }) {
  const q = useQuery({
    queryKey: ["acesso_aplicacoes"],
    queryFn: async () => {
      // Sem a coluna `antes` (o estado anterior, que pode ter milhares de linhas).
      const { data, error } = await sb.from("ACESSO_APLICACAO_MASSA")
        .select("id,setor,nivel,usuarios,liberadas,removidas,linhas,aplicado_por,aplicado_em")
        .order("aplicado_em", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as {
        id: number; setor: string | null; nivel: NivelCargo | null; usuarios: string[]; liberadas: string[];
        removidas: string[]; linhas: number; aplicado_por: string | null; aplicado_em: string;
      }[];
    },
  });
  if (!q.data?.length) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4 text-muted-foreground" /> Últimas aplicações</p>
      <div className="space-y-1.5">
        {q.data.map((a) => (
          <div key={a.id} className="rounded-md border border-border px-2.5 py-1.5 text-[11px]">
            <p className="font-medium">#{a.id} · {a.setor ?? "—"} · {rotuloNivelCargo(a.nivel)}</p>
            <p className="text-muted-foreground">
              {new Date(a.aplicado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              {" · "}{a.usuarios.length} pessoa(s) · +{a.liberadas.length} / −{a.removidas.length} tela(s)
              {a.aplicado_por ? ` · ${nomePorId.get(a.aplicado_por) ?? "—"}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Cadastro de usuário: "dar as mesmas telas do grupo" ──────────────────
//
// Quem entra no setor depois NÃO ganha sozinho (decisão do Eduardo,
// 10/11/2026 — automático exigiria mexer nas funções de acesso). Este bloco
// aparece logo depois de criar o usuário e aplica, para ele só, a soma dos
// modelos do(s) setor(es) e do nível do cargo dele.
export function AplicarModeloNovoUsuario({ userId, setores, cargo }: { userId: string; setores: string[]; cargo: string | null }) {
  const qc = useQueryClient();
  const { cargos } = useCargoCatalogo();
  const { modelos, disponivel } = useModelosAcesso();
  const [aplicado, setAplicado] = useState<number | null>(null);
  const [aplicando, setAplicando] = useState(false);

  const menusQ = useQuery({
    queryKey: ["acesso-menus-validos"],
    enabled: disponivel,
    queryFn: async () => {
      const { data, error } = await sb.from("app_menu").select("codigo").eq("ativo", true);
      if (error) throw error;
      return new Set(((data ?? []) as { codigo: string }[]).map((r) => r.codigo));
    },
  });

  const nivel = cargos.find((c) => c.nome === cargo)?.nivel ?? null;
  const pessoa: PessoaAcesso = { id: userId, nome: "", cargo, nivel, setores, ativo: true };
  const menusValidos = menusQ.data ?? new Set<string>();
  const telas = [...telasDoModeloParaPessoa(modelos, pessoa)].filter((t) => menusValidos.has(t));

  if (!disponivel || setores.length === 0 || telas.length === 0) return null;

  const grupo = `${setores.join(" + ")} · ${rotuloNivelCargo(nivel)}`;

  const aplicarAgora = async () => {
    setAplicando(true);
    try {
      const { data, error } = await sb.rpc("acesso_efetivo_usuarios", { _usuarios: [userId], _acao: "visualizar" });
      if (error) throw error;
      const efetivo = new Map([[userId, new Set(((data ?? []) as { menu_codigo: string }[]).map((r) => r.menu_codigo))]]);
      const plano = planejarAplicacao({ pessoas: [pessoa], liberar: telas, remover: [], efetivo, adminGeral: new Set(), menusValidos });
      if (plano.linhas.length === 0) { setAplicado(0); return; }
      const r = await aplicar({ modeloId: null, setor: setores.join(", "), nivel, linhas: plano.linhas });
      setAplicado(plano.porPessoa.get(userId)?.liberar.length ?? 0);
      invalidarAcessos(qc);
      toast({ title: "Acesso do grupo aplicado", description: `${r.linhas} permissões gravadas.` });
    } catch (e) {
      toast({ title: "Erro ao aplicar o acesso do grupo", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
      <p className="font-semibold">Acesso do grupo {grupo}</p>
      {aplicado === null ? (
        <>
          <p className="mb-2 text-muted-foreground">Existe modelo de acesso para este grupo: {telas.length} tela(s). Dar a esta pessoa as mesmas telas?</p>
          <Button size="sm" className="gap-1.5" onClick={aplicarAgora} disabled={aplicando}>
            <Copy className="h-3.5 w-3.5" /> {aplicando ? "Aplicando…" : `Aplicar ${telas.length} tela(s)`}
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> {aplicado} tela(s) liberada(s).</p>
      )}
    </div>
  );
}
