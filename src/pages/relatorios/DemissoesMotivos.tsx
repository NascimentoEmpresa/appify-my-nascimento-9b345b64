import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Loader2, Sparkles, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { classificarLoteRelatos, useDemissoesLinhas, type FiltroRelatorio } from "@/hooks/useRelatoriosDiretoria";
import {
  AGUARDANDO_IA, contarMotivos, contratoDe, contratosPorMotivo, cruzarContratoMotivo, type ContratosDoMotivo, dadosEmpilhados, DEMAIS, DIMENSOES, filtrarDetalhe,
  NAO_INFORMADO, pendentesIA, tituloDetalhe, type DimensaoMotivo, type FiltroDetalhe, type LinhaDemissao,
} from "@/lib/relatorios/demissoesMotivos";
import { Vazio } from "./componentes";

// =====================================================================
// Relatórios › Demissões — "Motivo por contrato" e "Motivos do relato
// (I.A)" (05/11/2026, mig 20261105008300). Fica abaixo dos rankings do
// relatório padrão, só no slug "demissoes".
//
// Tudo clicável abre o detalhe (colaborador, contrato, data, motivos de
// lista e relato completo): fatia da barra, célula da tabela, nome do
// contrato, cabeçalho do motivo e barra da categoria da I.A.
//
// I.A: com relato pendente no período, a tela chama a Edge
// demissao-relato-ia em lotes (25 por vez) UMA vez por abertura, até zerar
// ou parar de andar; depois recarrega as linhas. Falha é silenciosa (fica
// "(aguardando I.A)" e o botão "Classificar" para tentar de novo).
// =====================================================================

const CORES = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#65a30d", "#0f766e"];
const COR_NEUTRA = "#94a3b8";
const corDe = (motivo: string, i: number) =>
  motivo === DEMAIS || motivo === AGUARDANDO_IA || motivo === NAO_INFORMADO ? COR_NEUTRA : CORES[i % CORES.length];
const curto = (s: string, n = 34) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const MAX_LOTES = 40;
const NENHUMA: LinhaDemissao[] = [];

export default function DemissoesMotivos({ filtro }: { filtro: FiltroRelatorio }) {
  const q = useDemissoesLinhas(filtro);
  const linhas = q.data ?? NENHUMA;
  const [dim, setDim] = useState<DimensaoMotivo>("motivo_solicitacao");
  const [modo, setModo] = useState<"grafico" | "tabela">("grafico");
  const [detalhe, setDetalhe] = useState<FiltroDetalhe | null>(null);

  const cz = useMemo(() => cruzarContratoMotivo(linhas, dim), [linhas, dim]);
  const emp = useMemo(() => dadosEmpilhados(cz), [cz]);
  const visiveis = emp.series.filter((s) => s !== DEMAIS);
  const categorias = useMemo(() => contarMotivos(linhas, "categoria_ia"), [linhas]);
  const contratosDaCategoria = useMemo(() => contratosPorMotivo(linhas, "categoria_ia", 10), [linhas]);
  const ia = useClassificacao(linhas, q.isFetching);

  const abrir = (f: Omit<FiltroDetalhe, "dim" | "visiveis"> & { dim?: DimensaoMotivo }) =>
    setDetalhe({ dim: f.dim ?? dim, motivo: f.motivo, contrato: f.contrato, visiveis });

  if (q.isLoading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cruzando motivos por contrato…</Card>;
  }
  if (q.error) {
    return <Card className="p-4 text-sm text-muted-foreground">Motivos por contrato: {(q.error as Error).message}</Card>;
  }

  return (
    <>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Motivo por contrato</p>
            <p className="text-xs text-muted-foreground">Clique numa barra, célula, contrato ou motivo para ver as solicitações.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {DIMENSOES.map((d) => (
              <Button key={d.chave} size="sm" variant={dim === d.chave ? "default" : "outline"} className="h-8 text-xs" onClick={() => setDim(d.chave)}>
                {d.chave === "categoria_ia" && <Sparkles className="mr-1 h-3.5 w-3.5" />}{d.curto}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            <Button size="icon" variant={modo === "grafico" ? "secondary" : "ghost"} className="h-8 w-8" title="Gráfico" onClick={() => setModo("grafico")}><BarChart3 className="h-4 w-4" /></Button>
            <Button size="icon" variant={modo === "tabela" ? "secondary" : "ghost"} className="h-8 w-8" title="Tabela" onClick={() => setModo("tabela")}><Table2 className="h-4 w-4" /></Button>
          </div>
        </div>

        {cz.total === 0 ? <Vazio /> : modo === "grafico" ? (
          <>
            <ResponsiveContainer width="100%" height={Math.max(180, emp.dados.length * 34 + 70)}>
              <BarChart data={emp.dados} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="contrato" width={220} tick={{ fontSize: 11 }} tickFormatter={(v: string) => curto(v)} />
                <Tooltip labelFormatter={(v) => String(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {emp.series.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="m" fill={corDe(s, i)} cursor="pointer"
                    onClick={(d: { payload?: { contrato?: string } }) => abrir({ motivo: s, contrato: d?.payload?.contrato ?? null })} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            {cz.linhas.length > emp.dados.length && (
              <p className="mt-1 text-[11px] text-muted-foreground">Mostrando os {emp.dados.length} contratos com mais demissões de {cz.linhas.length} — a tabela tem todos.</p>
            )}
          </>
        ) : (
          <TabelaCruzada cz={cz} aoAbrir={abrir} />
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-600" /> Motivos do relato (agrupados pela I.A)</p>
            <p className="text-xs text-muted-foreground">O texto livre do passo 2 de cada solicitação, juntado por sentido ("quis sair", "pediu pra sair"… = um motivo só).</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {ia.rodando ? (
              <span className="flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Classificando… {ia.restantes != null ? `${ia.restantes} na fila` : ""}</span>
            ) : ia.pendentes > 0 ? (
              <>
                <span>{ia.pendentes} aguardando I.A</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ia.rodar(true)}><Sparkles className="mr-1 h-3.5 w-3.5" /> Classificar</Button>
              </>
            ) : null}
          </div>
        </div>
        {categorias.length === 0 ? <Vazio /> : (
          <ResponsiveContainer width="100%" height={Math.max(140, categorias.length * 26 + 20)}>
            <BarChart data={categorias.map((c) => ({ ...c, curto: curto(c.nome, 40) }))} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="curto" width={250} tick={{ fontSize: 11 }} />
              <Tooltip content={({ active, payload }) => {
                const c = payload?.[0]?.payload as { nome: string; n: number } | undefined;
                if (!active || !c) return null;
                return <TooltipCategoria nome={c.nome} n={c.n} contratos={contratosDaCategoria.get(c.nome)} />;
              }} />
              <Bar dataKey="n" fill="#7c3aed" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11 }} cursor="pointer"
                onClick={(d: { payload?: { nome?: string } }) => d?.payload?.nome && abrir({ dim: "categoria_ia", motivo: d.payload.nome, contrato: null })} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">Por contrato: escolha <b>Relato (I.A)</b> em "Motivo por contrato".</p>
      </Card>

      <DetalheDialog linhas={linhas} filtro={detalhe} onClose={() => setDetalhe(null)} />
    </>
  );
}

// ---- Tooltip de "Motivos do relato": de quais contratos vem cada motivo ------------

function TooltipCategoria({ nome, n, contratos }: { nome: string; n: number; contratos?: ContratosDoMotivo }) {
  return (
    <div className="max-w-[360px] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{nome}</p>
      <p className="text-violet-700 dark:text-violet-300">Solicitações: {n}</p>
      {contratos && contratos.itens.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
          {contratos.itens.map((c) => (
            <li key={c.contrato} className="flex justify-between gap-3">
              <span className="truncate">{c.contrato}</span>
              <span className="shrink-0 font-medium tabular-nums">{c.n}</span>
            </li>
          ))}
          {contratos.outros > 0 && <li className="text-muted-foreground">+{contratos.outros} {contratos.outros === 1 ? "outro" : "outros"}</li>}
        </ul>
      )}
    </div>
  );
}

// ---- Tabela contrato × motivo ----------------------------------------------------

function TabelaCruzada({ cz, aoAbrir }: {
  cz: ReturnType<typeof cruzarContratoMotivo>;
  aoAbrir: (f: { motivo: string | null; contrato: string | null }) => void;
}) {
  const celula = "px-2 py-1.5 text-center tabular-nums";
  return (
    <div className="max-h-[520px] overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="sticky left-0 bg-muted px-3 py-2 font-semibold">Contrato</th>
            <th className="px-2 py-2 text-center font-semibold">Total</th>
            {cz.motivos.map((m) => (
              <th key={m} className="min-w-[90px] px-2 py-2 text-center font-semibold normal-case tracking-normal">
                <button type="button" className="hover:text-primary hover:underline" title={m} onClick={() => aoAbrir({ motivo: m, contrato: null })}>{curto(m, 28)}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cz.linhas.map((l) => (
            <tr key={l.contrato} className="border-t border-border/60 hover:bg-muted/30">
              <td className="sticky left-0 bg-card px-3 py-1.5 font-medium">
                <button type="button" className="text-left hover:text-primary hover:underline" onClick={() => aoAbrir({ motivo: null, contrato: l.contrato })}>{l.contrato}</button>
              </td>
              <td className={`${celula} font-semibold`}>{l.total}</td>
              {cz.motivos.map((m) => {
                const n = l.porMotivo[m] ?? 0;
                return (
                  <td key={m} className={celula}>
                    {n ? <button type="button" className="min-w-6 rounded px-1 font-medium text-primary hover:bg-primary/10" onClick={() => aoAbrir({ motivo: m, contrato: l.contrato })}>{n}</button>
                       : <span className="text-muted-foreground/40">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/40 font-semibold">
            <td className="sticky left-0 bg-muted px-3 py-1.5">Total</td>
            <td className={celula}>{cz.total}</td>
            {cz.motivos.map((m) => <td key={m} className={celula}>{cz.totalPorMotivo[m]}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---- Detalhe ------------------------------------------------------------------------

const fmtData = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

function DetalheDialog({ linhas, filtro, onClose }: { linhas: LinhaDemissao[]; filtro: FiltroDetalhe | null; onClose: () => void }) {
  const [busca, setBusca] = useState("");
  useEffect(() => { setBusca(""); }, [filtro]);
  const lista = useMemo(() => {
    if (!filtro) return [];
    const base = filtrarDetalhe(linhas, filtro);
    const t = busca.trim().toLowerCase();
    if (!t) return base;
    return base.filter((l) => [l.colaborador, l.cargo, l.contrato, l.relato, l.motivo_solicitacao, l.motivo_pedido, l.categoria_ia]
      .some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [linhas, filtro, busca]);

  return (
    <Dialog open={!!filtro} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{filtro ? tituloDetalhe(filtro) : ""}</DialogTitle>
          <DialogDescription>{lista.length} {lista.length === 1 ? "solicitação" : "solicitações"} no período filtrado.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Buscar colaborador, cargo, relato…" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-8 text-sm" />
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">Data</th>
                <th className="px-2 py-2 font-semibold">Colaborador</th>
                <th className="px-2 py-2 font-semibold">Contrato</th>
                <th className="px-2 py-2 font-semibold">Motivos (lista)</th>
                <th className="px-2 py-2 font-semibold">Relato</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.id} className="border-t border-border/60 align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{fmtData(l.data)}<div className="text-[10px]">#{l.id}</div></td>
                  <td className="px-2 py-1.5"><div className="font-medium">{l.colaborador ?? "—"}</div><div className="text-[10px] text-muted-foreground">{l.cargo ?? ""}</div><div className="text-[10px] text-muted-foreground">{l.status ?? ""}</div></td>
                  <td className="px-2 py-1.5 text-muted-foreground">{contratoDe(l)}</td>
                  <td className="px-2 py-1.5">
                    <div>{l.motivo_solicitacao || NAO_INFORMADO}</div>
                    <div className="text-muted-foreground">{l.motivo_pedido || NAO_INFORMADO}</div>
                    <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
                      <Sparkles className="h-3 w-3" />{l.categoria_ia || AGUARDANDO_IA}
                    </div>
                  </td>
                  <td className="max-w-[380px] whitespace-pre-wrap break-words px-2 py-1.5">{l.relato?.trim() || <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nenhuma solicitação.</td></tr>}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- I.A em lotes ------------------------------------------------------------------

function useClassificacao(linhas: LinhaDemissao[], carregando: boolean) {
  const qc = useQueryClient();
  const pendentes = pendentesIA(linhas);
  const [rodando, setRodando] = useState(false);
  const [restantes, setRestantes] = useState<number | null>(null);
  const jaTentou = useRef(false);

  const rodar = async (manual = false) => {
    if (rodando) return;
    setRodando(true);
    let anterior = Number.POSITIVE_INFINITY;
    try {
      for (let i = 0; i < MAX_LOTES; i++) {
        const r = await classificarLoteRelatos();
        setRestantes(r.restantes);
        // Parou de andar (I.A não leu nada) ou acabou: sai do laço.
        if (r.restantes === 0 || r.gravados === 0 || r.restantes >= anterior) break;
        anterior = r.restantes;
      }
    } catch (e) {
      // Falha silenciosa na abertura; no botão, avisa.
      if (manual) toast.error(`I.A: ${(e as Error).message}`);
      else console.warn("demissao-relato-ia", e);
    } finally {
      setRodando(false);
      setRestantes(null);
      qc.invalidateQueries({ queryKey: ["diretoria-relatorios", "demissoes-linhas"] });
    }
  };

  // Uma vez por abertura da tela, se houver pendente no período.
  useEffect(() => {
    if (jaTentou.current || carregando || pendentes === 0) return;
    jaTentou.current = true;
    void rodar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentes, carregando]);

  return { pendentes, rodando, restantes, rodar };
}
