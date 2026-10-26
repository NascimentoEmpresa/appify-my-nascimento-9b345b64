import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { corDoStatus, fmtData } from "@/lib/demissao/solicitacao";
import {
  HOMOLOGACOES, OPCOES_PROGRAMADAS, STATUS_RESCISAO, TIPOS_DESLIGAMENTO,
  corStatusRescisao, demissaoCancelada, pagamentoAtrasado, patchDaCelula, patchProgramadas, patchTextoDocumento,
  textoDocumento, textoProgramadas,
  type LinhaRescisao, type RescisaoRH,
} from "@/lib/demissao/rescisao";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * RECURSOS HUMANOS › RESCISÕES — a PLANILHA DE RESCISÃO Geral 2026 do RH,
 * coluna por coluna e na mesma ordem (22/10/2026, "tem que parecer a
 * planilha só que melhor"). O que ficou melhor que o Excel:
 *   · cada célula salva sozinha (lista suspensa, data ou texto), com o
 *     histórico de status gravado pelo banco;
 *   · mudar o último dia ou o tipo recalcula demissão e pagamento pela régua
 *     da planilha (se ninguém tinha digitado outra data ali);
 *   · pagamento vencido com a rescisão por fazer em vermelho, e a demissão
 *     cancelada no ERP depois de entrar na planilha sinalizada na linha;
 *   · a linha do ERP chega sozinha quando o RH libera a demissão.
 * O nome abre a ficha (tudo da linha, a planilha original e o histórico).
 *
 * 26/10/2026 ("melhorar o layout e colocar paginação, deixa mais bonito"):
 * o "Mostrar mais" virou paginação de verdade (páginas numeradas e 25/50/100
 * por página, lembrado no navegador); grade mais leve, setas das listas só ao
 * passar o mouse, empresa em selo e status em pílula.
 */

const TAMANHOS = [25, 50, 100] as const;
const CHAVE_TAMANHO = "rescisoes.porPagina";

function tamanhoSalvo(): number {
  try {
    const n = Number(localStorage.getItem(CHAVE_TAMANHO));
    return (TAMANHOS as readonly number[]).includes(n) ? n : 50;
  } catch { return 50; }
}

/** Páginas a mostrar: a primeira, a última e duas em volta da atual; null = "…". */
export function paginasVisiveis(pagina: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const meio = [pagina - 1, pagina, pagina + 1].filter((p) => p > 1 && p < total);
  const out: (number | null)[] = [1];
  if (meio[0] > 2) out.push(null);
  out.push(...meio);
  if (meio[meio.length - 1] < total - 1) out.push(null);
  out.push(total);
  return out;
}

type Salvar = (l: LinhaRescisao, patch: Partial<RescisaoRH>) => Promise<void>;

// Larguras fixas: as quatro primeiras colunas ficam paradas ao rolar para o lado.
const LARGURA = { recebido: 84, empresa: 60, mat: 64, nome: 250 } as const;
const ESQUERDA = { recebido: 0, empresa: 84, mat: 144, nome: 208 } as const;

const fmtCurta = (iso: string | null) => (iso ? fmtData(iso) : "");

// ── Células editáveis ────────────────────────────────────────────────

function CelulaSelect({ valor, opcoes, onSalvar, disabled, className, vazio = "—", titulo }: {
  valor: string | null; opcoes: readonly string[]; onSalvar: (v: string | null) => void;
  disabled?: boolean; className?: string; vazio?: string; titulo?: string;
}) {
  // Seta só no hover: com ela em toda célula a planilha virava um mar de "⌄".
  return (
    <div className="group relative">
      <select
        value={valor ?? ""}
        disabled={disabled}
        title={titulo ?? valor ?? undefined}
        onChange={(e) => onSalvar(e.target.value || null)}
        className={cn(
          "h-7 w-full cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent py-0 pl-1.5 pr-5 text-[12px] uppercase outline-none transition-colors",
          "hover:border-border hover:bg-background focus:border-primary focus:bg-background disabled:cursor-default disabled:opacity-100",
          !valor && "text-muted-foreground/60",
          className,
        )}
      >
        <option value="">{vazio}</option>
        {opcoes.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}
      </select>
      {!disabled && (
        <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  );
}

function CelulaEditavel({ valor, exibir, tipo = "text", onSalvar, disabled, className, placeholder }: {
  valor: string | null; exibir?: React.ReactNode; tipo?: "text" | "date"; onSalvar: (v: string | null) => void;
  disabled?: boolean; className?: string; placeholder?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editando) { setTexto(valor ?? ""); setTimeout(() => ref.current?.focus(), 0); } }, [editando, valor]);

  const confirmar = () => {
    setEditando(false);
    const novo = texto.trim() || null;
    if (novo !== (valor ?? null)) onSalvar(novo);
  };

  if (editando) {
    return (
      <input
        ref={ref}
        type={tipo}
        value={texto}
        placeholder={placeholder}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirmar(); }
          if (e.key === "Escape") { e.preventDefault(); setEditando(false); }
        }}
        className="h-7 w-full rounded-md border border-primary bg-background px-1.5 text-[12px] outline-none ring-2 ring-primary/15"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditando(true)}
      title={valor ?? undefined}
      className={cn(
        "block h-7 w-full truncate rounded-md border border-transparent px-1.5 text-left text-[12px] uppercase tabular-nums transition-colors",
        !disabled && "hover:border-border hover:bg-background",
        disabled && "cursor-default",
        className,
      )}
    >
      {exibir ?? (valor || <span className="text-muted-foreground/50">{disabled ? "" : "—"}</span>)}
    </button>
  );
}

// ── A planilha ───────────────────────────────────────────────────────

export function PlanilhaRescisoes({ linhas, hoje, podeEditar, onAbrir, onSalvar }: {
  linhas: LinhaRescisao[];
  hoje: string;
  podeEditar: boolean;
  onAbrir: (l: LinhaRescisao) => void;
  onSalvar: Salvar;
}) {
  const [porPagina, setPorPagina] = useState(tamanhoSalvo);
  const [pagina, setPagina] = useState(1);
  const rolagem = useRef<HTMLDivElement>(null);
  // Filtro mudou (a quantidade muda): volta para a primeira página. Editar
  // uma célula não muda a quantidade, então não tira a pessoa da página.
  useEffect(() => { setPagina(1); }, [linhas.length]);

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  const atual = Math.min(pagina, totalPaginas);
  const ini = (atual - 1) * porPagina;
  const daPagina = linhas.slice(ini, ini + porPagina);

  const irPara = (p: number) => {
    setPagina(Math.min(Math.max(1, p), totalPaginas));
    rolagem.current?.scrollTo({ top: 0 });
  };
  const trocarTamanho = (n: number) => {
    setPorPagina(n);
    try { localStorage.setItem(CHAVE_TAMANHO, String(n)); } catch { /* sem armazenamento: só não lembra */ }
    // Mantém a primeira linha que estava na tela.
    setPagina(Math.floor(ini / n) + 1);
    rolagem.current?.scrollTo({ top: 0 });
  };

  const th = "sticky top-0 z-20 whitespace-nowrap border-b border-emerald-900/40 bg-emerald-800 px-2.5 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-emerald-50";
  const fixa = "sticky z-10 bg-inherit";
  const td = "border-b border-slate-100 px-1 py-1 align-middle dark:border-slate-800";

  const salvar = (l: LinhaRescisao, patch: Partial<RescisaoRH>) => onSalvar(l, patchDaCelula(l, patch));

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div ref={rolagem} className="max-h-[calc(100vh-340px)] min-h-[320px] overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className={cn(th, "left-0 z-30")} style={{ width: LARGURA.recebido, minWidth: LARGURA.recebido, left: ESQUERDA.recebido }}>Recebido</th>
              <th className={cn(th, "z-30")} style={{ width: LARGURA.empresa, minWidth: LARGURA.empresa, left: ESQUERDA.empresa }}>Empresa</th>
              <th className={cn(th, "z-30")} style={{ width: LARGURA.mat, minWidth: LARGURA.mat, left: ESQUERDA.mat }}>Mat</th>
              <th className={cn(th, "z-30 shadow-[1px_0_0_0_rgba(255,255,255,0.15)]")} style={{ width: LARGURA.nome, minWidth: LARGURA.nome, left: ESQUERDA.nome }}>Funcionário</th>
              <th className={th} style={{ minWidth: 200 }}>Contrato</th>
              <th className={th} style={{ minWidth: 140 }}>Homologação</th>
              <th className={th} style={{ minWidth: 92 }}>Planilha SST</th>
              <th className={th} style={{ minWidth: 104 }}>Aviso</th>
              <th className={th} style={{ minWidth: 150 }}>Solicitado por</th>
              <th className={th} style={{ minWidth: 104 }}>Último dia</th>
              <th className={th} style={{ minWidth: 104 }}>Demissão</th>
              <th className={th} style={{ minWidth: 112 }}>Pagamento</th>
              <th className={th} style={{ minWidth: 230 }}>Tipo de desl.</th>
              <th className={th} style={{ minWidth: 170 }}>Programadas</th>
              <th className={th} style={{ minWidth: 230 }}>Malote</th>
              <th className={th} style={{ minWidth: 230 }}>Envio da documentação</th>
              <th className={th} style={{ minWidth: 230 }}>Retorno da documentação</th>
              <th className={th} style={{ minWidth: 230 }}>Status</th>
              <th className={th} style={{ minWidth: 220 }}>Observação</th>
            </tr>
          </thead>
          <tbody>
            {daPagina.map((l, i) => {
              const atrasada = pagamentoAtrasado(l, hoje);
              const cancelada = demissaoCancelada(l);
              const doErp = !!l.solicitacao;
              const s = (patch: Partial<RescisaoRH>) => salvar(l, patch);
              return (
                // Cores OPACAS: as colunas fixas herdam o fundo da linha e,
                // transparente, o texto que passa por baixo apareceria.
                <tr key={l.chave} className={cn(
                  "transition-colors",
                  cancelada ? "bg-red-50 dark:bg-red-950" : i % 2 ? "bg-slate-50 dark:bg-slate-900" : "bg-card",
                  "hover:bg-sky-50 dark:hover:bg-slate-800",
                )}>
                  <td className={cn(td, fixa, "text-muted-foreground")} style={{ left: ESQUERDA.recebido }}>
                    <CelulaEditavel tipo="date" valor={l.recebido} exibir={fmtCurta(l.recebido) || undefined} disabled={!podeEditar}
                      onSalvar={(v) => s({ data_recebimento: v })} />
                  </td>
                  <td className={cn(td, fixa, "px-2")} style={{ left: ESQUERDA.empresa }}>
                    {l.empresa && <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100">{l.empresa}</span>}
                  </td>
                  <td className={cn(td, fixa, "px-2 tabular-nums text-muted-foreground")} style={{ left: ESQUERDA.mat }}>{l.matricula ?? ""}</td>
                  <td className={cn(td, fixa, "shadow-[1px_0_0_0_rgba(15,23,42,0.08)]")} style={{ left: ESQUERDA.nome, maxWidth: LARGURA.nome }}>
                    <button type="button" onClick={() => onAbrir(l)} title="Abrir a ficha"
                      className="block w-full truncate px-1.5 text-left text-[12px] font-semibold uppercase text-primary hover:underline">
                      {l.nome}
                    </button>
                    {(doErp || cancelada) && (
                      <div className="flex items-center gap-1 px-1 pb-0.5">
                        {doErp && (
                          <span className={cn("truncate rounded border px-1 text-[10px] leading-4", corDoStatus(l.statusFluxo ?? ""))}
                            title={`Solicitação #${l.solicitacao!.id} no ERP: ${l.statusFluxo}`}>
                            ERP #{l.solicitacao!.id}{cancelada ? ` · ${l.statusFluxo}` : ""}
                          </span>
                        )}
                        {cancelada && <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" aria-label="Demissão cancelada no ERP" />}
                      </div>
                    )}
                  </td>
                  <td className={cn(td, "px-2.5 uppercase text-slate-700 dark:text-slate-200")} title={l.contrato ?? undefined}>
                    <span className="block max-w-[260px] truncate">{l.contrato ?? ""}</span>
                  </td>
                  <td className={td}>
                    <CelulaSelect valor={l.homologacao} opcoes={HOMOLOGACOES} disabled={!podeEditar} onSalvar={(v) => s({ homologacao: v })} />
                  </td>
                  <td className={td}>
                    {doErp ? (
                      <span className={cn("block px-1 text-[12px] font-semibold", l.sstOk ? "text-emerald-700" : "text-amber-700")}
                        title="Vem do fluxo: OK quando o SST já resolveu o ASO demissional">
                        {l.sstOk ? "OK" : "NÃO"}
                      </span>
                    ) : (
                      <CelulaSelect valor={l.sstOk == null ? null : l.sstOk ? "OK" : "Não"} opcoes={["OK", "Não"]} disabled={!podeEditar}
                        onSalvar={(v) => s({ sst_ok: v == null ? null : v === "OK" })} />
                    )}
                  </td>
                  <td className={td}>
                    <CelulaEditavel tipo="date" valor={l.aviso} exibir={fmtCurta(l.aviso) || undefined} disabled={!podeEditar}
                      onSalvar={(v) => s({ data_aviso: v })} />
                  </td>
                  <td className={td}>
                    <CelulaEditavel valor={l.solicitadoPor} disabled={!podeEditar} onSalvar={(v) => s({ solicitado_por: v })} />
                  </td>
                  <td className={td}>
                    <CelulaEditavel tipo="date" valor={l.ultimoDia} exibir={fmtCurta(l.ultimoDia) || undefined} disabled={!podeEditar}
                      onSalvar={(v) => s({ data_ultimo_dia: v })} />
                  </td>
                  <td className={td}>
                    <CelulaEditavel tipo="date" valor={l.demissao} exibir={fmtCurta(l.demissao) || undefined} disabled={!podeEditar}
                      onSalvar={(v) => s({ data_demissao: v })} />
                  </td>
                  <td className={cn(td, atrasada && "bg-red-100")}>
                    <CelulaEditavel tipo="date" valor={l.pagamento} disabled={!podeEditar}
                      className={cn("font-semibold", atrasada && "text-red-700")}
                      exibir={l.pagamento ? (
                        <span className="inline-flex items-center gap-1" title={atrasada ? "Pagamento vencido com a rescisão ainda por fazer" : undefined}>
                          {fmtCurta(l.pagamento)}{atrasada && <AlertTriangle className="h-3 w-3" />}
                        </span>
                      ) : undefined}
                      onSalvar={(v) => s({ data_pagamento: v })} />
                  </td>
                  <td className={td}>
                    <CelulaSelect valor={l.tipo} opcoes={TIPOS_DESLIGAMENTO} disabled={!podeEditar} onSalvar={(v) => s({ tipo_desligamento: v })} />
                  </td>
                  <td className={td}>
                    <CelulaSelect valor={textoProgramadas(l) || null} opcoes={OPCOES_PROGRAMADAS} disabled={!podeEditar}
                      className={cn(l.rescisaoProgramada && l.valesProgramados && "font-semibold text-emerald-700")}
                      onSalvar={(v) => s(patchProgramadas(v ?? ""))} />
                  </td>
                  <td className={td}>
                    <CelulaEditavel valor={textoDocumento(null, l.maloteData, l.maloteObs) || null} disabled={!podeEditar}
                      placeholder="RESCISAO E FGTS MALOTE 05/01/2026" onSalvar={(v) => s(patchTextoDocumento("malote", v ?? ""))} />
                  </td>
                  <td className={td}>
                    <CelulaEditavel valor={textoDocumento(l.envioMeio, l.envioData, l.envioObs) || null} disabled={!podeEditar}
                      placeholder="ENVIADO ZAPSIGN - 09/01/2026" onSalvar={(v) => s(patchTextoDocumento("envio", v ?? ""))} />
                  </td>
                  <td className={td}>
                    <CelulaEditavel valor={textoDocumento(l.retornoMeio, l.retornoData, l.retornoObs) || null} disabled={!podeEditar}
                      placeholder="RETORNOU ZAPSIGN - 13/01/2026" onSalvar={(v) => s(patchTextoDocumento("retorno", v ?? ""))} />
                  </td>
                  <td className={cn(td, "px-1.5")}>
                    <div className="group relative">
                      <select
                        value={l.statusRescisao ?? ""}
                        disabled={!podeEditar}
                        onChange={(e) => e.target.value && s({ status_rescisao: e.target.value })}
                        className={cn(
                          "h-7 w-full cursor-pointer appearance-none truncate rounded-full border py-0 pl-3 pr-6 text-[10.5px] font-bold uppercase tracking-wide outline-none focus:ring-2 focus:ring-primary/40",
                          "disabled:cursor-default disabled:opacity-100",
                          corStatusRescisao(l.statusRescisao),
                        )}
                      >
                        {STATUS_RESCISAO.map((st) => <option key={st} value={st} className="bg-background text-foreground">{st.toUpperCase()}</option>)}
                      </select>
                      {podeEditar && <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />}
                    </div>
                  </td>
                  <td className={td}>
                    <CelulaEditavel valor={l.observacao} disabled={!podeEditar} onSalvar={(v) => s({ observacao: v })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Paginação: quantos, páginas numeradas e tamanho da página. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">
          Mostrando <b className="tabular-nums text-foreground">{(ini + 1).toLocaleString("pt-BR")}–{(ini + daPagina.length).toLocaleString("pt-BR")}</b> de{" "}
          <b className="tabular-nums text-foreground">{linhas.length.toLocaleString("pt-BR")}</b>
        </span>
        {totalPaginas > 1 && (
          <nav className="flex items-center gap-1" aria-label="Páginas">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={atual <= 1} onClick={() => irPara(1)} title="Primeira página"><ChevronsLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={atual <= 1} onClick={() => irPara(atual - 1)} title="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
            {paginasVisiveis(atual, totalPaginas).map((p, k) => p == null
              ? <span key={`r${k}`} className="px-1 text-muted-foreground">…</span>
              : (
                <Button key={p} size="sm" variant={p === atual ? "default" : "ghost"} aria-current={p === atual ? "page" : undefined}
                  className={cn("h-8 min-w-8 px-2 tabular-nums", p === atual && "pointer-events-none")} onClick={() => irPara(p)}>
                  {p}
                </Button>
              ))}
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={atual >= totalPaginas} onClick={() => irPara(atual + 1)} title="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={atual >= totalPaginas} onClick={() => irPara(totalPaginas)} title="Última página"><ChevronsRight className="h-4 w-4" /></Button>
          </nav>
        )}
        <label className="flex items-center gap-2 text-muted-foreground">
          Por página
          <select value={porPagina} onChange={(e) => trocarTamanho(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30">
            {TAMANHOS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <span>Clique na célula para editar — salva sozinho (Enter confirma, Esc desiste).</span>
        <span>Mudar o último dia ou o tipo recalcula demissão (+7 no trabalhado) e pagamento (+5).</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-200" /> pagamento vencido com a rescisão por fazer</span>
        <span className="inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" /> o nome abre a ficha completa</span>
      </p>
    </div>
  );
}
