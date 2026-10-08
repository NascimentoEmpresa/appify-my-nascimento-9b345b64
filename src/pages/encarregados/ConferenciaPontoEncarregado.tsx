import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText, History, Info, Loader2, Paperclip, Save, Search, Send, Trash2, Upload, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  useAnexarEnvio, useColaboradoresPonto, useContextoPonto, useDetalheEnvio, useEnviarPonto, useEnviosPonto, useRemoverAnexoEnvio,
  useSalvarEnvio, urlAnexoEnvio, type EnvioPonto,
} from "@/hooks/usePontoEncarregados";
import { addMeses, mesLegivel, mesPadrao, prazoDoMes, faltaPara, fmtDataHora } from "@/lib/conferenciaPonto/conferencia";
import {
  SITUACOES, STATUS_ENVIO, corSituacao, divergeDoRelogio, envioEditavel, montarItens, pendenciasEnvio, resumoItens, sugerirItem,
  type ItemEnvio, type SituacaoItem,
} from "@/lib/conferenciaPonto/envioEncarregado";

// =====================================================================
// ENCARREGADOS › CONFERÊNCIA DE PONTO (mig 20261007000023, 07/10/2026)
//
// Pedido do Pablo: "os encarregados precisam enviar seus pontos pro
// operacional no começo da folha de pagamento — a etapa iniciava no
// operacional, agora vai iniciar no encarregados".
//
// O encarregado escolhe o mês e o contrato (começa no dele), confere a
// lista de colaboradores com a ajuda do relógio (dias com batida e dias
// úteis sem batida), anexa as folhas/espelhos de ponto e envia. Enviado, a
// linha do contrato na Conferência de Ponto vira "Pendente Operacional".
// Devolvido pelo Operacional, volta editável com o motivo.
// Regras em src/lib/conferenciaPonto/envioEncarregado.ts (com teste).
// =====================================================================

export default function ConferenciaPontoEncarregado() {
  const [params] = useSearchParams();
  const ctx = useContextoPonto();
  const [mes, setMes] = useState(mesPadrao());
  const [contrato, setContrato] = useState<string>("");   // "empresa__filial"
  const [posto, setPosto] = useState<string>("");

  // Começa no contrato do próprio encarregado (cadastro dele na Senior).
  useEffect(() => {
    if (!contrato && ctx.data?.eu) setContrato(`${ctx.data.eu.empresa}__${ctx.data.eu.filial}`);
  }, [ctx.data, contrato]);

  const meus = useEnviosPonto({ meus: true });
  // Link da notificação de devolução: ?envio=<id> abre direto naquele envio.
  useEffect(() => {
    const id = Number(params.get("envio"));
    const e = id ? meus.data?.find((x) => x.id === id) : null;
    if (e) { setMes(e.mes_referencia); setContrato(`${e.contrato_empresa}__${e.contrato_filial}`); setPosto(e.posto); }
  }, [params, meus.data]);

  const [empresa, filial] = contrato ? contrato.split("__").map(Number) : [null, null];
  const envio = useMemo(
    () => meus.data?.find((e) => e.mes_referencia === mes && e.contrato_empresa === empresa && e.contrato_filial === filial && e.posto === posto) ?? null,
    [meus.data, mes, empresa, filial, posto],
  );
  const prazo = prazoDoMes(mes);
  const falta = faltaPara(prazo);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Conferência de Ponto"
        subtitle="Confira o ponto da sua equipe no mês, anexe as folhas e envie para o Operacional."
        module="Encarregados"
        breadcrumb={["Conferência de Ponto"]}
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Mês da folha</p>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setMes((m) => addMeses(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex h-9 w-28 items-center justify-center rounded-md border text-sm font-semibold">{mesLegivel(mes)}</div>
            <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setMes((m) => addMeses(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="min-w-[280px] flex-1 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Contrato</p>
          <SearchableSelect
            value={contrato} onChange={(v) => { setContrato(v); setPosto(""); }}
            options={(ctx.data?.contratos ?? []).map((c) => ({ value: `${c.empresa}__${c.filial}`, label: `${c.nome ?? "—"} · filial ${c.filial}` }))}
            placeholder={ctx.isLoading ? "Carregando…" : "Escolha o contrato"} searchPlaceholder="Buscar contrato…" triggerClassName="h-9 w-full"
          />
        </div>
        <div className="ml-auto text-right text-xs">
          <p className="text-muted-foreground">Prazo da folha de {mesLegivel(mes)}</p>
          <p className={cn("font-semibold", falta ? "text-foreground" : "text-destructive")}>
            {prazo.toLocaleDateString("pt-BR")} 17h · {falta ? `faltam ${falta}` : "prazo encerrado"}
          </p>
        </div>
      </Card>

      {ctx.error && <Card className="p-4 text-sm text-destructive">{(ctx.error as Error).message}</Card>}

      {empresa != null && filial != null ? (
        <EditorEnvio key={`${mes}-${contrato}-${posto}`} mes={mes} empresa={empresa} filial={filial}
          posto={posto} setPosto={setPosto} envio={envio} relogioAte={ctx.data?.relogio_ate ?? null} />
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">Escolha o contrato para conferir o ponto.</Card>
      )}

      <MeusEnvios envios={meus.data ?? []} onAbrir={(e) => { setMes(e.mes_referencia); setContrato(`${e.contrato_empresa}__${e.contrato_filial}`); setPosto(e.posto); }} />
    </div>
  );
}

// ---- Editor do envio -----------------------------------------------------------------

function EditorEnvio({ mes, empresa, filial, posto, setPosto, envio, relogioAte }: {
  mes: string; empresa: number; filial: number; posto: string; setPosto: (p: string) => void; envio: EnvioPonto | null; relogioAte: string | null;
}) {
  const colabs = useColaboradoresPonto(empresa, filial, mes);
  const det = useDetalheEnvio(envio?.id ?? null);
  const salvar = useSalvarEnvio();
  const anexar = useAnexarEnvio();
  const remover = useRemoverAnexoEnvio();
  const enviar = useEnviarPonto();
  const editavel = envioEditavel(envio?.status);
  const relogioCobre = !!colabs.data?.relogio_ate;

  const [itens, setItens] = useState<ItemEnvio[] | null>(null);
  const [observacao, setObservacao] = useState(envio?.observacao ?? "");
  const [busca, setBusca] = useState("");
  const [fSit, setFSit] = useState<string>("todas");
  const [sujo, setSujo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const postos = useMemo(() => [...new Set((colabs.data?.colaboradores ?? []).map((c) => c.posto ?? "").filter(Boolean))].sort(), [colabs.data]);

  // Monta a lista quando chegam o contrato e (se houver) o que já foi salvo.
  useEffect(() => {
    if (!colabs.data || (envio && !det.data)) return;
    const doPosto = colabs.data.colaboradores.filter((c) => !posto || c.posto === posto);
    if (envio && !editavel) setItens(det.data!.itens);
    else setItens(montarItens(doPosto, det.data?.itens ?? [], relogioCobre));
    setSujo(false);
  }, [colabs.data, det.data, envio, editavel, posto, relogioCobre]);

  const lista = itens ?? [];
  const resumo = resumoItens(lista);
  const anexos = det.data?.anexos ?? [];
  const pend = pendenciasEnvio(lista, anexos.length);
  const t = busca.trim().toLowerCase();
  const visiveis = lista.map((i, idx) => ({ i, idx })).filter(({ i }) =>
    (fSit === "todas" || i.situacao === fSit) && (!t || `${i.nome} ${i.cadastro ?? ""} ${i.cargo ?? ""} ${i.posto ?? ""}`.toLowerCase().includes(t)));

  const alterar = (idx: number, patch: Partial<ItemEnvio>) => {
    setItens((l) => (l ?? []).map((x, j) => (j === idx ? { ...x, ...patch } : x)));
    setSujo(true);
  };

  const gravar = async (): Promise<number | null> => {
    try {
      const id = await salvar.mutateAsync({ id: envio?.id ?? null, mes_referencia: mes, contrato_empresa: empresa, contrato_filial: filial, posto, observacao, itens: lista });
      setSujo(false);
      return id;
    } catch (e) { toast.error((e as Error).message); return null; }
  };

  const onArquivos = async (files: FileList | null) => {
    if (!files?.length) return;
    const grandes = [...files].filter((f) => f.size > 20 * 1024 * 1024);
    if (grandes.length) toast.error(`Acima de 20 MB: ${grandes.map((f) => f.name).join(", ")}`);
    const ok = [...files].filter((f) => f.size <= 20 * 1024 * 1024);
    if (!ok.length) return;
    // O arquivo mora na pasta do envio: sem envio ainda, salva o rascunho antes.
    const id = envio?.id ?? (await gravar());
    if (!id) return;
    try { await anexar.mutateAsync({ envioId: id, arquivos: ok }); toast.success(`${ok.length} arquivo(s) anexado(s).`); }
    catch (e) { toast.error((e as Error).message); }
    if (arquivoRef.current) arquivoRef.current.value = "";
  };

  const enviarAgora = async () => {
    if (pend.length) { toast.error(pend[0]); return; }
    const id = sujo || !envio ? await gravar() : envio.id;
    if (!id) return;
    try { await enviar.mutateAsync(id); toast.success("Ponto enviado ao Operacional."); }
    catch (e) { toast.error((e as Error).message); }
  };

  const aplicarSugestao = () => {
    if (!colabs.data) return;
    const porId = new Map(colabs.data.colaboradores.map((c) => [c.empregado_id, c]));
    setItens((l) => (l ?? []).map((i) => {
      const c = i.empregado_id != null ? porId.get(i.empregado_id) : null;
      if (!c) return i;
      const s = sugerirItem(c, relogioCobre);
      return { ...i, situacao: s.situacao, faltas: s.faltas };
    }));
    setSujo(true);
    toast.info("Situações sugeridas pelo relógio e pela Senior. Confira antes de enviar.");
  };

  const st = envio ? STATUS_ENVIO[envio.status] : null;

  return (
    <div className="space-y-4">
      {/* Situação do envio */}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        {st ? <Badge variant="outline" className={cn("text-xs", st.cor)}>{st.rotulo}</Badge> : <Badge variant="outline" className="text-xs">Ainda não iniciado</Badge>}
        <p className="text-sm text-muted-foreground">{st ? st.explica : "Confira a lista, anexe as folhas de ponto e envie ao Operacional."}</p>
        {envio?.enviado_em && <span className="text-xs text-muted-foreground">Enviado em {fmtDataHora(envio.enviado_em)}</span>}
        {envio?.recebido_em && <span className="text-xs text-success">Recebido por {envio.recebido_por} em {fmtDataHora(envio.recebido_em)}</span>}
        {postos.length > 1 && (
          <Select value={posto || "*"} onValueChange={(v) => setPosto(v === "*" ? "" : v)} disabled={!!envio && !editavel}>
            <SelectTrigger className="ml-auto h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="*">Contrato inteiro ({colabs.data?.colaboradores.length ?? 0} pessoas)</SelectItem>
              {postos.map((p) => <SelectItem key={p} value={p}>Só o posto: {p}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </Card>
      {envio?.status === "devolvido" && envio.devolucao_motivo && (
        <Card className="flex items-start gap-2 border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div><p className="font-semibold text-destructive">Devolvido por {envio.devolvido_por} em {fmtDataHora(envio.devolvido_em)}</p><p>{envio.devolucao_motivo}</p></div>
        </Card>
      )}

      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniCard rotulo="Colaboradores" valor={resumo.total} />
        <MiniCard rotulo="OK" valor={resumo.por.ok} cor="text-emerald-700" />
        <MiniCard rotulo="Com faltas" valor={resumo.por.faltas} dica={`${resumo.faltas} falta(s) no total`} cor="text-red-700" />
        <MiniCard rotulo="Atestado / afastado / férias" valor={resumo.por.atestado + resumo.por.afastado + resumo.por.ferias} />
        <MiniCard rotulo="Divergências" valor={resumo.por.divergencia} cor="text-orange-700" />
        <MiniCard rotulo="Sem nenhuma batida no mês" valor={resumo.semBatida} dica={relogioCobre ? `relógio até ${new Date(`${colabs.data!.relogio_ate}T12:00:00`).toLocaleDateString("pt-BR")}` : "relógio ainda sem dados do mês"} />
      </div>

      {/* Lista */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <p className="mr-auto text-sm font-semibold">Colaboradores do mês</p>
          <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, cadastro, cargo, posto…" className="h-8 w-60 pl-8 text-xs" /></div>
          <Select value={fSit} onValueChange={setFSit}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as situações</SelectItem>
              {SITUACOES.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
          {editavel && <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={aplicarSugestao}><Wand2 className="h-3.5 w-3.5" /> Sugerir pelo relógio</Button>}
        </div>
        {colabs.isLoading || itens == null ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando a equipe e o relógio…</p>
        ) : colabs.error ? (
          <p className="p-6 text-sm text-destructive">{(colabs.error as Error).message}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card"><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-3 py-2 text-center" title="Dias com batida no relógio / dias úteis sem batida">Relógio</th>
                <th className="px-3 py-2">Situação</th><th className="px-3 py-2">Faltas</th><th className="px-3 py-2">Atrasos</th>
                <th className="px-3 py-2">Horas extras</th><th className="px-3 py-2">Observação</th>
              </tr></thead>
              <tbody>
                {visiveis.map(({ i, idx }) => (
                  <tr key={`${i.empregado_id ?? i.nome}-${idx}`} className={cn("border-t border-border/60 align-top", divergeDoRelogio(i, relogioCobre) && "bg-amber-50 dark:bg-amber-950/20")}>
                    <td className="px-3 py-1.5">
                      <p className="font-medium">{i.nome}</p>
                      <p className="text-[10px] text-muted-foreground">{i.cadastro ? `Cad. ${i.cadastro} · ` : ""}{i.cargo ?? ""}{i.posto ? ` · ${i.posto}` : ""}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                      {relogioCobre ? (
                        <span title={`${i.dias_marcados ?? 0} dia(s) com batida · ${i.dias_sem_marcacao ?? 0} dia(s) útil(eis) sem batida`}>
                          <b className="text-emerald-700">{i.dias_marcados ?? 0}</b> / <b className={(i.dias_sem_marcacao ?? 0) > 0 ? "text-red-600" : "text-muted-foreground"}>{i.dias_sem_marcacao ?? 0}</b>
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {editavel ? (
                        <Select value={i.situacao} onValueChange={(v) => alterar(idx, { situacao: v as SituacaoItem, faltas: v === "faltas" ? Math.max(i.faltas, i.dias_sem_marcacao ?? 0) : i.faltas })}>
                          <SelectTrigger className={cn("h-8 w-32 text-xs", corSituacao(i.situacao))}><SelectValue /></SelectTrigger>
                          <SelectContent>{SITUACOES.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : <Badge variant="outline" className={cn("text-[10px]", corSituacao(i.situacao))}>{SITUACOES.find((s) => s.valor === i.situacao)?.rotulo}</Badge>}
                    </td>
                    <td className="px-3 py-1.5">{editavel ? <Input type="number" min={0} value={i.faltas} onChange={(e) => alterar(idx, { faltas: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-16 text-xs" /> : i.faltas}</td>
                    <td className="px-3 py-1.5">{editavel ? <Input type="number" min={0} value={i.atrasos} onChange={(e) => alterar(idx, { atrasos: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-16 text-xs" /> : i.atrasos}</td>
                    <td className="px-3 py-1.5">{editavel ? <Input value={i.horas_extras} placeholder="ex.: 4h30" onChange={(e) => alterar(idx, { horas_extras: e.target.value })} className="h-8 w-24 text-xs" /> : (i.horas_extras || "—")}</td>
                    <td className="px-3 py-1.5">{editavel ? <Input value={i.observacao} placeholder={i.situacao === "divergencia" ? "Explique a divergência" : ""} onChange={(e) => alterar(idx, { observacao: e.target.value })} className="h-8 min-w-[180px] text-xs" /> : (i.observacao || "—")}</td>
                  </tr>
                ))}
                {!visiveis.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Ninguém com esses filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Relógio = dias com batida / dias úteis (seg–sex) sem batida no mês{relogioAte ? `, até ${new Date(`${relogioAte}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}. Linha amarela: está como OK, mas o relógio tem dia útil sem batida — confira.
        </p>
      </Card>

      {/* Anexos + observação */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip className="h-4 w-4" /> Folhas / espelhos de ponto</p>
            {editavel && (
              <>
                <input ref={arquivoRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => onArquivos(e.target.files)} />
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={anexar.isPending} onClick={() => arquivoRef.current?.click()}>
                  {anexar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Anexar
                </Button>
              </>
            )}
          </div>
          {anexos.length ? (
            <ul className="space-y-1.5">
              {anexos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-primary hover:underline"
                    onClick={async () => { const u = await urlAnexoEnvio(a.storage_path); if (u) window.open(u, "_blank"); else toast.error("Não foi possível abrir o arquivo."); }}>
                    {a.nome_arquivo ?? a.storage_path}
                  </button>
                  {a.tamanho_bytes != null && <span className="text-muted-foreground">{(a.tamanho_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                  {editavel && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remover.mutate(a.id, { onError: (e) => toast.error((e as Error).message) })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Nenhum arquivo. Anexe as folhas de ponto (foto ou PDF) — é obrigatório para enviar.</p>}
        </Card>
        <Card className="space-y-2 p-4">
          <p className="text-sm font-semibold">Observações para o Operacional</p>
          <Textarea value={observacao} disabled={!editavel} rows={4} maxLength={2000}
            onChange={(e) => { setObservacao(e.target.value); setSujo(true); }} placeholder="Ex.: dois colaboradores cobriram o posto da escola X no dia 15." />
          {det.data?.eventos.length ? (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><History className="h-3 w-3" /> Histórico</p>
              {det.data.eventos.map((e) => (
                <p key={e.id} className="text-[11px] text-muted-foreground">
                  {fmtDataHora(e.created_at)} · <b className="text-foreground">{e.acao}</b>{e.autor_nome ? ` · ${e.autor_nome}` : ""}{e.observacao ? ` — ${e.observacao}` : ""}
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      {/* Rodapé */}
      {editavel && (
        <Card className="sticky bottom-2 z-20 flex flex-wrap items-center gap-3 p-3 shadow-lg">
          {pend.length ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {pend.join(" ")}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Pronto para enviar.</p>
          )}
          {sujo && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> alterações não salvas</span>}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" className="gap-1.5" disabled={salvar.isPending} onClick={async () => { if (await gravar()) toast.success("Rascunho salvo."); }}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar rascunho
            </Button>
            <Button className="gap-1.5" disabled={!!pend.length || enviar.isPending || salvar.isPending} onClick={enviarAgora}>
              {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {envio?.status === "devolvido" ? "Reenviar ao Operacional" : "Enviar ao Operacional"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function MiniCard({ rotulo, valor, dica, cor }: { rotulo: string; valor: number; dica?: string; cor?: string }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{rotulo}</p>
      <p className={cn("text-xl font-bold tabular-nums", cor)}>{valor.toLocaleString("pt-BR")}</p>
      {dica && <p className="text-[10px] text-muted-foreground">{dica}</p>}
    </Card>
  );
}

function MeusEnvios({ envios, onAbrir }: { envios: EnvioPonto[]; onAbrir: (e: EnvioPonto) => void }) {
  if (!envios.length) return null;
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Meus envios</p>
      <table className="w-full text-xs">
        <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="px-3 py-2">Mês</th><th className="px-3 py-2">Contrato</th><th className="px-3 py-2">Posto</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Atualizado</th>
        </tr></thead>
        <tbody>
          {envios.map((e) => (
            <tr key={e.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/40" onClick={() => onAbrir(e)}>
              <td className="px-3 py-1.5 font-medium">{mesLegivel(e.mes_referencia)}</td>
              <td className="px-3 py-1.5">{e.contrato_nome ?? "—"} · filial {e.contrato_filial}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{e.posto || "contrato inteiro"}</td>
              <td className="px-3 py-1.5"><Badge variant="outline" className={cn("text-[10px]", STATUS_ENVIO[e.status].cor)}>{STATUS_ENVIO[e.status].rotulo}</Badge></td>
              <td className="px-3 py-1.5 text-muted-foreground">{fmtDataHora(e.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
