import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buscarColaboradores, useFichaAfastamento, useRecalcularLotacao, useRemoverDespesa, useSalvarAfastamento, useSalvarDespesa, useSalvarGlosa,
  type ColaboradorBusca, type FichaAfastamento as Ficha,
} from "@/hooks/useAfastamentos";
import {
  ASSINATURAS, DESPESAS, RESULTADOS, RETORNOS, TELE_STATUS, TIPOS, brl, calcularImpacto, fmtData, rotuloCompetencia,
  type AfastamentoItem, type Impacto, type RetornoStatus, type TeleStatus,
} from "@/lib/sst/afastamentos";

// =====================================================================
// Ficha individual do afastamento (mig 20261028002000): lotação na data,
// atestado + telemedicina, retorno, cobertura (automática + registrada),
// valores do posto e impacto (só com sst_afastamentos_financeiro), notas do
// contrato nas competências e o histórico.
// =====================================================================

const FONTE: Record<string, string> = { efetividade: "Efetividade (cobertura acionada)", diaria: "Diária", registro: "Registrada aqui" };

/** A ficha vira o mesmo item da lista, para a conta do impacto ser uma só. */
export function itemDaFicha(f: Ficha): AfastamentoItem {
  const dias = new Set(f.coberturas.map((c) => c.dia));
  const diasRt = new Set(f.coberturas.filter((c) => c.eh_rt).map((c) => c.dia));
  const custo = f.coberturas.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  return {
    ...(f.afastamento as AfastamentoItem),
    dias_cobertos: dias.size, dias_rt: diasRt.size, custo_cobertura: custo,
    valor_mensal_posto: f.financeiro?.valor_mensal_posto ?? null, salario: f.financeiro?.salario ?? null,
    custo_mensal_posto: f.financeiro?.custo_mensal_posto ?? null, lucro_mensal: f.financeiro?.lucro_mensal ?? null,
    glosa_valor: f.financeiro?.glosa_valor ?? null,
  };
}

const esc = (s: unknown) => String(s ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function imprimir(f: Ficha, imp: Impacto) {
  const a = f.afastamento;
  const linha = (r: string, v: unknown) => `<tr><th>${esc(r)}</th><td>${esc(v)}</td></tr>`;
  const fin = f.ve_financeiro ? `
    <h2>Impacto financeiro</h2><table>
    ${linha("Valor mensal do posto", brl(f.financeiro?.valor_mensal_posto))}
    ${linha("Valor por dia", brl(imp.valorDiaPosto))}
    ${linha("Receita prevista no período", brl(imp.receitaPrevista))}
    ${linha(imp.perdaEstimada ? "Perda de receita (estimada)" : "Glosa / perda de receita", brl(imp.perdaReceita))}
    ${linha("Custo de cobertura", brl(imp.custoCobertura))}
    ${linha("Impacto total", brl(imp.impactoTotal))}
    ${linha("Margem prevista no período", brl(imp.margemPrevista))}
    ${linha("Margem apurada", brl(imp.margemApurada))}
    ${linha("Economia da telemedicina", brl(imp.economiaTelemedicina))}
    </table>` : "";
  const w = window.open("", "_blank");
  if (!w) { toast.error("O navegador bloqueou a janela de impressão."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.protocolo)} — ${esc(a.nome)}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#0f172a}h1{font-size:18px;margin:0}h2{font-size:13px;margin:18px 0 6px;color:#0f3171;text-transform:uppercase}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f1f5f9;width:34%}</style></head><body>
    <h1>Ficha de afastamento ${esc(a.protocolo)}</h1><div>${esc(a.nome)} · emitida em ${new Date().toLocaleString("pt-BR")}</div>
    <h2>Lotação na data do afastamento</h2><table>
    ${linha("Contrato", a.contrato_nome ?? a.contrato_planilha)}${linha("Posto (Planilha de Custo)", a.posto_planilha)}${linha("Posto (Senior)", a.posto_senior)}
    ${linha("Cargo", a.cargo)}${linha("Escala", a.escala)}${linha("Reserva Técnica no contrato", `${f.rt.quantidade} colaborador(es)`)}</table>
    <h2>Atestado e telemedicina</h2><table>
    ${linha("Tipo", TIPOS.find((t) => t.v === a.tipo)?.r)}${linha("Início", fmtData(a.data_inicio))}${linha("Fim", fmtData(f.data_fim))}
    ${linha("Dias do atestado", a.dias_atestado)}${linha("Telemedicina", TELE_STATUS[a.tele_status]?.r)}${linha("Data da telemedicina", fmtData(a.tele_data))}
    ${linha("Resultado", RESULTADOS.find((r) => r.v === a.tele_resultado)?.r)}${linha("Dias após a avaliação", a.dias_apos_tele)}
    ${linha("Dias evitados", imp.diasEvitados)}${linha("Retorno", RETORNOS[a.retorno_status]?.r)}${linha("Retornou em", fmtData(a.retornou_em))}</table>
    <h2>Cobertura</h2><table>${linha("Dias do afastamento", imp.dias)}${linha("Dias cobertos", imp.diasCobertos)}${linha("Dias sem cobertura", imp.diasDescobertos)}
    ${linha("Dias cobertos por RT", itemDaFicha(f).dias_rt)}${linha("Custo de cobertura", brl(imp.custoCobertura))}</table>${fin}
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export function FichaAfastamentoDialog({ id, podeAlterar, onFechar }: { id: number | null; podeAlterar: boolean; onFechar: () => void }) {
  const q = useFichaAfastamento(id);
  const f = q.data;
  return (
    <Dialog open={id != null} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        {q.isLoading || !f ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            {q.error ? <span className="text-red-600">{(q.error as Error).message}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Carregando a ficha…</>}
          </div>
        ) : <Conteudo f={f} podeAlterar={podeAlterar} />}
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#0f3171]">{titulo}</h3>{acao}
      </div>
      {children}
    </section>
  );
}
function Info({ r, v, destaque }: { r: string; v: React.ReactNode; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-muted-foreground">{r}</div>
      <div className={cn("text-sm", destaque && "font-bold text-[#0f3171]")}>{v ?? "—"}</div>
    </div>
  );
}

function Conteudo({ f, podeAlterar }: { f: Ficha; podeAlterar: boolean }) {
  const a = f.afastamento;
  const item = useMemo(() => itemDaFicha(f), [f]);
  const imp = useMemo(() => calcularImpacto(item), [item]);
  const salvar = useSalvarAfastamento();
  const recalc = useRecalcularLotacao();

  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    const s = (v: unknown) => (v == null ? "" : String(v));
    setForm({
      tipo: s(a.tipo), data_inicio: s(a.data_inicio), dias_atestado: s(a.dias_atestado), cid: s(a.cid), medico: s(a.medico),
      observacao: s(a.observacao), tele_status: s(a.tele_status), tele_data: s(a.tele_data), tele_horario: s(a.tele_horario),
      tele_encaminhamento: s(a.tele_encaminhamento), tele_avaliacao: s(a.tele_avaliacao), tele_resultado: s(a.tele_resultado),
      dias_apos_tele: s(a.dias_apos_tele), assinatura: s(a.assinatura), ponto: s(a.ponto), encarregado_nome: s(a.encarregado_nome),
      retorno_status: s(a.retorno_status), retornou_em: s(a.retornou_em), acompanhamento: s(a.acompanhamento),
    });
  }, [a]);
  const set = (k: string, v: string) => setForm((x) => ({ ...x, [k]: v }));
  const dis = !podeAlterar;

  const gravar = async (extra: Record<string, unknown> = {}) => {
    try {
      await salvar.mutateAsync({ id: a.id, ...form, ...extra });
      toast.success("Afastamento atualizado.");
    } catch (e) { toast.error((e as Error).message); }
  };

  const campo = (k: string, r: string, tipo = "text", ph?: string) => (
    <div className="space-y-1"><Label className="text-xs">{r}</Label>
      <Input type={tipo} value={form[k] ?? ""} disabled={dis} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></div>
  );
  const escolha = (k: string, r: string, ops: { v: string; r: string }[], vazio = true) => (
    <div className="space-y-1"><Label className="text-xs">{r}</Label>
      <Select value={form[k] || "_"} disabled={dis} onValueChange={(v) => set(k, v === "_" ? "" : v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {vazio && <SelectItem value="_">—</SelectItem>}
          {ops.map((o) => <SelectItem key={o.v} value={o.v}>{o.r}</SelectItem>)}
        </SelectContent>
      </Select></div>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {a.nome}
          <span className="text-sm font-normal text-muted-foreground">{a.protocolo}</span>
          <Badge variant="outline" className={TELE_STATUS[a.tele_status as TeleStatus]?.cor}>{TELE_STATUS[a.tele_status as TeleStatus]?.r}</Badge>
          <Badge variant="outline" className={RETORNOS[a.retorno_status as RetornoStatus]?.cor}>{RETORNOS[a.retorno_status as RetornoStatus]?.r}</Badge>
          {a.cancelado && <Badge variant="destructive">Cancelado</Badge>}
          {!a.empregado_id && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Sem cadastro no ERP</Badge>}
        </DialogTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{fmtData(a.data_inicio)} a {fmtData(f.data_fim)} · {imp.dias} dia(s)</span>
          <span>· origem: {a.origem === "senior" ? "Senior (automático)" : a.origem === "planilha" ? "planilha importada" : "registro manual"}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => imprimir(f, imp)}><Printer className="mr-1 h-4 w-4" /> Imprimir ficha</Button>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4">
        <Secao titulo="Lotação na data do afastamento"
          acao={podeAlterar && a.empregado_id ? (
            <Button size="sm" variant="ghost" disabled={recalc.isPending}
              onClick={() => recalc.mutateAsync(a.id).then(() => toast.success("Lotação recalculada."), (e) => toast.error((e as Error).message))}>
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", recalc.isPending && "animate-spin")} /> Recalcular
            </Button>) : undefined}>
          {!a.empregado_id ? (
            <>
              <p className="text-sm text-amber-800">O nome da planilha não foi encontrado no cadastro (EMPREGADOS) — sem lotação automática. Contrato informado na planilha: <b>{String(a.contrato_planilha ?? "—")}</b>.</p>
              {podeAlterar && <Vincular id={a.id} nome={a.nome} />}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Info r="Contrato" v={a.contrato_nome ?? <span className="text-amber-700">não identificado</span>} destaque />
              <Info r="Posto (Planilha de Custo)" v={a.posto_planilha ?? <span className="text-amber-700">sem posto ligado</span>} />
              <Info r="Posto (Senior)" v={a.posto_senior} />
              <Info r="Filial (Senior)" v={String(a.filial_nome ?? "—")} />
              <Info r="Cargo" v={a.cargo} />
              <Info r="Escala" v={a.escala} />
              <Info r="Situação hoje (Senior)" v={f.empregado?.situacao} />
              <Info r="Reserva Técnica no contrato" v={f.rt.quantidade > 0 ? `${f.rt.quantidade} colaborador(es)` : "Não há RT"} />
            </div>
          )}
          {f.rt.colaboradores.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">RT do contrato: {f.rt.colaboradores.join(", ")}</p>
          )}
        </Secao>

        <Secao titulo="Atestado">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {escolha("tipo", "Tipo", TIPOS, false)}
            {campo("data_inicio", "Início do afastamento", "date")}
            {campo("dias_atestado", "Dias do atestado", "number", "em aberto")}
            {campo("cid", "CID (opcional)")}
            {campo("medico", "Médico / unidade")}
            <div className="col-span-2 md:col-span-3">{campo("observacao", "Observação")}</div>
          </div>
        </Secao>

        <Secao titulo="Telemedicina">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {escolha("tele_status", "Situação", Object.entries(TELE_STATUS).map(([v, x]) => ({ v, r: x.r })), false)}
            {campo("tele_data", "Data", "date")}
            {campo("tele_horario", "Horário", "time")}
            {campo("encarregado_nome", "Encarregado responsável")}
            <div className="col-span-2">{campo("tele_encaminhamento", "Encaminhamento")}</div>
            <div className="col-span-2">{campo("tele_avaliacao", "Avaliação")}</div>
            {escolha("tele_resultado", "Resultado", RESULTADOS)}
            {campo("dias_apos_tele", "Dias após a avaliação", "number")}
            {escolha("assinatura", "Assinatura do atestado", ASSINATURAS)}
            {escolha("ponto", "Ponto", [{ v: "cumpriu", r: "Cumpriu" }, { v: "nao_cumpriu", r: "Não cumpriu" }])}
          </div>
          {imp.diasEvitados > 0 && (
            <p className="mt-2 text-sm text-emerald-700">✔ A telemedicina evitou <b>{imp.diasEvitados}</b> dia(s) de afastamento
              {f.ve_financeiro && imp.economiaTelemedicina != null ? <> — {brl(imp.economiaTelemedicina)} de posto preservado.</> : "."}</p>
          )}
        </Secao>

        <Secao titulo="Acompanhamento do retorno">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {escolha("retorno_status", "Retorno", Object.entries(RETORNOS).map(([v, x]) => ({ v, r: x.r })), false)}
            {campo("retornou_em", "Retornou em", "date")}
            <div className="col-span-2">{campo("acompanhamento", "Acompanhamento")}</div>
          </div>
          {f.empregado?.situacao && <p className="mt-2 text-xs text-muted-foreground">Senior hoje: {f.empregado.situacao}{f.empregado.data_afastamento ? ` desde ${f.empregado.data_afastamento}` : ""}. O retorno é marcado sozinho quando a situação volta a "Trabalhando".</p>}
        </Secao>

        {podeAlterar && (
          <div className="flex flex-wrap justify-end gap-2">
            {!a.cancelado && <Button variant="outline" className="text-red-700" onClick={() => {
              const m = window.prompt("Motivo do cancelamento (registro duplicado, atestado inválido…):");
              if (m && m.trim()) gravar({ cancelado: true, cancelado_motivo: m.trim() });
            }}>Cancelar afastamento</Button>}
            <Button onClick={() => gravar()} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar alterações</Button>
          </div>
        )}

        <Cobertura f={f} imp={imp} podeAlterar={podeAlterar} diasRt={item.dias_rt} />

        {f.ve_financeiro && <Financeiro f={f} imp={imp} podeAlterar={podeAlterar} />}

        <Secao titulo="Histórico">
          {f.historico_colaborador.length > 0 && (
            <div className="mb-3 text-sm">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Outros afastamentos do colaborador ({f.historico_colaborador.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {f.historico_colaborador.map((h) => (
                  <Badge key={h.id} variant="outline">{fmtData(h.data_inicio)} · {h.dias ?? "?"} dia(s) · {TELE_STATUS[h.tele_status as TeleStatus]?.r}</Badge>
                ))}
              </div>
            </div>
          )}
          <ul className="space-y-1 text-sm">
            {f.eventos.map((e) => (
              <li key={e.id} className="flex gap-2"><span className="w-32 shrink-0 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</span>
                <span>{e.descricao}{e.autor_nome ? <span className="text-xs text-muted-foreground"> — {e.autor_nome}</span> : null}</span></li>
            ))}
          </ul>
        </Secao>
      </div>
    </>
  );
}

/** Nome da planilha sem cadastro igual: escolher a pessoa certa liga e calcula a lotação. */
function Vincular({ id, nome }: { id: number; nome: string }) {
  const [busca, setBusca] = useState(nome.split(" ").slice(0, 2).join(" "));
  const [ops, setOps] = useState<ColaboradorBusca[]>([]);
  const salvar = useSalvarAfastamento();
  useEffect(() => {
    if (busca.trim().length < 3) { setOps([]); return; }
    const t = setTimeout(() => { buscarColaboradores(busca).then(setOps, () => setOps([])); }, 250);
    return () => clearTimeout(t);
  }, [busca]);
  return (
    <div className="mt-2 space-y-1">
      <Label className="text-xs">Vincular ao cadastro</Label>
      <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CPF" />
      {ops.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded border">
          {ops.map((o) => (
            <button key={o.id} type="button" className="block w-full border-b px-3 py-1.5 text-left text-sm last:border-0 hover:bg-muted"
              onClick={() => salvar.mutateAsync({ id, empregado_id: o.id }).then(() => toast.success("Vinculado — lotação calculada."), (e) => toast.error((e as Error).message))}>
              <b>{o.nome}</b> <span className="text-xs text-muted-foreground">{o.cargo} · {o.filial} · {o.situacao}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Cobertura({ f, imp, podeAlterar, diasRt }: { f: Ficha; imp: Impacto; podeAlterar: boolean; diasRt: number }) {
  const salvar = useSalvarDespesa();
  const remover = useRemoverDespesa();
  const vazio = { tipo: "hora_extra", data: f.afastamento.data_inicio, dias: "1", substituto_nome: "", horas: "", valor: "", descricao: "" };
  const [d, setD] = useState(vazio);
  const add = async () => {
    try {
      await salvar.mutateAsync({ afastamento_id: f.afastamento.id, ...d, valor: d.valor.replace(",", "."), horas: d.horas.replace(",", ".") });
      setD(vazio); toast.success("Cobertura registrada.");
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Secao titulo="Cobertura da ausência — RT, substituições, horas extras e despesas">
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Info r="Dias do afastamento" v={imp.dias} destaque />
        <Info r="Dias cobertos" v={imp.diasCobertos} />
        <Info r="Dias sem cobertura" v={<span className={imp.diasDescobertos > 0 ? "font-bold text-red-700" : ""}>{imp.diasDescobertos}</span>} />
        <Info r="Cobertos por RT" v={diasRt} />
        <Info r="Custo de cobertura" v={brl(imp.custoCobertura)} />
      </div>
      {/* As registradas aqui vêm um dia por linha do banco — ficam só na lista delas, abaixo. */}
      {f.coberturas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma cobertura encontrada na Efetividade, nas Diárias ou registrada aqui.</p>
      ) : !f.coberturas.some((c) => c.fonte !== "registro") ? null : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Dia</th><th>Fonte</th><th>Quem cobriu</th><th className="text-right">Valor</th></tr></thead>
            <tbody>
              {f.coberturas.filter((c) => c.fonte !== "registro").map((c, i) => (
                <tr key={i} className="border-t"><td className="py-1">{fmtData(c.dia)}</td><td>{FONTE[c.fonte]}</td>
                  <td>{c.substituto ?? "—"}{c.eh_rt && <Badge variant="outline" className="ml-1 border-indigo-200 bg-indigo-50 text-indigo-700">RT</Badge>}</td>
                  <td className="text-right">{c.valor ? brl(Number(c.valor)) : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {f.despesas.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">Registradas neste afastamento</div>
          <ul className="space-y-1 text-sm">
            {f.despesas.map((x) => (
              <li key={x.id} className="flex items-center gap-2 rounded border px-2 py-1">
                <span className="font-medium">{DESPESAS.find((t) => t.v === x.tipo)?.r ?? x.tipo}</span>
                <span className="text-muted-foreground">{fmtData(x.data)}{x.dias > 1 ? ` (+${x.dias - 1} dias)` : ""}{x.substituto_nome ? ` · ${x.substituto_nome}` : ""}{x.horas ? ` · ${x.horas}h` : ""}{x.descricao ? ` · ${x.descricao}` : ""}</span>
                <span className="ml-auto font-semibold">{brl(Number(x.valor))}</span>
                {podeAlterar && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remover.mutate(x.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {podeAlterar && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 md:grid-cols-7">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Tipo</Label>
            <Select value={d.tipo} onValueChange={(v) => setD({ ...d, tipo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DESPESAS.map((t) => <SelectItem key={t.v} value={t.v}>{t.r}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1"><Label className="text-xs">A partir de</Label><Input type="date" value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Dias</Label><Input type="number" min={0} value={d.dias} onChange={(e) => setD({ ...d, dias: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Quem cobriu</Label><Input value={d.substituto_nome} onChange={(e) => setD({ ...d, substituto_nome: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Horas</Label><Input value={d.horas} onChange={(e) => setD({ ...d, horas: e.target.value })} placeholder="ex.: 8" /></div>
          <div className="space-y-1"><Label className="text-xs">Valor (R$)</Label><Input value={d.valor} onChange={(e) => setD({ ...d, valor: e.target.value })} placeholder="0,00" /></div>
          <div className="col-span-2 space-y-1 md:col-span-6"><Label className="text-xs">Descrição</Label><Input value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} placeholder="Ex.: remanejado do posto X; HE de 4h do colega" /></div>
          <div className="flex items-end"><Button className="w-full" onClick={add} disabled={salvar.isPending}>Registrar</Button></div>
        </div>
      )}
    </Secao>
  );
}

function Financeiro({ f, imp, podeAlterar }: { f: Ficha; imp: Impacto; podeAlterar: boolean }) {
  const fin = f.financeiro;
  const glosa = useSalvarGlosa();
  const [g, setG] = useState({ valor: fin?.glosa_valor != null ? String(fin.glosa_valor) : "", obs: fin?.glosa_obs ?? "" });
  return (
    <Secao titulo="Valores do posto e impacto financeiro">
      {!fin?.valor_mensal_posto ? (
        <p className="mb-3 text-sm text-amber-800">Sem valor do posto: o colaborador não está ligado a um posto da Planilha de Custo do contrato (RH › Ativos/Contratos) ou a planilha não tem o posto. O impacto fica só com o custo de cobertura.</p>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Info r="Valor mensal do posto" v={brl(fin.valor_mensal_posto)} destaque />
          <Info r="Valor por dia" v={brl(imp.valorDiaPosto)} />
          <Info r="Custo mensal do posto" v={brl(fin.custo_mensal_posto)} />
          <Info r="Salário" v={brl(fin.salario)} />
          <Info r="Planilha vigente desde" v={fmtData(fin.planilha_vigencia)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
        <Info r="Receita prevista no período" v={brl(imp.receitaPrevista)} />
        <Info r={imp.perdaEstimada ? "Perda de receita (estimada)" : "Glosa / perda informada"} v={brl(imp.perdaReceita)} />
        <Info r="Custo de cobertura" v={brl(imp.custoCobertura)} />
        <Info r="Impacto total" v={<span className="font-bold text-red-700">{brl(imp.impactoTotal ?? imp.custoCobertura)}</span>} />
        <Info r="Margem prevista no período" v={brl(imp.margemPrevista)} />
        <Info r="Margem apurada" v={<span className={(imp.margemApurada ?? 0) < 0 ? "font-bold text-red-700" : "font-bold text-emerald-700"}>{brl(imp.margemApurada)}</span>} />
        <Info r="Custo do titular (até 15 dias)" v={brl(imp.custoTitularEmpresa)} />
        <Info r="Economia da telemedicina" v={brl(imp.economiaTelemedicina)} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Perda estimada = dias sem cobertura × valor/dia do posto (valor mensal ÷ 30). Informe a glosa real quando o contratante descontar na nota. Margem = (valor − custo mensal do posto) ÷ 30 × dias, menos o impacto.
      </p>
      {podeAlterar && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Glosa / perda de receita informada (R$)</Label>
            <Input className="w-48" value={g.valor} onChange={(e) => setG({ ...g, valor: e.target.value })} placeholder="vazio = estimada" /></div>
          <div className="min-w-[240px] flex-1 space-y-1"><Label className="text-xs">Observação</Label>
            <Textarea rows={1} value={g.obs} onChange={(e) => setG({ ...g, obs: e.target.value })} placeholder="Ex.: desconto na NF de jun/2026, item faltas" /></div>
          <Button variant="outline" disabled={glosa.isPending} onClick={() => {
            const v = g.valor.trim() ? Number(g.valor.replace(/\./g, "").replace(",", ".")) : null;
            if (v != null && !Number.isFinite(v)) { toast.error("Valor inválido."); return; }
            glosa.mutateAsync({ id: f.afastamento.id, valor: v, obs: g.obs }).then(() => toast.success("Glosa salva."), (e) => toast.error((e as Error).message));
          }}>Salvar glosa</Button>
        </div>
      )}
      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold text-muted-foreground">Faturamento do contrato nas competências do afastamento (Emissão de NF)</div>
        {!f.notas?.length ? <p className="text-sm text-muted-foreground">Nenhuma nota emitida para o contrato nessas competências.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Competência</th><th>NF</th><th className="text-right">Bruto</th><th className="text-right">Faltas</th><th className="text-right">Glosas</th><th className="text-right">Outros desc.</th><th className="text-right">Líquido</th></tr></thead>
            <tbody>{f.notas.map((n, i) => (
              <tr key={i} className="border-t"><td className="py-1">{rotuloCompetencia(n.competencia.slice(0, 7))}</td><td>{n.numero_nf ?? n.status}</td>
                <td className="text-right">{brl(n.bruto)}</td><td className="text-right">{brl(n.faltas)}</td><td className="text-right">{brl(n.glosas)}</td>
                <td className="text-right">{brl(n.outros_descontos)}</td><td className="text-right">{brl(n.liquido)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </Secao>
  );
}
