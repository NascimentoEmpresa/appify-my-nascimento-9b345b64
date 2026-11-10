import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Link2, Loader2, Search, UserCheck, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { funcaoDe, type NoPessoa } from "@/lib/organograma/pessoas";
import type { ContratoEstrutura } from "@/lib/organograma/estruturaSetores";
import {
  casaLideranca, liderDe, liderancaDoContrato, linhasCsvLideranca, type LinhaLideranca,
} from "@/lib/organograma/liderancaContrato";

// =====================================================================
// SIS-2026-0770 (reaberto pela Helena, 10/11/2026): vínculo de cada
// colaborador ao ENCARREGADO dentro do contrato, e a busca "a quem esta pessoa
// se reporta" (pesquisa de clima). Regra em lib/organograma/liderancaContrato.ts.
//
// Vincular grava o "reporta a" do organograma pela RPC que já existe
// (organograma_definir_superior_lote — permissão de montar o organograma,
// trava de ciclo e histórico "Mudança de superior imediato" no perfil).
// =====================================================================

const sb = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const normal = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tituloNome = (n: string) => n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase()).replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());

/** Vincular colaboradores do contrato a um encarregado (em lote). */
export function DialogVincularEncarregado({ c, marcadosIniciais, onFechar }: {
  c: ContratoEstrutura; marcadosIniciais?: string[]; onFechar: () => void;
}) {
  const qc = useQueryClient();
  const lid = useMemo(() => liderancaDoContrato(c), [c]);
  const temSem = lid.semEncarregado.length > 0;
  const [encarregado, setEncarregado] = useState<string | null>(lid.encarregados.length === 1 ? lid.encarregados[0].encarregado.id : null);
  const [outro, setOutro] = useState("");
  const [ver, setVer] = useState<"sem" | "todos">(temSem ? "sem" : "todos");
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set(marcadosIniciais ?? []));

  const encDe = useMemo(() => {
    const m = new Map<string, NoPessoa>();
    lid.encarregados.forEach((t) => t.equipe.forEach((p) => m.set(p.id, t.encarregado)));
    return m;
  }, [lid]);
  const idsEnc = new Set(lid.encarregados.map((t) => t.encarregado.id));
  const porId = useMemo(() => new Map(c.membros.map((m) => [m.id, m])), [c]);
  const escolhido = encarregado ? porId.get(encarregado) ?? null : null;

  const base = ver === "sem" ? lid.semEncarregado : c.membros.filter((m) => !idsEnc.has(m.id));
  const lista = base.filter((p) => p.id !== encarregado && (!busca || normal(`${p.nome} ${funcaoDe(p)}`).includes(normal(busca))));
  const candidatosOutro = outro.trim().length >= 2
    ? c.membros.filter((m) => !idsEnc.has(m.id) && normal(`${m.nome} ${funcaoDe(m)}`).includes(normal(outro))).slice(0, 8)
    : [];

  const alternar = (id: string) => setMarcados((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const todosVisiveis = lista.length > 0 && lista.every((p) => marcados.has(p.id));
  const marcarVisiveis = () => setMarcados((s) => {
    const x = new Set(s);
    if (todosVisiveis) lista.forEach((p) => x.delete(p.id)); else lista.forEach((p) => x.add(p.id));
    return x;
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const ids = [...marcados].filter((id) => id !== encarregado && porId.has(id));
      const { data, error } = await sb.rpc("organograma_definir_superior_lote", {
        p_nos: ids, p_parent: encarregado,
        p_motivo: `Vinculado ao encarregado ${escolhido?.nome ?? ""} no contrato ${c.nome}`,
      });
      if (error) throw error;
      return (data ?? { ok: ids.length, falhas: 0 }) as { ok: number; falhas: number };
    },
    onSuccess: (r) => {
      const nome = escolhido ? tituloNome(escolhido.nome.split(/\s+/).slice(0, 2).join(" ")) : "o encarregado";
      toast.success(`${r.ok} colaborador(es) agora se reportam a ${nome}.`);
      if (r.falhas) toast.warning(`${r.falhas} não foram vinculados: o encarregado está abaixo deles na árvore.`);
      qc.invalidateQueries({ queryKey: ["organograma-arvore"] });
      qc.invalidateQueries({ queryKey: ["organograma-busca"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message || "Não deu para vincular."),
  });

  const nMarcados = [...marcados].filter((id) => id !== encarregado).length;

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="grid max-h-[92vh] max-w-3xl grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /> Vincular ao encarregado</DialogTitle>
          <DialogDescription>
            {c.nome} · {c.membros.length.toLocaleString("pt-BR")} pessoa(s). Escolha o encarregado e marque quem se reporta a ele. Fica no histórico de cada colaborador.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 overflow-y-auto md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2" role="radiogroup" aria-label="Encarregado">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">1. Encarregado</p>
            {lid.encarregados.map((t) => (
              <button key={t.encarregado.id} type="button" role="radio" aria-checked={encarregado === t.encarregado.id}
                onClick={() => { setEncarregado(t.encarregado.id); setMarcados((s) => { const x = new Set(s); x.delete(t.encarregado.id); return x; }); }}
                className={cn("flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition hover:border-primary/40",
                  encarregado === t.encarregado.id && "border-primary bg-primary/5 ring-1 ring-primary/40")}>
                <UserCheck className={cn("h-4 w-4 shrink-0", encarregado === t.encarregado.id ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{tituloNome(t.encarregado.nome)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{funcaoDe(t.encarregado) || "—"} · {t.equipe.length} na turma</span>
                </span>
              </button>
            ))}
            {escolhido && !idsEnc.has(escolhido.id) && (
              <div className="rounded-xl border border-primary bg-primary/5 px-3 py-2 text-sm font-semibold">{tituloNome(escolhido.nome)}<span className="block text-[11px] font-normal text-muted-foreground">passa a ser encarregado</span></div>
            )}
            <div className="space-y-1 pt-1">
              <p className="text-[11px] text-muted-foreground">{lid.encarregados.length ? "Outra pessoa do contrato:" : "Nenhum encarregado reconhecido pela função. Escolha quem lidera:"}</p>
              <Input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Buscar no contrato…" className="h-8 text-sm" aria-label="Buscar outra pessoa como encarregado" />
              {candidatosOutro.map((m) => (
                <button key={m.id} type="button" onClick={() => { setEncarregado(m.id); setOutro(""); setMarcados((s) => { const x = new Set(s); x.delete(m.id); return x; }); }}
                  className="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted">
                  <b>{tituloNome(m.nome)}</b> <span className="text-muted-foreground">· {funcaoDe(m) || "—"}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">2. Quem se reporta a ele</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border bg-background p-0.5 text-xs font-semibold">
                {([["sem", `Sem encarregado (${lid.semEncarregado.length})`], ["todos", "Todos do contrato"]] as const).map(([v, r]) => (
                  <button key={v} type="button" onClick={() => setVer(v)} aria-pressed={ver === v}
                    className={cn("rounded-md px-2.5 py-1 transition", ver === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{r}</button>
                ))}
              </div>
              <div className="relative min-w-[10rem] flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por nome ou função" className="h-8 pl-7 text-sm" aria-label="Filtrar colaboradores" />
              </div>
            </div>
            <label className="flex items-center gap-2 px-1 text-xs font-semibold">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={todosVisiveis} onChange={marcarVisiveis} disabled={!lista.length} />
              Marcar todos da lista ({lista.length})
            </label>
            <ul className="max-h-[46vh] min-h-[8rem] space-y-0.5 overflow-y-auto rounded-lg border p-1">
              {lista.map((p) => {
                const atual = encDe.get(p.id);
                return (
                  <li key={p.id}>
                    <label className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted", marcados.has(p.id) && "bg-primary/5")}>
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{tituloNome(p.nome)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{funcaoDe(p) || "—"}</span>
                      </span>
                      {atual
                        ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">hoje: {tituloNome(atual.nome.split(/\s+/)[0])}</span>
                        : <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">sem encarregado</span>}
                    </label>
                  </li>
                );
              })}
              {!lista.length && <li className="py-6 text-center text-sm text-muted-foreground">{ver === "sem" ? "Todos do contrato já têm encarregado." : "Ninguém com esse filtro."}</li>}
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:items-center">
          <span className="mr-auto text-xs text-muted-foreground">
            {nMarcados} marcado(s){escolhido ? ` → ${tituloNome(escolhido.nome)}` : " · escolha o encarregado"}
          </span>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!escolhido || !nMarcados || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Vincular {nMarcados || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function baixarCsv(nome: string, linhas: string[][]) {
  const csv = linhas.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LIMITE = 200;

/** "A quem esta pessoa se reporta": busca por colaborador, líder ou contrato, e planilha. */
export function DialogLideranca({ linhas, onPerfil, onFechar }: {
  linhas: LinhaLideranca[]; onPerfil: (id: string) => void; onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [soSem, setSoSem] = useState(false);
  const filtradas = useMemo(
    () => linhas.filter((l) => (!soSem || l.semEncarregado) && casaLideranca(l, busca)),
    [linhas, busca, soSem],
  );
  const nSem = useMemo(() => linhas.filter((l) => l.semEncarregado).length, [linhas]);
  const curto = (n: NoPessoa | null) => (n ? tituloNome(n.nome) : null);

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="grid max-h-[92vh] max-w-5xl grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
        <DialogHeader>
          <DialogTitle>Liderança por colaborador</DialogTitle>
          <DialogDescription>
            A quem cada colaborador se reporta: o encarregado no contrato (ou o chefe direto, no escritório) e o supervisor do contrato. Busque pelo colaborador, pelo líder ou pelo contrato.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do colaborador, do encarregado ou do contrato…" className="pl-8" aria-label="Buscar liderança" />
          </div>
          <Button variant={soSem ? "default" : "outline"} size="sm" onClick={() => setSoSem((v) => !v)} aria-pressed={soSem}>
            <UserX className="mr-1.5 h-4 w-4" /> Sem encarregado ({nSem.toLocaleString("pt-BR")})
          </Button>
          <Button variant="outline" size="sm" onClick={() => baixarCsv("lideranca-por-colaborador.csv", linhasCsvLideranca(filtradas))}>
            <Download className="mr-1.5 h-4 w-4" /> Planilha ({filtradas.length.toLocaleString("pt-BR")})
          </Button>
        </div>
        <div className="min-h-0 overflow-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/95 text-left text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 font-semibold">Colaborador</th>
                <th className="px-3 py-2 font-semibold">Contrato / setor</th>
                <th className="px-3 py-2 font-semibold">Se reporta a</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Supervisor do contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtradas.slice(0, LIMITE).map((l) => {
                const lider = liderDe(l);
                return (
                  <tr key={l.pessoa.id} className="align-top hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => onPerfil(l.pessoa.id)}>{tituloNome(l.pessoa.nome)}</button>
                      <span className="block text-[11px] text-muted-foreground">{funcaoDe(l.pessoa) || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{l.lotacao}</td>
                    <td className="px-3 py-2">
                      {l.ehEncarregado ? (
                        <>
                          <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10.5px] font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">Encarregado</span>
                          {lider && <span className="block text-xs text-muted-foreground">responde a {curto(lider)}</span>}
                        </>
                      ) : l.semEncarregado ? (
                        <>
                          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Sem encarregado</span>
                          {l.liderImediato && <span className="block text-xs text-muted-foreground">hoje responde a {curto(l.liderImediato)}</span>}
                        </>
                      ) : lider ? (
                        <>
                          <button type="button" className="text-left font-medium hover:underline" onClick={() => onPerfil(lider.id)}>{curto(lider)}</button>
                          <span className="block text-[11px] text-muted-foreground">
                            {l.encarregado ? "encarregado" : funcaoDe(lider) || "chefe direto"}
                            {l.encarregado && l.liderImediato && l.liderImediato.id !== l.encarregado.id ? ` · direto: ${curto(l.liderImediato)}` : ""}
                          </span>
                        </>
                      ) : <span className="text-xs text-muted-foreground">Sem superior definido</span>}
                    </td>
                    <td className="hidden px-3 py-2 text-xs md:table-cell">{curto(l.supervisor) ?? (l.campo ? "Sem supervisor" : "—")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtradas.length && <p className="py-8 text-center text-sm text-muted-foreground">Ninguém encontrado.</p>}
          {filtradas.length > LIMITE && (
            <p className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
              Mostrando {LIMITE} de {filtradas.length.toLocaleString("pt-BR")}. Refine a busca — a planilha leva todos.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
