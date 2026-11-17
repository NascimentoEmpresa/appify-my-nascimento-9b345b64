import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Briefcase, Building2, Lock, LockOpen, Search, ShieldCheck, UserRound, Users } from "lucide-react";
import {
  bloquearNovoModulo, invalidarNovosModulos, salvarNovoModulo, useAcessosNovoModulo, usePessoasParaAcesso,
} from "@/hooks/useNovosModulos";
import {
  ROTULO_TIPO, acessoEfetivoAposSalvar, concedidosFinais, individuaisLiberados, pessoasDaSelecao,
  planejarLinhasNovoModulo, resumoLiberacao, type NovoModulo,
} from "@/lib/novosModulos";

// Modal "Configurar acesso" da aba Novos Módulos (SIS-2026-0931).
//
// Três jeitos de escolher quem vê — pessoa, setor, cargo — e um só jeito de
// gravar: linha por pessoa em screen_permission_user, com o pacote do toggle
// (regras em src/lib/novosModulos.ts, com teste). Setor e cargo são atalhos:
// marcam as pessoas de HOJE; quem entrar depois não recebe sozinho (mesma
// decisão da SIS-2026-0851).
//
// O que o desenvolvedor deixou preparado na migration da tela (pessoas e
// perfis) aparece pré-marcado. Enquanto a tela está pendente nada disso vale:
// só passa a valer quando alguém salva aqui com pelo menos uma pessoa.
export function ConfigurarAcessoNovoModulo({ tela, podeGerenciar, onFechar }: {
  tela: NovoModulo;
  podeGerenciar: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const acessosQ = useAcessosNovoModulo(tela.codigo);
  const { pessoas, setores, cargos, carregando: carregandoPessoas } = usePessoasParaAcesso();
  const gravado = acessosQ.data;
  const pendente = tela.situacao === "pendente";

  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [setoresSel, setSetoresSel] = useState<Set<string>>(new Set());
  const [cargosSel, setCargosSel] = useState<Set<string>>(new Set());
  const [perfisMantidos, setPerfisMantidos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<"revogar" | "bloquear" | null>(null);

  // Pré-marcado: o que está gravado hoje. Uma vez por abertura — refetch em
  // segundo plano não pode apagar o que o admin já mexeu.
  const [iniciado, setIniciado] = useState(false);
  useEffect(() => {
    if (!gravado || iniciado) return;
    setMarcados(individuaisLiberados(gravado));
    setPerfisMantidos(new Set(gravado.perfis.map((p) => p.id)));
    setIniciado(true);
  }, [gravado, iniciado]);

  const preparados = useMemo(() => (gravado ? individuaisLiberados(gravado) : new Set<string>()), [gravado]);
  const negadosAntes = useMemo(
    () => new Set((gravado?.individuais ?? []).filter((i) => !i.allow).map((i) => i.user_id)),
    [gravado],
  );
  const viaGrupo = useMemo(() => pessoasDaSelecao(pessoas, setoresSel, cargosSel), [pessoas, setoresSel, cargosSel]);
  const concedidos = useMemo(() => concedidosFinais(marcados, viaGrupo), [marcados, viaGrupo]);
  const ativoPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p.ativo] as const)), [pessoas]);
  const efetivo = useMemo(() => {
    if (!gravado) return new Set<string>();
    // Login inativo não conta na prévia (o banco também não o conta).
    return new Set([...acessoEfetivoAposSalvar({ gravado, concedidos, perfisMantidos })].filter((id) => ativoPorId.get(id) !== false));
  }, [gravado, concedidos, perfisMantidos, ativoPorId]);
  const plano = useMemo(
    () => planejarLinhasNovoModulo(tela.codigo, gravado ?? { individuais: [] }, concedidos),
    [tela.codigo, gravado, concedidos],
  );
  const perfisRemover = useMemo(
    () => (gravado?.perfis ?? []).filter((p) => !perfisMantidos.has(p.id)).map((p) => p.id),
    [gravado, perfisMantidos],
  );
  const mudou = plano.linhas.length > 0 || perfisRemover.length > 0;

  // Na grade: quem está ativo, mais quem tem algo gravado (para poder tirar).
  const q = busca.trim().toLocaleLowerCase("pt-BR");
  const pessoasDaGrade = useMemo(() => pessoas
    .filter((p) => p.ativo || preparados.has(p.id) || negadosAntes.has(p.id))
    .filter((p) => !q || p.nome.toLocaleLowerCase("pt-BR").includes(q) || (p.cargo ?? "").toLocaleLowerCase("pt-BR").includes(q)
      || p.setores.some((s) => s.toLocaleLowerCase("pt-BR").includes(q))),
  [pessoas, preparados, negadosAntes, q]);

  const contagemSetor = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pessoas) if (p.ativo) for (const s of p.setores) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  }, [pessoas]);
  const contagemCargo = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pessoas) if (p.ativo && p.cargo) m.set(p.cargo, (m.get(p.cargo) ?? 0) + 1);
    return m;
  }, [pessoas]);
  const cargosComGente = cargos.filter((c) => (contagemCargo.get(c) ?? 0) > 0);

  const alternar = (setter: (fn: (s: Set<string>) => Set<string>) => void, valor: string) =>
    setter((s) => { const n = new Set(s); if (n.has(valor)) n.delete(valor); else n.add(valor); return n; });

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarNovoModulo({
        codigo: tela.codigo,
        linhas: plano.linhas,
        perfisRemover,
        setores: [...setoresSel].sort(),
        cargos: [...cargosSel].sort(),
      });
      invalidarNovosModulos(qc);
      toast({
        title: r.situacao === "liberado" ? `${tela.nome} liberada` : `${tela.nome} continua bloqueada`,
        description: r.situacao === "liberado"
          ? `${r.pessoas} pessoa(s) com acesso. Quem estiver com o ERP aberto vê a tela ao recarregar a página.`
          : "Ninguém acessa esta tela até ela ser liberada com pelo menos uma pessoa.",
      });
      onFechar();
    } catch (e) {
      toast({ title: "Erro ao salvar — nada foi alterado", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSalvando(false);
      setConfirmar(null);
    }
  };

  const revogar = async () => {
    setSalvando(true);
    try {
      await bloquearNovoModulo(tela.codigo);
      invalidarNovosModulos(qc);
      toast({ title: `${tela.nome} bloqueada para todos`, description: "As pessoas continuam pré-marcadas caso a tela seja liberada de novo." });
      onFechar();
    } catch (e) {
      toast({ title: "Erro ao bloquear — nada foi alterado", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSalvando(false);
      setConfirmar(null);
    }
  };

  // Salvar com 0 pessoas numa tela que está no ar = bloquear: pede confirmação.
  const pedirSalvar = () => {
    if (!pendente && efetivo.size === 0) { setConfirmar("bloquear"); return; }
    void salvar();
  };

  const rotuloSalvar = salvando ? "Salvando…"
    : pendente ? (efetivo.size > 0 ? `Liberar para ${efetivo.size} pessoa(s)` : "Salvar (continua bloqueada)")
    : efetivo.size === 0 ? "Salvar e bloquear"
    : "Salvar permissões";

  const carregando = acessosQ.isLoading || carregandoPessoas || !iniciado;

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && !salvando) onFechar(); }}>
        <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle>{podeGerenciar ? "Configurar acesso" : "Acesso"} — {tela.nome}</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {tela.modulo_nome ?? "—"} · {ROTULO_TIPO[tela.tipo]} · {tela.codigo}{tela.rota ? ` · ${tela.rota}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex gap-2.5 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="space-y-1">
                {pendente ? (
                  <p><b>Esta tela está bloqueada para todos</b> — inclusive Administrador Geral e quem tem o perfil do módulo — até você salvar com pelo menos uma pessoa.</p>
                ) : (
                  <p><b>Esta tela está liberada.</b> Salvar com zero pessoas, ou "Revogar todos os acessos", volta a bloqueá-la para todos.</p>
                )}
                <p className="text-muted-foreground">
                  Vale só para esta tela: liberar aqui não dá acesso a nenhuma outra. Setor e cargo marcam as pessoas de hoje — quem
                  entrar depois não recebe sozinho.
                </p>
                {tela.tipo === "acao" && (
                  <p className="text-muted-foreground">É uma <b>ação</b> (uma permissão dentro de outra tela), não uma tela com endereço próprio.</p>
                )}
              </div>
            </div>

            {acessosQ.isError && (
              <p className="text-sm text-destructive">Não foi possível ler os acessos desta tela: {(acessosQ.error as Error)?.message}</p>
            )}

            {carregando && !acessosQ.isError && <p className="py-6 text-center text-sm text-muted-foreground">Carregando acessos…</p>}

            {!carregando && gravado && (
              <>
                {pendente && (preparados.size > 0 || gravado.perfis.length > 0) && (
                  <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                    O desenvolvedor deixou preparado: <b className="text-foreground">{preparados.size} pessoa(s)</b>
                    {gravado.perfis.length > 0 && <> e <b className="text-foreground">{gravado.perfis.length} perfil(is)</b></>}.
                    Estão pré-marcados abaixo, mas <b className="text-foreground">nada disso vale até você salvar</b>. Desmarque o que não deve ficar.
                  </p>
                )}

                {/* ── Pessoas ── */}
                <section className="rounded-md border border-border">
                  <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                    <UserRound className="h-4 w-4 text-muted-foreground" />
                    <p className="flex-1 text-sm font-semibold">Liberação por usuário <span className="font-normal text-muted-foreground">— {concedidos.size} marcada(s)</span></p>
                    <div className="relative w-full sm:w-56">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa, cargo ou setor…" className="h-8 pl-8 text-xs" />
                    </div>
                  </header>
                  <div className="grid max-h-64 grid-cols-1 gap-x-3 overflow-y-auto p-2 sm:grid-cols-2">
                    {pessoasDaGrade.length === 0 && <p className="col-span-full py-4 text-center text-xs text-muted-foreground">Ninguém encontrado.</p>}
                    {pessoasDaGrade.map((p) => {
                      const motivos = viaGrupo.get(p.id);
                      const marcado = concedidos.has(p.id);
                      const mudouAqui = marcado !== preparados.has(p.id);
                      return (
                        <label key={p.id} className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40", mudouAqui && "bg-amber-50/60 dark:bg-amber-950/20")}>
                          <Checkbox
                            checked={marcado}
                            disabled={!podeGerenciar || !!motivos}
                            onCheckedChange={() => alternar(setMarcados, p.id)}
                            aria-label={`Liberar para ${p.nome}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{p.nome}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {motivos ? `via ${motivos.join(" + ")}` : [p.cargo, p.setores.join(", ")].filter(Boolean).join(" · ") || "sem cargo/setor"}
                            </span>
                          </span>
                          {preparados.has(p.id) && (
                            <Badge variant="outline" className="shrink-0 text-[10px]" title={pendente ? "Gravado na criação da tela; só vale depois de salvar." : "Já tem liberação individual."}>
                              {pendente ? "preparado" : "liberado"}
                            </Badge>
                          )}
                          {negadosAntes.has(p.id) && !marcado && (
                            <Badge variant="outline" className="shrink-0 border-destructive/40 text-[10px] text-destructive" title="Tem bloqueio individual nesta tela.">negado</Badge>
                          )}
                          {!p.ativo && <Badge variant="secondary" className="shrink-0 text-[10px]">inativo</Badge>}
                        </label>
                      );
                    })}
                  </div>
                </section>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* ── Setores ── */}
                  <section className="rounded-md border border-border">
                    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-semibold">Liberação por setor</p>
                    </header>
                    <p className="px-3 pt-2 text-[11px] text-muted-foreground">Marca todas as pessoas do setor. Não libera outros módulos.</p>
                    <div className="max-h-48 space-y-0.5 overflow-y-auto p-2">
                      {setores.filter((s) => (contagemSetor.get(s) ?? 0) > 0).map((s) => (
                        <label key={s} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40">
                          <Checkbox checked={setoresSel.has(s)} disabled={!podeGerenciar} onCheckedChange={() => alternar(setSetoresSel, s)} />
                          <span className="flex-1 truncate">{s}</span>
                          <span className="text-muted-foreground">{contagemSetor.get(s)}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  {/* ── Cargos ── */}
                  <section className="rounded-md border border-border">
                    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-semibold">Liberação por cargo</p>
                    </header>
                    <p className="px-3 pt-2 text-[11px] text-muted-foreground">Marca todas as pessoas com o cargo. Vale só para esta tela.</p>
                    <div className="max-h-48 space-y-0.5 overflow-y-auto p-2">
                      {cargosComGente.map((c) => (
                        <label key={c} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40">
                          <Checkbox checked={cargosSel.has(c)} disabled={!podeGerenciar} onCheckedChange={() => alternar(setCargosSel, c)} />
                          <span className="flex-1 truncate">{c}</span>
                          <span className="text-muted-foreground">{contagemCargo.get(c)}</span>
                        </label>
                      ))}
                      {cargosComGente.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Nenhum cargo com pessoas.</p>}
                    </div>
                  </section>
                </div>

                {/* ── Perfis que já têm a tela ── */}
                {gravado.perfis.length > 0 && (
                  <section className="rounded-md border border-border">
                    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-semibold">Perfis que já incluem esta tela</p>
                    </header>
                    <p className="px-3 pt-2 text-[11px] text-muted-foreground">
                      Quem tem o perfil vê a tela, inclusive quem receber o perfil depois. Desmarque para tirar <b>só esta tela</b> do
                      perfil — o resto dele não muda.
                    </p>
                    <div className="space-y-0.5 p-2">
                      {gravado.perfis.map((pf) => (
                        <label key={pf.id} className={cn("flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40", !perfisMantidos.has(pf.id) && "bg-amber-50/60 dark:bg-amber-950/20")}>
                          <Checkbox checked={perfisMantidos.has(pf.id)} disabled={!podeGerenciar} onCheckedChange={() => alternar(setPerfisMantidos, pf.id)} />
                          <span className="flex-1 truncate font-medium">{pf.nome}</span>
                          <span className="text-muted-foreground">{pf.pessoas.length} pessoa(s)</span>
                        </label>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
            <p className={cn("flex items-center gap-1.5 text-xs", efetivo.size === 0 ? "text-warning" : "text-muted-foreground")}>
              {efetivo.size === 0 ? <Lock className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5 text-success" />}
              {carregando ? "…" : resumoLiberacao(efetivo.size, pendente)}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {podeGerenciar && !pendente && (
                <Button variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" disabled={salvando} onClick={() => setConfirmar("revogar")}>
                  <Lock className="mr-1.5 h-3.5 w-3.5" /> Revogar todos os acessos
                </Button>
              )}
              <Button variant="outline" onClick={onFechar} disabled={salvando}>{podeGerenciar ? "Cancelar" : "Fechar"}</Button>
              {/* Pendente sem mudança ainda salva: é o "liberar o que estava
                  preparado". Sem mudança e sem ninguém, não há o que gravar. */}
              {podeGerenciar && (
                <Button onClick={pedirSalvar} disabled={salvando || carregando || (!mudou && (!pendente || efetivo.size === 0))}>
                  {pendente && efetivo.size > 0 && <LockOpen className="mr-1.5 h-3.5 w-3.5" />}
                  {rotuloSalvar}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmar !== null} onOpenChange={(o) => { if (!o && !salvando) setConfirmar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear {tela.nome} para todos?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "revogar"
                ? "Ninguém mais acessa esta tela, por menu ou por endereço, até ela ser liberada de novo aqui. As pessoas e perfis continuam pré-marcados para facilitar a reabertura."
                : "Com zero pessoas marcadas, a tela volta a ficar bloqueada para todos — por menu ou por endereço — até ser liberada de novo aqui."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={salvando}
              onClick={(e) => { e.preventDefault(); void (confirmar === "revogar" ? revogar() : salvar()); }}
            >
              {salvando ? "Bloqueando…" : "Bloquear para todos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
