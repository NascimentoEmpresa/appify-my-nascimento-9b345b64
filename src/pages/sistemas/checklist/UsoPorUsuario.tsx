import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpDown, CalendarDays, Clock, Layers, Loader2, MousePointerClick, Search, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUsoUsuario, useUsoUsuarios, type UsoUsuarioResumo } from "@/hooks/useChecklistModulos";
import { cn } from "@/lib/utils";
import { fmtData, haQuanto } from "./ui";

// =====================================================================
// Uso do ERP › HISTÓRICO POR USUÁRIO (02/10/2026, mig 20261002000005)
//
// Pedido do Pablo: "o histórico de cada usuário, o que cada usuário mais
// acessa". Lista com todas as pessoas ativas (quem não usou no período
// aparece com zero — é informação também), a tela que cada uma MAIS usa e o
// último acesso. Clique abre o detalhe: telas e módulos mais usados,
// acessos por dia e o histórico dia × tela (1ª e última hora do dia).
//
// A medição é por tela por dia (SIS_USO_TELA), não por clique: o histórico
// mostra "abriu X vezes entre 08:12 e 17:40", não cada abertura.
// =====================================================================

const COR = "#2a78d6";
const EIXO = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
type Ordem = "acessos" | "dias" | "ultimo" | "nome";
const POR_PAGINA = 15;
const hora = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function UsoPorUsuario() {
  const [dias, setDias] = useState(30);
  const q = useUsoUsuarios(dias);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "usaram" | "sem_uso">("todos");
  const [ordem, setOrdem] = useState<{ col: Ordem; asc: boolean }>({ col: "acessos", asc: false });
  const [pagina, setPagina] = useState(1);
  const [sel, setSel] = useState<UsoUsuarioResumo | null>(null);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const r = (q.data ?? []).filter((u) =>
      (filtro === "todos" || (filtro === "usaram" ? u.acessos > 0 : u.acessos === 0))
      && (!t || [u.nome, u.email, u.cargo, u.setor, u.tela_top].some((x) => (x ?? "").toLowerCase().includes(t))));
    const k = (u: UsoUsuarioResumo): number | string =>
      ordem.col === "acessos" ? u.acessos : ordem.col === "dias" ? u.dias : ordem.col === "ultimo" ? (u.ultimo ?? "") : (u.nome ?? "");
    return r.sort((a, b) => {
      const x = k(a), y = k(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (ordem.asc ? c : -c) || (a.nome ?? "").localeCompare(b.nome ?? "");
    });
  }, [q.data, busca, filtro, ordem]);
  const usaram = (q.data ?? []).filter((u) => u.acessos > 0).length;
  const maxAcessos = Math.max(1, ...lista.map((u) => u.acessos));
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const pag = Math.min(pagina, totalPaginas);
  const visiveis = lista.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
  const ordenar = (col: Ordem) => setOrdem((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: col === "nome" }));

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Histórico por usuário</p>
          <p className="text-xs text-muted-foreground">
            O que cada pessoa mais acessa · {usaram} de {q.data?.length ?? 0} usaram o ERP no período · clique na pessoa para ver o histórico
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 w-56 pl-8" placeholder="Pessoa, cargo, setor ou tela…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
          </div>
          <Select value={filtro} onValueChange={(v) => { setFiltro(v as typeof filtro); setPagina(1); }}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as pessoas</SelectItem>
              <SelectItem value="usaram">Usaram no período</SelectItem>
              <SelectItem value="sem_uso">Sem uso no período</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(dias)} onValueChange={(v) => { setDias(Number(v)); setPagina(1); }}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[7, 30, 90, 365].map((d) => <SelectItem key={d} value={String(d)}>Últimos {d} dias</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {q.isLoading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      ) : q.isError ? (
        <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar: {(q.error as Error)?.message}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-y border-border bg-muted/40 text-left text-xs font-semibold">
                  <Th rotulo="Pessoa" col="nome" ordem={ordem} onClick={ordenar} />
                  <Th rotulo="Acessos" col="acessos" ordem={ordem} onClick={ordenar} />
                  <Th rotulo="Dias ativos" col="dias" ordem={ordem} onClick={ordenar} />
                  <th className="px-3 py-2.5">Telas · módulos</th>
                  <th className="px-3 py-2.5">Mais acessa</th>
                  <Th rotulo="Último acesso" col="ultimo" ordem={ordem} onClick={ordenar} />
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Ninguém neste filtro.</td></tr>}
                {visiveis.map((u) => (
                  <tr key={u.user_id} onClick={() => setSel(u)} className="cursor-pointer border-b border-border transition hover:bg-muted/40">
                    <td className="max-w-[260px] px-3 py-2">
                      <p className="truncate font-medium text-foreground">{u.nome ?? "—"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{[u.cargo, u.setor].filter(Boolean).join(" · ") || u.email || "—"}</p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-10 text-right font-bold tabular-nums", !u.acessos && "text-muted-foreground")}>{u.acessos}</span>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(u.acessos / maxAcessos) * 100}%`, background: COR }} /></div>
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{u.dias || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{u.acessos ? `${u.telas} · ${u.modulos}` : "—"}</td>
                    <td className="max-w-[260px] px-3 py-2">
                      {u.tela_top ? (
                        <>
                          <p className="truncate font-medium">{u.tela_top} <span className="font-normal text-muted-foreground">({u.tela_top_acessos})</span></p>
                          <p className="truncate text-[11px] text-muted-foreground">{u.modulo_top}</p>
                        </>
                      ) : <span className="text-muted-foreground">sem uso no período</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" title={u.ultimo ? new Date(u.ultimo).toLocaleString("pt-BR") : undefined}>
                      {u.ultimo ? haQuanto(u.ultimo) : "nunca"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
            <span>{lista.length ? `Mostrando ${(pag - 1) * POR_PAGINA + 1} a ${Math.min(pag * POR_PAGINA, lista.length)} de ${lista.length}` : ""}</span>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" className="rounded-md border border-border px-2 py-1 disabled:opacity-40" disabled={pag <= 1} onClick={() => setPagina(pag - 1)}>Anterior</button>
                <span className="px-2 tabular-nums">{pag} / {totalPaginas}</span>
                <button type="button" className="rounded-md border border-border px-2 py-1 disabled:opacity-40" disabled={pag >= totalPaginas} onClick={() => setPagina(pag + 1)}>Próxima</button>
              </div>
            )}
          </div>
        </>
      )}

      {sel && <DetalheUsuario usuario={sel} dias={dias} onFechar={() => setSel(null)} />}
    </Card>
  );
}

function Th({ rotulo, col, ordem, onClick }: { rotulo: string; col: Ordem; ordem: { col: Ordem; asc: boolean }; onClick: (c: Ordem) => void }) {
  return (
    <th className="px-3 py-2.5">
      <button type="button" onClick={() => onClick(col)} className={cn("inline-flex items-center gap-1 whitespace-nowrap hover:text-primary", ordem.col === col && "text-primary")}>
        {rotulo}<ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </th>
  );
}

function DetalheUsuario({ usuario: u, dias, onFechar }: { usuario: UsoUsuarioResumo; dias: number; onFechar: () => void }) {
  const q = useUsoUsuario(u.user_id, dias);
  const d = q.data;
  const serie = (d?.por_dia ?? []).map((x) => ({ ...x, rotulo: fmtData(x.dia).slice(0, 5) }));
  const maxTela = Math.max(1, ...(d?.telas ?? []).map((t) => t.acessos));
  const maxMod = Math.max(1, ...(d?.modulos ?? []).map((m) => m.acessos));
  // Histórico agrupado por dia, mais recente primeiro.
  const porDia = useMemo(() => {
    const m = new Map<string, NonNullable<typeof d>["historico"]>();
    (d?.historico ?? []).forEach((h) => { const l = m.get(h.dia) ?? []; l.push(h); m.set(h.dia, l); });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [d?.historico]);

  return (
    <Sheet open onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[min(900px,96vw)]">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="flex items-center gap-2 text-xl"><UserRound className="h-5 w-5 text-muted-foreground" /> {u.nome ?? "—"}</SheetTitle>
          <SheetDescription>
            {[u.cargo, u.setor, u.email].filter(Boolean).join(" · ") || "—"}
            {u.primeiro_dia && <> · usa o ERP (medido) desde {fmtData(u.primeiro_dia)}</>}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Numero icone={<MousePointerClick className="h-4 w-4" />} rotulo={`Acessos (${dias}d)`} valor={u.acessos} />
          <Numero icone={<CalendarDays className="h-4 w-4" />} rotulo="Dias ativos" valor={u.dias} />
          <Numero icone={<Layers className="h-4 w-4" />} rotulo="Telas · módulos" valor={`${u.telas} · ${u.modulos}`} />
          <Numero icone={<Clock className="h-4 w-4" />} rotulo="Último acesso" valor={u.ultimo ? haQuanto(u.ultimo) : "nunca"} />
        </div>

        {q.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico…</p>
        ) : q.isError || !d ? (
          <p className="py-10 text-center text-sm text-destructive">Não foi possível carregar: {(q.error as Error)?.message}</p>
        ) : !d.historico.length ? (
          <p className="mt-6 rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhum acesso nos últimos {dias} dias.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <Card className="p-4">
              <p className="text-sm font-bold">Acessos por dia</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={serie} margin={{ top: 12, right: 8, bottom: 0, left: -22 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} interval={Math.max(0, Math.floor(serie.length / 10))} />
                  <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.55 }}
                    formatter={(v: number, _n, p) => [`${v} acesso(s) · ${(p?.payload as { telas: number }).telas} tela(s)`, "Uso"]} />
                  <Bar dataKey="acessos" fill={COR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">Telas que mais acessa</p>
                <ul className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  {d.telas.map((t) => (
                    <li key={t.menu_id}>
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate font-medium" title={t.rota}>{t.tela} <span className="text-[11px] font-normal text-muted-foreground">· {t.modulo}</span></span>
                        <span className="shrink-0 font-bold tabular-nums">{t.acessos}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(t.acessos / maxTela) * 100}%`, background: COR }} /></div>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">{t.dias} dia(s) · último {haQuanto(t.ultimo)}</p>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-4">
                <p className="mb-2 text-sm font-bold">Módulos</p>
                <ul className="space-y-2">
                  {d.modulos.map((m) => (
                    <li key={m.modulo}>
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate font-medium">{m.modulo}</span>
                        <span className="shrink-0 tabular-nums"><b>{m.acessos}</b> <span className="text-[11px] text-muted-foreground">· {m.telas} tela(s)</span></span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${(m.acessos / maxMod) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <Card className="p-4">
              <p className="text-sm font-bold">Histórico</p>
              <p className="mb-3 text-xs text-muted-foreground">Por dia: cada tela aberta, quantas vezes e entre que horas (primeira e última abertura do dia)</p>
              <div className="space-y-4">
                {porDia.map(([dia, itens]) => (
                  <div key={dia}>
                    <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
                      <span className="font-normal normal-case">· {itens.reduce((s, h) => s + h.acessos, 0)} acesso(s)</span>
                    </p>
                    <ol className="space-y-1 border-l-2 border-border pl-3">
                      {itens.map((h, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                          <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{hora(h.primeiro_em)}{h.acessos > 1 ? `–${hora(h.ultimo_em)}` : ""}</span>
                          <span className="font-medium">{h.tela}</span>
                          <span className="text-[11px] text-muted-foreground">{h.modulo} · {h.acessos}×</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Numero({ icone, rotulo, valor }: { icone: React.ReactNode; rotulo: string; valor: string | number }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{icone}{rotulo}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums">{valor}</p>
    </div>
  );
}
