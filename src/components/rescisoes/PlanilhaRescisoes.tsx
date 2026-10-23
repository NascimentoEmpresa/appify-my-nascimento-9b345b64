import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { corDoStatus, fmtData } from "@/lib/demissao/solicitacao";
import {
  HOMOLOGACOES, OPCOES_PROGRAMADAS, STATUS_RESCISAO, TIPOS_DESLIGAMENTO,
  corStatusRescisao, demissaoCancelada, pagamentoAtrasado, patchDaCelula, patchProgramadas, patchTextoDocumento,
  textoDocumento, textoProgramadas,
  type LinhaRescisao, type RescisaoRH,
} from "@/lib/demissao/rescisao";
import { AlertTriangle, ExternalLink } from "lucide-react";
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
 */

const POR_PAGINA = 100;

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
  return (
    <select
      value={valor ?? ""}
      disabled={disabled}
      title={titulo ?? valor ?? undefined}
      onChange={(e) => onSalvar(e.target.value || null)}
      className={cn(
        "h-7 w-full cursor-pointer truncate rounded border border-transparent bg-transparent px-1 text-[12px] uppercase outline-none",
        "hover:border-border focus:border-primary disabled:cursor-default disabled:opacity-100",
        className,
      )}
    >
      <option value="">{vazio}</option>
      {opcoes.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}
    </select>
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
        className="h-7 w-full rounded border border-primary bg-background px-1 text-[12px] outline-none"
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
        "block h-7 w-full truncate rounded border border-transparent px-1 text-left text-[12px] uppercase",
        !disabled && "hover:border-border",
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
  const [exibir, setExibir] = useState(POR_PAGINA);
  useEffect(() => { setExibir(POR_PAGINA); }, [linhas.length]);

  const th = "sticky top-0 z-20 whitespace-nowrap border-b border-r border-emerald-800 bg-emerald-700 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-white";
  const fixa = "sticky z-10 bg-inherit";
  const td = "border-b border-r px-1 py-0.5 align-middle";

  const salvar = (l: LinhaRescisao, patch: Partial<RescisaoRH>) => onSalvar(l, patchDaCelula(l, patch));

  return (
    <div className="rounded-lg border">
      <div className="max-h-[calc(100vh-330px)] min-h-[320px] overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className={cn(th, "left-0 z-30")} style={{ width: LARGURA.recebido, minWidth: LARGURA.recebido, left: ESQUERDA.recebido }}>Recebido</th>
              <th className={cn(th, "z-30")} style={{ width: LARGURA.empresa, minWidth: LARGURA.empresa, left: ESQUERDA.empresa }}>Empresa</th>
              <th className={cn(th, "z-30")} style={{ width: LARGURA.mat, minWidth: LARGURA.mat, left: ESQUERDA.mat }}>Mat</th>
              <th className={cn(th, "z-30 shadow-[2px_0_0_0_rgba(0,0,0,0.08)]")} style={{ width: LARGURA.nome, minWidth: LARGURA.nome, left: ESQUERDA.nome }}>Funcionário</th>
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
            {linhas.slice(0, exibir).map((l, i) => {
              const atrasada = pagamentoAtrasado(l, hoje);
              const cancelada = demissaoCancelada(l);
              const doErp = !!l.solicitacao;
              const s = (patch: Partial<RescisaoRH>) => salvar(l, patch);
              return (
                // Cores OPACAS: as colunas fixas herdam o fundo da linha e,
                // transparente, o texto que passa por baixo apareceria.
                <tr key={l.chave} className={cn(
                  cancelada ? "bg-red-50 dark:bg-red-950" : i % 2 ? "bg-slate-50 dark:bg-slate-900" : "bg-background",
                  "hover:bg-sky-50 dark:hover:bg-slate-800",
                )}>
                  <td className={cn(td, fixa)} style={{ left: ESQUERDA.recebido }}>
                    <CelulaEditavel tipo="date" valor={l.recebido} exibir={fmtCurta(l.recebido) || undefined} disabled={!podeEditar}
                      onSalvar={(v) => s({ data_recebimento: v })} />
                  </td>
                  <td className={cn(td, fixa, "px-2 font-semibold")} style={{ left: ESQUERDA.empresa }}>{l.empresa ?? ""}</td>
                  <td className={cn(td, fixa, "px-2 tabular-nums")} style={{ left: ESQUERDA.mat }}>{l.matricula ?? ""}</td>
                  <td className={cn(td, fixa, "shadow-[2px_0_0_0_rgba(0,0,0,0.08)]")} style={{ left: ESQUERDA.nome, maxWidth: LARGURA.nome }}>
                    <button type="button" onClick={() => onAbrir(l)} title="Abrir a ficha"
                      className="block w-full truncate px-1 text-left text-[12px] font-semibold uppercase text-primary hover:underline">
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
                  <td className={cn(td, "px-2 uppercase")} title={l.contrato ?? undefined}>
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
                  <td className={td}>
                    <select
                      value={l.statusRescisao ?? ""}
                      disabled={!podeEditar}
                      onChange={(e) => e.target.value && s({ status_rescisao: e.target.value })}
                      className={cn(
                        "h-7 w-full cursor-pointer rounded border px-1 text-[11px] font-bold uppercase outline-none focus:ring-2 focus:ring-primary/40",
                        "disabled:cursor-default disabled:opacity-100",
                        corStatusRescisao(l.statusRescisao),
                      )}
                    >
                      {STATUS_RESCISAO.map((st) => <option key={st} value={st} className="bg-background text-foreground">{st.toUpperCase()}</option>)}
                    </select>
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
      {linhas.length > exibir && (
        <div className="border-t p-2 text-center">
          <Button variant="outline" size="sm" onClick={() => setExibir((n) => n + POR_PAGINA * 3)}>
            Mostrar mais ({linhas.length - exibir} restantes)
          </Button>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>Clique na célula para editar — salva sozinho (Enter confirma, Esc desiste).</span>
        <span>Mudar o último dia ou o tipo recalcula demissão (+7 no trabalhado) e pagamento (+5).</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-200" /> pagamento vencido com a rescisão por fazer</span>
        <span className="inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" /> o nome abre a ficha completa</span>
      </p>
    </div>
  );
}
