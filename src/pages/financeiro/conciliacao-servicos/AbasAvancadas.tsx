import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, CheckCircle2, ExternalLink, FileText, Info, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { INFO_COL, INFO_FONTE, INFO_KPI } from "./infos";
import {
  alertasDeCriterio, CRITERIOS, detalharIndicador, DIMENSOES, FONTES_EXT, GRUPOS_INDICADOR, INDICADORES_EXT, ROTULO_SITUACAO_CV, somarContaVinculada,
  type ContextoNota, type Dimensao, type FiltroDrill, type FonteExt, type GrupoIndicador, type IndicadorId, type LinhaContaVinculada, type LinhaImpostosDescontos, type LinhaIndicadorExt,
} from "./indicadores";
import type { EntradaIndicadores } from "./indicadores";
import type { NfEmissaoRow } from "@/hooks/useNfEmissao";

// SIS-2026-0903 (Fase 1): abas novas da Conciliação Financeira do Relatório de Serviços. Só apresentação: toda a conta está em indicadores.ts.

const TODOS = "todos";
const mesLabel = (anoMes: string) => `${anoMes.slice(5, 7)}/${anoMes.slice(0, 4)}`;
const pctTxt = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const fmtIndicador = (v: number | null, formato: "moeda" | "pct") => (v === null ? null : formato === "pct" ? pctTxt(v) : fmtMoney(v));
const COR_STATUS: Record<LinhaIndicadorExt["status"], { rotulo: string; classe: string }> = {
  conciliado: { rotulo: "Conciliado", classe: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" },
  divergente: { rotulo: "Divergente", classe: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" },
  fonte_unica: { rotulo: "Fonte única", classe: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300" },
  sem_dado: { rotulo: "Sem dado", classe: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" },
};
const Indisponivel = () => <span className="text-xs italic text-muted-foreground" title="A tela desta fonte não mostra este indicador (indisponível não é zero).">Indisponível</span>;

// ── Critérios e alertas (4.3) ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function PainelCriterios({ nfs, contratoPorId }: { nfs: NfEmissaoRow[]; contratoPorId: Map<string, { empresa_id: string }> }) {
  const alertas = useMemo(() => alertasDeCriterio(nfs, contratoPorId), [nfs, contratoPorId]);
  return (
    <div className="space-y-2">
      {alertas.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/20">
          <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Critérios diferentes entre as telas que explicam parte das diferenças (veja antes de tratar como erro)</p>
          <ul className="list-disc space-y-0.5 pl-5">{alertas.map((a) => <li key={a.id}><strong>{a.quantidade.toLocaleString("pt-BR")} NF(s):</strong> {a.texto}</li>)}</ul>
        </div>
      )}
      <details className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
        <summary className="cursor-pointer select-none text-sm font-semibold">Critérios que cada tela usa (competência, empresa, período, regras de cálculo)</summary>
        <div className="mt-2 overflow-x-auto">
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Critério</TableHead>{FONTES_EXT.map((f) => <TableHead key={f.id}>{f.rotulo}</TableHead>)}<TableHead>Igual?</TableHead></TableRow></TableHeader>
            <TableBody>
              {CRITERIOS.map((c) => (
                <TableRow key={c.criterio}>
                  <TableCell className="font-medium">{c.criterio}</TableCell>
                  <TableCell>{c.geral}</TableCell><TableCell>{c.dashboard}</TableCell><TableCell>{c.faturamento}</TableCell><TableCell>{c.lucratividade}</TableCell>
                  <TableCell>{c.iguais ? <span className="text-emerald-700">Sim</span> : <span className="font-semibold text-amber-700">Não</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}

// ── Indicadores ampliados (4.1) ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function AbaIndicadores({ linhas, carregandoDespesas, onDetalhar }: { linhas: LinhaIndicadorExt[]; carregandoDespesas: boolean; onDetalhar: (id: IndicadorId) => void }) {
  const [grupo, setGrupo] = useState<GrupoIndicador | typeof TODOS>(TODOS);
  const [soDivergentes, setSoDivergentes] = useState(false);
  const visiveis = linhas.filter((l) => (grupo === TODOS || l.indicador.grupo === grupo) && (!soDivergentes || l.status === "divergente"));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Tipo de indicador</div>
          <Select value={grupo} onValueChange={(v) => setGrupo(v as GrupoIndicador | typeof TODOS)}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos</SelectItem>{GRUPOS_INDICADOR.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={soDivergentes} onChange={(e) => setSoDivergentes(e.target.checked)} />Só divergentes</label>
        <p className="flex items-center gap-1.5 pb-1.5 text-muted-foreground"><Info className="h-3.5 w-3.5" />“Indisponível” = a tela não mostra o indicador. Não é zero e não entra na comparação.</p>
      </div>
      {carregandoDespesas && <p className="text-xs text-muted-foreground">Carregando as despesas do Fluxo de Caixa… Despesas, lucro e margem aparecem como “sem dado” até terminar.</p>}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><TituloComFormula alinhar="left" titulo="Indicador" formula={INFO_COL.indicador} /></TableHead>
                {FONTES_EXT.map((f) => <TableHead key={f.id} className="text-right"><TituloComFormula titulo={f.rotulo} formula={INFO_FONTE[f.id]} /></TableHead>)}
                <TableHead className="text-right"><TituloComFormula titulo="Diferença" formula={INFO_COL.diferenca} /></TableHead>
                <TableHead><TituloComFormula alinhar="left" titulo="Status" formula={INFO_COL.status} /></TableHead>
                <TableHead><TituloComFormula alinhar="left" titulo="Quem destoa" formula={INFO_COL.destoa} /></TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Nenhum indicador neste filtro.</TableCell></TableRow>}
              {visiveis.map((l) => {
                const st = COR_STATUS[l.status];
                return (
                  <TableRow key={l.indicador.id}>
                    <TableCell className="font-medium">
                      <TituloComFormula alinhar="left" titulo={l.indicador.rotulo} formula={<><span>{l.indicador.formula}</span><span className="block text-muted-foreground">Grupo: {l.indicador.grupo}</span></>} />
                    </TableCell>
                    {FONTES_EXT.map((f) => {
                      const txt = fmtIndicador(l.valores[f.id], l.indicador.formato);
                      return <TableCell key={f.id} className={`whitespace-nowrap text-right ${l.destoantes.includes(f.id) ? "font-semibold text-red-600" : ""}`}>{txt ?? <Indisponivel />}</TableCell>;
                    })}
                    <TableCell className={`whitespace-nowrap text-right ${l.status === "divergente" ? "font-semibold text-red-600" : ""}`}>{l.diferenca === null ? "—" : l.indicador.formato === "pct" ? `${l.diferenca.toLocaleString("pt-BR")} p.p.` : fmtMoney(l.diferenca)}</TableCell>
                    <TableCell><Badge variant="outline" className={st.classe}>{st.rotulo}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.destoantes.length ? l.destoantes.map((d) => FONTES_EXT.find((f) => f.id === d)!.rotulo).join(", ") : "—"}</TableCell>
                    <TableCell>{l.indicador.porNota && l.status === "divergente" && <Button size="sm" variant="ghost" onClick={() => onDetalhar(l.indicador.id)}>Detalhar</Button>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Detalhamento progressivo (4.2) ───────────────────────────────────────────────────────────────────────────────────────────────────
export function AbaDetalhe({ indicadorId, onIndicador, entrada, ctx, onAbrir, onTratar }: {
  indicadorId: IndicadorId; onIndicador: (id: IndicadorId) => void;
  /** Fase 2: abre/registra a tratativa da nota (só para quem pode alterar). */
  onTratar?: (notaId: string) => void;
  entrada: Pick<EntradaIndicadores, "linhasRelatorio" | "linhasFaturamento" | "itensPorNf">; ctx: ContextoNota;
  onAbrir: (n: { empresaId: string; competencia: string; contratoId: string }) => void;
}) {
  const [dimensao, setDimensao] = useState<Dimensao>("competencia");
  const [drill, setDrill] = useState<FiltroDrill>({});
  const [rotulos, setRotulos] = useState<Partial<Record<Dimensao, string>>>({});
  const [soDif, setSoDif] = useState(true);
  const ind = INDICADORES_EXT.find((i) => i.id === indicadorId)!;
  const linhas = useMemo(() => detalharIndicador(indicadorId, entrada, dimensao, drill, ctx), [indicadorId, entrada, dimensao, drill, ctx]);
  const visiveis = soDif ? linhas.filter((l) => l.diferenca > 0.005 || l.ausentes > 0) : linhas;
  const ordem = DIMENSOES.map((d) => d.id);

  function descer(chave: string, rotulo: string) {
    const proxima = ordem[ordem.indexOf(dimensao) + 1];
    if (!proxima) return;
    setDrill((d) => ({ ...d, [dimensao]: chave }));
    setRotulos((r) => ({ ...r, [dimensao]: rotulo }));
    setDimensao(proxima);
  }
  function voltarPara(d: Dimensao) {
    const i = ordem.indexOf(d);
    const novo: FiltroDrill = {};
    const novosRotulos: Partial<Record<Dimensao, string>> = {};
    for (const k of ordem.slice(0, i)) { const v = drill[k]; if (v) { novo[k] = v; novosRotulos[k] = rotulos[k]; } }
    setDrill(novo);
    setRotulos(novosRotulos);
    setDimensao(d);
  }
  const rotuloDrill = (d: Dimensao) => rotulos[d] ?? drill[d];

  const fontesDoIndicador = FONTES_EXT.filter((f) => ind.fontes.includes(f.id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Indicador</div>
          <Select value={indicadorId} onValueChange={(v) => { onIndicador(v as IndicadorId); setDrill({}); setRotulos({}); setDimensao("competencia"); }}>
            <SelectTrigger className="h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{INDICADORES_EXT.filter((i) => i.porNota).map((i) => <SelectItem key={i.id} value={i.id}>{i.rotulo}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Agrupar por</div>
          <Select value={dimensao} onValueChange={(v) => setDimensao(v as Dimensao)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{DIMENSOES.map((d) => <SelectItem key={d.id} value={d.id}>{d.rotulo}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={soDif} onChange={(e) => setSoDif(e.target.checked)} />Só o que diverge</label>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button type="button" className="text-primary hover:underline" onClick={() => voltarPara("competencia")}>{ind.rotulo}</button>
        {ordem.filter((d) => drill[d]).map((d) => (
          <span key={d} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button type="button" className="text-primary hover:underline" onClick={() => voltarPara(ordem[ordem.indexOf(d) + 1] ?? d)}>{DIMENSOES.find((x) => x.id === d)!.rotulo}: {rotuloDrill(d)}</button>
          </span>
        ))}
        <span className="text-muted-foreground">· agrupado por {DIMENSOES.find((d) => d.id === dimensao)!.rotulo.toLowerCase()}. Clique numa linha para descer até a nota.</span>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{DIMENSOES.find((d) => d.id === dimensao)!.rotulo}</TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Notas" formula={INFO_COL.detNotas} /></TableHead>
                {fontesDoIndicador.map((f) => <TableHead key={f.id} className="text-right"><TituloComFormula titulo={f.rotulo} formula={<>{INFO_FONTE[f.id]}{INFO_COL.detFonte}</>} /></TableHead>)}
                <TableHead className="text-right"><TituloComFormula titulo="Diferença" formula={INFO_COL.detDiferenca} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Ausentes" formula={INFO_COL.detAusentes} /></TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && <TableRow><TableCell colSpan={6 + fontesDoIndicador.length} className="py-8 text-center text-muted-foreground">Nada divergente neste nível.</TableCell></TableRow>}
              {visiveis.slice(0, 300).map((l) => (
                <TableRow key={l.chave} className={dimensao !== "nota" ? "cursor-pointer hover:bg-muted/40" : ""} onClick={() => dimensao !== "nota" && descer(l.chave, l.rotulo)}>
                  <TableCell className="max-w-[320px] truncate font-medium" title={l.rotulo}>{l.rotulo}</TableCell>
                  <TableCell className="text-right">{l.notas}</TableCell>
                  {fontesDoIndicador.map((f) => <TableCell key={f.id} className="whitespace-nowrap text-right">{l.valores[f.id] === null ? <span className="text-xs italic text-muted-foreground" title="A NF não existe nesta fonte">fora</span> : fmtMoney(l.valores[f.id] as number)}</TableCell>)}
                  <TableCell className={`whitespace-nowrap text-right ${l.diferenca > 0.005 ? "font-semibold text-red-600" : ""}`}>{fmtMoney(l.diferenca)}</TableCell>
                  <TableCell className={`text-right ${l.ausentes ? "font-semibold text-amber-700" : ""}`}>{l.ausentes || "—"}</TableCell>
                  <TableCell>
                    {l.nota && <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); onAbrir({ empresaId: l.nota!.empresaId, competencia: l.nota!.competencia, contratoId: l.nota!.contratoId }); }}><ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir</Button>}
                    {l.nota && onTratar && (l.diferenca > 0.005 || l.ausentes > 0) && <Button size="sm" variant="outline" onClick={(ev) => { ev.stopPropagation(); onTratar(l.nota!.id); }}>Tratar</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {visiveis.length > 300 && <p className="text-xs text-muted-foreground">Mostrando as 300 maiores diferenças; refine pelos filtros ou desça um nível.</p>}
    </div>
  );
}

// ── Impostos e descontos (4.4) ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function AbaImpostosDescontos({ linhas, nomeEmpresa }: { linhas: LinhaImpostosDescontos[]; nomeEmpresa: (id: string) => string }) {
  const [agrupar, setAgrupar] = useState<"nota" | "contrato" | "competencia">("contrato");
  const [soInconsistentes, setSoInconsistentes] = useState(false);
  const base = soInconsistentes ? linhas.filter((l) => l.inconsistencias.length > 0) : linhas;
  type Soma = { chave: string; rotulo: string; notas: number; imp: number; impItens: number; faltas: number; postos: number; multasA: number; multasD: number; glosasA: number; glosasD: number; outrosA: number; outrosD: number; incons: number; textos: string[] };
  const grupos = useMemo(() => {
    const m = new Map<string, Soma>();
    for (const l of base) {
      const chave = agrupar === "nota" ? l.id : agrupar === "contrato" ? l.contratoId : l.competencia;
      const rotulo = agrupar === "nota" ? `${l.numero} · ${l.contratoNome} · ${mesLabel(l.competencia)}` : agrupar === "contrato" ? l.contratoNome : mesLabel(l.competencia);
      const g = m.get(chave) ?? { chave, rotulo, notas: 0, imp: 0, impItens: 0, faltas: 0, postos: 0, multasA: 0, multasD: 0, glosasA: 0, glosasD: 0, outrosA: 0, outrosD: 0, incons: 0, textos: [] };
      g.notas++; g.imp += l.totalImpostos; g.impItens += l.totalImpostosItens; g.faltas += l.faltas; g.postos += l.postos;
      g.multasA += l.multasAntes; g.multasD += l.multasDepois; g.glosasA += l.glosasAntes; g.glosasD += l.glosasDepois; g.outrosA += l.outrosAntes; g.outrosD += l.outrosDepois;
      if (l.inconsistencias.length) { g.incons++; g.textos.push(...l.inconsistencias); }
      m.set(chave, g);
    }
    return [...m.values()].sort((a, b) => b.incons - a.incons || b.imp - a.imp);
  }, [base, agrupar]);
  void nomeEmpresa;
  const total = grupos.reduce((t, g) => ({ imp: t.imp + g.imp, desc: t.desc + g.faltas + g.postos + g.multasA + g.multasD + g.glosasA + g.glosasD + g.outrosA + g.outrosD, incons: t.incons + g.incons }), { imp: 0, desc: 0, incons: 0 });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile info={INFO_KPI.impostos} label="Impostos retidos" valor={fmtMoney(total.imp)} sub="ISSQN, INSS, IR, COFINS, PIS e CSLL das NFs do recorte" cor="sky" icon={<FileText className="h-14 w-14" />} />
        <KpiTile info={INFO_KPI.descontos} label="Descontos (faltas, postos, multas, glosas, outros)" valor={fmtMoney(total.desc)} sub="Antes e depois da emissão" cor="amber" icon={<Wallet className="h-14 w-14" />} />
        <KpiTile info={INFO_KPI.inconsistentes} label="NFs com cabeçalho × itens divergente" valor={String(total.incons)} sub="Impostos ou pós-emissão do cabeçalho ≠ soma dos itens" cor={total.incons ? "red" : "emerald"} icon={<AlertTriangle className="h-14 w-14" />} />
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Agrupar por</div>
          <Select value={agrupar} onValueChange={(v) => setAgrupar(v as typeof agrupar)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="competencia">Competência</SelectItem><SelectItem value="contrato">Contrato</SelectItem><SelectItem value="nota">Nota fiscal</SelectItem></SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={soInconsistentes} onChange={(e) => setSoInconsistentes(e.target.checked)} />Só NFs com inconsistência</label>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>{agrupar === "nota" ? "Nota fiscal" : agrupar === "contrato" ? "Contrato" : "Competência"}</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Impostos (cabeçalho)" formula={INFO_COL.impCabecalho} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Impostos (itens)" formula={INFO_COL.impItens} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Faltas" formula={INFO_COL.faltas} /></TableHead><TableHead className="text-right"><TituloComFormula titulo="Postos" formula={INFO_COL.postos} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Multas antes" formula={INFO_COL.multasAntes} /></TableHead><TableHead className="text-right"><TituloComFormula titulo="Multas depois" formula={INFO_COL.multasDepois} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Glosas antes" formula={INFO_COL.glosasAntes} /></TableHead><TableHead className="text-right"><TituloComFormula titulo="Glosas depois" formula={INFO_COL.glosasDepois} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Outros antes" formula={INFO_COL.outrosAntes} /></TableHead><TableHead className="text-right"><TituloComFormula titulo="Outros depois" formula={INFO_COL.outrosDepois} /></TableHead>
                <TableHead><TituloComFormula alinhar="left" titulo="Inconsistência" formula={INFO_COL.inconsistencia} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.length === 0 && <TableRow><TableCell colSpan={13} className="py-8 text-center text-muted-foreground">Nenhuma NF no recorte.</TableCell></TableRow>}
              {grupos.slice(0, 300).map((g) => (
                <TableRow key={g.chave}>
                  <TableCell className="max-w-[300px] truncate font-medium" title={g.rotulo}>{g.rotulo}</TableCell>
                  <TableCell className="text-right">{g.notas}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{fmtMoney(g.imp)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right ${Math.abs(g.imp - g.impItens) > 0.005 && g.impItens > 0 ? "font-semibold text-red-600" : ""}`}>{fmtMoney(g.impItens)}</TableCell>
                  {[g.faltas, g.postos, g.multasA, g.multasD, g.glosasA, g.glosasD, g.outrosA, g.outrosD].map((v, i) => <TableCell key={i} className="whitespace-nowrap text-right">{fmtMoney(v)}</TableCell>)}
                  <TableCell className="max-w-[320px] whitespace-normal text-[11px] text-red-700">{g.incons ? (agrupar === "nota" ? g.textos.join(" ") : `${g.incons} NF(s)`) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Contas vinculadas (4.5) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function AbaContaVinculada({ linhas }: { linhas: LinhaContaVinculada[] }) {
  const [agrupar, setAgrupar] = useState<"nota" | "contrato" | "competencia">("contrato");
  const [soPendentes, setSoPendentes] = useState(false);
  const base = soPendentes ? linhas.filter((l) => l.pendente > 0.005) : linhas;
  const grupos = useMemo(() => somarContaVinculada(base, (l) => agrupar === "nota"
    ? { chave: l.id, rotulo: `${l.numero} · ${l.contratoNome} · ${mesLabel(l.competencia)}` }
    : agrupar === "contrato" ? { chave: l.contratoId, rotulo: l.contratoNome } : { chave: l.competencia, rotulo: mesLabel(l.competencia) }), [base, agrupar]);
  const total = grupos.reduce((t, g) => ({ d: t.d + g.descontada, r: t.r + g.recebida, p: t.p + g.pendente }), { d: 0, r: 0, p: 0 });
  const porId = useMemo(() => new Map(base.map((l) => [l.id, l])), [base]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile info={INFO_KPI.cvDescontada} label="Descontada nas NFs" valor={fmtMoney(total.d)} sub="Valor retido para a conta vinculada" cor="sky" icon={<FileText className="h-14 w-14" />} />
        <KpiTile info={INFO_KPI.cvRecebida} label="Efetivamente recebida" valor={fmtMoney(total.r)} sub="O que já entrou na conta vinculada" cor="emerald" icon={<CheckCircle2 className="h-14 w-14" />} />
        <KpiTile info={INFO_KPI.cvPendente} label="Pendente" valor={fmtMoney(total.p)} sub="Descontada − recebida, por nota (nunca negativa)" cor={total.p ? "amber" : "emerald"} icon={<Wallet className="h-14 w-14" />} />
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Agrupar por</div>
          <Select value={agrupar} onValueChange={(v) => setAgrupar(v as typeof agrupar)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="competencia">Competência</SelectItem><SelectItem value="contrato">Contrato</SelectItem><SelectItem value="nota">Nota fiscal</SelectItem></SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />Só com saldo pendente</label>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Conta vinculada: descontado × recebido</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{agrupar === "nota" ? "Nota fiscal" : agrupar === "contrato" ? "Contrato" : "Competência"}</TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Notas" formula={INFO_COL.detNotas} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Descontada" formula={INFO_COL.cvDescontadaCol} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Recebida" formula={INFO_COL.cvRecebidaCol} /></TableHead>
                {agrupar === "nota" && <TableHead><TituloComFormula alinhar="left" titulo="Data do recebimento" formula={INFO_COL.cvData} /></TableHead>}
                <TableHead className="text-right"><TituloComFormula titulo="Pendente" formula={INFO_COL.cvPendenteCol} /></TableHead>
                {agrupar === "nota" && <TableHead><TituloComFormula alinhar="left" titulo="Situação" formula={INFO_COL.cvSituacao} /></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma NF com conta vinculada no recorte.</TableCell></TableRow>}
              {grupos.slice(0, 300).map((g) => {
                const l = agrupar === "nota" ? porId.get(g.chave) : undefined;
                return (
                  <TableRow key={g.chave}>
                    <TableCell className="max-w-[340px] truncate font-medium" title={g.rotulo}>{g.rotulo}</TableCell>
                    <TableCell className="text-right">{g.notas}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{fmtMoney(g.descontada)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{fmtMoney(g.recebida)}</TableCell>
                    {agrupar === "nota" && <TableCell className="whitespace-nowrap">{l?.dataRecebimento ? new Date(`${l.dataRecebimento.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—"}</TableCell>}
                    <TableCell className={`whitespace-nowrap text-right ${g.pendente > 0.005 ? "font-semibold text-amber-700" : ""}`}>{fmtMoney(g.pendente)}</TableCell>
                    {agrupar === "nota" && <TableCell>{l ? ROTULO_SITUACAO_CV[l.situacao] : ""}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export type { FonteExt };
