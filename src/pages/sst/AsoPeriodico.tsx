import { useMemo, useState, type ReactNode } from "react";
import { FileText, Loader2, Paperclip, Search, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  abrirAsoPeriodico, useAnexarAso, useConfigAsoPeriodico, useListaAsoPeriodico, useRemoverAso, useSalvarCiclo,
  useSalvarConfigPeriodico, useSalvarPeriodicidadeContrato, type DadosCiclo,
} from "@/hooks/useAsoPeriodico";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  CARTAO_AFASTADOS, DIAS_AVISO, PAINEL, PERIODICIDADE_PADRAO_MESES, ROTULO_MOTIVO_AFASTAMENTO, ROTULO_TIPO, STATUS_PERIODICO,
  calcularVencimento, contarPainel, diasParaVencer, erroConfig, erroMesesContrato, fmtData, hojeIso, nomeContrato, ordenar,
  casaBusca, contaNoPainel, empresaDoItem, funcaoDoItem, ordenarAfastados, pendenciasParaRealizar, rotuloPeriodicidade,
  type ChavePainel, type CicloPeriodico, type ConfigAsoPeriodico, type ContratoPeriodicidade, type ItemPeriodico,
  type StatusAsoPeriodico,
} from "@/lib/sst/asoPeriodico";
import { cn } from "@/lib/utils";

// =====================================================================
// SST › ASO PERIÓDICO (mig 20261114100000)
//
// O ERP mostra sozinho quem tem o periódico vencido ou perto de vencer
// (UFFS a cada 1 ano, demais a cada 2, contando do último ASO: admissional,
// periódico, retorno ou troca de função). O SST só pede o agendamento à
// clínica e acompanha até o ASO em mãos. Cada cartão do painel filtra a lista.
//
// SIS-2026-0918 (mig 20261117020000): periodicidade por contrato e janela de
// "próximo do vencimento" saem da configuração (botão "Configurar
// vencimentos"), não mais de regra fixa no código.
//
// SIS-2026-0886 (mig 20261119190000): afastado por aposentadoria, benefício
// do INSS ou licença-maternidade sai das pendências e dos cartões delas; o
// cartão "Afastados (fora das pendências)" lista todos, com motivo e
// previsão de retorno. Agendado/realizado de afastado segue no status dele.
// =====================================================================

const COR_STATUS: Record<StatusAsoPeriodico, string> = {
  Vencido: "bg-red-600 text-white",
  "Próximo do vencimento": "bg-amber-400 text-amber-950",
  "Aguardando agendamento": "bg-sky-600 text-white",
  Agendado: "bg-indigo-600 text-white",
  "Realizado/recebido": "bg-emerald-600 text-white",
  "Em dia": "bg-muted text-foreground",
  "Sem ASO": "bg-muted text-foreground",
  Afastado: "bg-slate-500 text-white",
};

const PREVISTOS = PAINEL.find((p) => p.chave === "previstos")!.status;

export default function AsoPeriodico() {
  const podeAlterar = useScreenAccess("sst_aso_periodico", "alterar").data === true;
  const { data: itens = [], isLoading, error } = useListaAsoPeriodico();
  const hoje = hojeIso();
  const [cartao, setCartao] = useState<ChavePainel | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("previstos");
  const [contrato, setContrato] = useState("todos");
  const [empresa, setEmpresa] = useState("todas");
  const [estimados, setEstimados] = useState(false);
  const [aberto, setAberto] = useState<ItemPeriodico | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const { data: config } = useConfigAsoPeriodico();
  const diasAviso = config?.dias_aviso ?? DIAS_AVISO;
  const padrao = config?.periodicidade_padrao_meses ?? PERIODICIDADE_PADRAO_MESES;
  const comPeriodicidadePropria = config?.contratos.filter((c) => c.periodicidade_meses != null) ?? [];

  const painel = useMemo(() => contarPainel(itens), [itens]);
  const contratos = useMemo(() => [...new Set(itens.map(nomeContrato))].sort(), [itens]);
  const empresas = useMemo(() => [...new Set(itens.map(empresaDoItem))].sort(), [itens]);

  const visiveis = useMemo(() => {
    const doCartao = PAINEL.find((p) => p.chave === cartao)?.status;
    const afastados = cartao === CARTAO_AFASTADOS.chave;
    return itens
      // SIS-2026-0918 (19/11): cartões e "Previstos" batem com a contagem — sem afastados.
      .filter((i) => afastados ? !!i.afastamento : doCartao ? contaNoPainel(i) && doCartao.includes(i.status)
        : status === "todos" || (status === "previstos" ? contaNoPainel(i) && PREVISTOS.includes(i.status) : i.status === status))
      .filter((i) => contrato === "todos" || nomeContrato(i) === contrato)
      .filter((i) => empresa === "todas" || empresaDoItem(i) === empresa)
      .filter((i) => !estimados || i.ultimo_tipo === "admissao_estimada")
      .filter((i) => casaBusca(i, busca))
      .sort(afastados ? ordenarAfastados : ordenar);
  }, [itens, cartao, busca, status, contrato, empresa, estimados]);

  return (
    <div className="space-y-4">
      <PageHeader title="ASO Periódico" module="SST" breadcrumb={["ASO Periódico"]}
        subtitle={`Vencimento automático pelo último ASO (admissional, periódico, retorno ou mudança de função) — ${
          comPeriodicidadePropria.length ? `${comPeriodicidadePropria.length} contrato(s) com periodicidade própria, ` : ""
        }demais a cada ${rotuloPeriodicidade(padrao)}. "Próximo" = vence em até ${diasAviso} dias.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => setConfigAberta(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> Configurar vencimentos
          </Button>
        } />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {[...PAINEL, CARTAO_AFASTADOS].map((p) => {
          const ativo = cartao === p.chave;
          return (
            <button key={p.chave} type="button" aria-pressed={ativo} onClick={() => setCartao(ativo ? null : p.chave)}
              className={cn("rounded-lg border bg-card p-3 text-left transition hover:border-primary", ativo && "border-primary ring-2 ring-primary/30",
                p.chave === "vencidos" && painel.vencidos > 0 && "border-red-300 bg-red-50",
                p.chave === CARTAO_AFASTADOS.chave && "border-dashed")}
              title={p.chave === CARTAO_AFASTADOS.chave
                ? "Aposentadoria, benefício do INSS ou licença-maternidade: não entram nas pendências enquanto durar o afastamento. Férias e atestado continuam na lista."
                : undefined}>
              <span className="block text-2xl font-bold">{painel[p.chave]}</span>
              <span className="block text-xs text-muted-foreground">{p.titulo}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Colaborador, empresa, função, contrato ou clínica" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Filtro rotulo="Status" valor={status} aoMudar={(v) => { setStatus(v); setCartao(null); }} largura="w-56"
          opcoes={[["previstos", "Previstos (sem os em dia)"], ["todos", "Todos os ativos"], ...STATUS_PERIODICO.map((s) => [s, s] as [string, string])]} />
        <Filtro rotulo="Empresa" valor={empresa} aoMudar={setEmpresa} largura="w-40" opcoes={[["todas", "Todas"], ...empresas.map((e) => [e, e] as [string, string])]} />
        <Filtro rotulo="Contrato" valor={contrato} aoMudar={setContrato} largura="w-64" opcoes={[["todos", "Todos"], ...contratos.map((c) => [c, c] as [string, string])]} />
        <label className="flex h-10 items-center gap-2 text-sm">
          <Checkbox checked={estimados} onCheckedChange={(v) => setEstimados(v === true)} /> Só estimados pela admissão
        </label>
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1300px]">
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Último ASO</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Solicitação / agendamento</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Nenhum colaborador neste filtro.</TableCell></TableRow>
            ) : visiveis.map((i) => <Linha key={i.cpf} i={i} hoje={hoje} podeAlterar={podeAlterar} onAbrir={() => setAberto(i)} />)}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">
        {visiveis.length} de {itens.length} colaborador(es) ativo(s).
        {painel.afastados > 0 && ` ${painel.afastados} afastado(s) por aposentadoria, benefício do INSS ou licença-maternidade ficam fora da contagem dos periódicos (veja no cartão "Afastados") e voltam sozinhos quando a Senior marcar o retorno. MEI não entra na lista.`}
      </p>

      {aberto && <CicloDialog item={aberto} podeAlterar={podeAlterar} onFechar={() => setAberto(null)} />}
      {configAberta && <ConfigDialog config={config} podeAlterar={podeAlterar} onFechar={() => setConfigAberta(false)} />}
    </div>
  );
}

function Linha({ i, hoje, podeAlterar, onAbrir }: { i: ItemPeriodico; hoje: string; podeAlterar: boolean; onAbrir: () => void }) {
  const dias = diasParaVencer(i, hoje);
  const c = i.ciclo;
  const acao = c ? "Atualizar" : i.status === "Realizado/recebido" ? "Ver ASO" : "Solicitar agendamento";
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{i.nome}</span>
        {i.situacao && i.situacao !== "Trabalhando" && <span className="block text-xs text-muted-foreground">{i.situacao}</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" className="font-semibold" title={i.empresa_nome ?? undefined}>{empresaDoItem(i)}</Badge>
      </TableCell>
      <TableCell className="max-w-56">
        <span className={cn("block font-medium", !i.cargo?.trim() && "font-normal text-amber-700")}>{funcaoDoItem(i)}</span>
      </TableCell>
      <TableCell className="max-w-56">
        <span className="block truncate" title={nomeContrato(i)}>{nomeContrato(i)}</span>
        <span className="block text-xs text-muted-foreground">
          a cada {rotuloPeriodicidade(i.periodicidade_meses)}{i.periodicidade_origem === "padrao" ? " (padrão)" : ""}
        </span>
        {/* null = a lista nova não achou o contrato; undefined = RPC antiga, não marca. */}
        {i.contrato_id === null && (
          <span className="block text-xs font-medium text-amber-700" title="A filial/local da Senior não casou com nenhum contrato do ERP: vale a periodicidade padrão.">
            contrato não identificado
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {fmtData(i.ultimo_aso)}
        {i.ultimo_tipo && (
          <span className={cn("block text-xs", i.ultimo_tipo === "admissao_estimada" ? "font-medium text-amber-700" : "text-muted-foreground")}
            title={i.ultimo_tipo === "admissao_estimada" ? "Nenhum ASO registrado no ERP: conta da admissão da Senior. Registre o último periódico para corrigir." : undefined}>
            {ROTULO_TIPO[i.ultimo_tipo]}
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {fmtData(i.vencimento)}
        {dias != null && (
          <span className={cn("block text-xs", dias < 0 ? "font-semibold text-red-700" : "text-muted-foreground")}>
            {dias < 0 ? `vencido há ${-dias} dia(s)` : dias === 0 ? "vence hoje" : `em ${dias} dia(s)`}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge className={cn("whitespace-normal", COR_STATUS[i.status])}>{i.status}</Badge>
        {i.status === "Realizado/recebido" && i.ultimo_periodico?.resultado === "inapto" && <Badge variant="destructive" className="ml-1">Inapto</Badge>}
        {i.afastamento && i.status !== "Afastado" && <Badge className={cn("ml-1", COR_STATUS.Afastado)}>Afastado</Badge>}
        {i.afastamento && (
          <span className="mt-1 block text-xs text-muted-foreground"
            title={i.afastamento.fonte === "senior" ? `Situação na Senior: ${i.afastamento.situacao ?? "—"}` : "Pelo Controle de Afastamentos do SST"}>
            {ROTULO_MOTIVO_AFASTAMENTO[i.afastamento.motivo] ?? i.afastamento.situacao}
            {i.afastamento.desde ? ` desde ${fmtData(i.afastamento.desde)}` : ""}
            <span className={cn("block", i.afastamento.previsao_retorno && i.afastamento.previsao_retorno < hoje && "font-medium text-amber-700")}>
              {i.afastamento.previsao_retorno ? `retorno previsto ${fmtData(i.afastamento.previsao_retorno)}` : "sem previsão de retorno"}
            </span>
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {c ? (
          <>
            <span className="block">Solicitado {fmtData(c.solicitado_em)}</span>
            {c.agendado_para && <span className="block">Agendado {fmtData(c.agendado_para)}{c.clinica ? ` · ${c.clinica}` : ""}</span>}
          </>
        ) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-right">
        {(podeAlterar || i.status === "Realizado/recebido" || c) && (
          <Button size="sm" variant={c || i.status === "Realizado/recebido" || i.status === "Afastado" ? "outline" : "default"} onClick={onAbrir}>
            {podeAlterar ? acao : "Ver"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function Filtro({ rotulo, valor, aoMudar, opcoes, largura }: { rotulo: string; valor: string; aoMudar: (v: string) => void; opcoes: [string, string][]; largura: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <Select value={valor} onValueChange={aoMudar}>
        <SelectTrigger className={largura} aria-label={rotulo}><SelectValue /></SelectTrigger>
        <SelectContent>{opcoes.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

const vazio = (hoje: string): DadosCiclo => ({
  solicitado_em: hoje, agendado_para: null, clinica: null, realizado: false, realizado_em: null, resultado: null, observacao: null,
});

const doCiclo = (c: CicloPeriodico): DadosCiclo => ({
  id: c.id, solicitado_em: c.solicitado_em, agendado_para: c.agendado_para, clinica: c.clinica, realizado: c.realizado,
  realizado_em: c.realizado_em, resultado: c.resultado, observacao: c.observacao,
});

function CicloDialog({ item, podeAlterar, onFechar }: { item: ItemPeriodico; podeAlterar: boolean; onFechar: () => void }) {
  const hoje = hojeIso();
  // Ciclo em aberto → edita; periódico realizado e em dia → corrige esse; senão abre um novo.
  const existente = item.ciclo ?? (item.status === "Realizado/recebido" ? item.ultimo_periodico : null);
  const [f, setF] = useState<DadosCiclo>(existente ? doCiclo(existente) : vazio(hoje));
  const [jaFeito, setJaFeito] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const salvar = useSalvarCiclo();
  const anexar = useAnexarAso();
  const remover = useRemoverAso();
  const muda = <K extends keyof DadosCiclo>(k: K, v: DadosCiclo[K]) => setF((x) => ({ ...x, [k]: v }));
  const so = !podeAlterar;
  const ocupado = salvar.isPending || anexar.isPending;
  const proximo = f.realizado && f.realizado_em ? calcularVencimento(f.realizado_em, item.periodicidade_meses) : null;

  const enviar = async () => {
    const dados: DadosCiclo = jaFeito ? { ...f, solicitado_em: null, agendado_para: null, realizado: true } : f;
    if (!dados.realizado && !dados.solicitado_em) { toast.error("Informe a data da solicitação do agendamento."); return; }
    if (dados.realizado) {
      const falta = pendenciasParaRealizar(dados, hoje);
      if (falta.length) { toast.error(`Para marcar como realizado/recebido: ${falta.join(", ")}.`); return; }
    }
    try {
      const id = await salvar.mutateAsync({ ...dados, cpf: item.cpf });
      if (arquivo) await anexar.mutateAsync({ id, arquivo });
      toast.success(dados.realizado ? "ASO periódico registrado como realizado/recebido." : "ASO periódico salvo.");
      onFechar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const titulo = existente ? (existente.realizado ? "ASO periódico realizado" : "Acompanhar ASO periódico") : "Solicitar agendamento do ASO periódico";
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            <span className="block font-medium text-foreground">{item.nome}</span>
            <span className="block">Função: <strong>{funcaoDoItem(item)}</strong> · Empresa: <strong>{empresaDoItem(item)}</strong>{item.empresa_nome && item.empresa_nome !== empresaDoItem(item) ? ` (${item.empresa_nome})` : ""}</span>
            {nomeContrato(item)} · último ASO {fmtData(item.ultimo_aso)}
            {item.ultimo_tipo ? ` (${ROTULO_TIPO[item.ultimo_tipo].toLowerCase()})` : ""} · vence {fmtData(existente?.vencimento_previsto ?? item.vencimento)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!existente && podeAlterar && (
            <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <Checkbox className="mt-0.5" checked={jaFeito} onCheckedChange={(v) => { setJaFeito(v === true); muda("realizado", v === true); }} />
              <span>Registrar um periódico já realizado (sem solicitação pelo ERP)
                <span className="block text-xs text-muted-foreground">Use para corrigir quem aparece pela admissão estimada ou fez o exame por fora.</span>
              </span>
            </label>
          )}

          {!jaFeito && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="ap-sol" rotulo="Data da solicitação">
                <Input id="ap-sol" type="date" max={hoje} disabled={so} value={f.solicitado_em ?? ""} onChange={(e) => muda("solicitado_em", e.target.value || null)} />
              </Campo>
              <Campo id="ap-age" rotulo="Data do agendamento">
                <Input id="ap-age" type="date" disabled={so} value={f.agendado_para ?? ""} onChange={(e) => muda("agendado_para", e.target.value || null)} />
              </Campo>
            </div>
          )}
          <Campo id="ap-cli" rotulo="Clínica responsável">
            <Input id="ap-cli" disabled={so} placeholder="Ex.: Zielo" value={f.clinica ?? ""} onChange={(e) => muda("clinica", e.target.value || null)} />
          </Campo>

          <div className="space-y-3 rounded-md border p-3">
            {!jaFeito && (
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox disabled={so} checked={f.realizado} onCheckedChange={(v) => muda("realizado", v === true)} /> Realizado/recebido
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="ap-real" rotulo="Data da realização">
                <Input id="ap-real" type="date" max={hoje} disabled={so} value={f.realizado_em ?? ""} onChange={(e) => muda("realizado_em", e.target.value || null)} />
              </Campo>
              <Campo id="ap-res" rotulo="Resultado">
                <Select disabled={so} value={f.resultado ?? ""} onValueChange={(v) => muda("resultado", v === "apto" || v === "inapto" ? v : null)}>
                  <SelectTrigger id="ap-res" aria-label="Resultado"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent><SelectItem value="apto">Apto</SelectItem><SelectItem value="inapto">Inapto</SelectItem></SelectContent>
                </Select>
              </Campo>
            </div>
            {proximo && <p className="text-xs text-muted-foreground">Próximo vencimento: <strong>{fmtData(proximo)}</strong></p>}
            {f.resultado === "inapto" && <p className="text-xs font-medium text-red-700">Inapto: avise o RH e o Operacional sobre o afastamento da função.</p>}
          </div>

          <Campo id="ap-aso" rotulo="ASO (arquivo)">
            {existente?.aso_path ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <button type="button" className="flex items-center gap-1 text-primary hover:underline" onClick={() => abrirAsoPeriodico(existente.aso_path!).catch((e) => toast.error((e as Error).message))}>
                  <FileText className="h-4 w-4" /> {existente.aso_nome ?? "ASO"}
                </button>
                {podeAlterar && (
                  <Button type="button" size="sm" variant="ghost" disabled={remover.isPending} aria-label="Remover ASO"
                    onClick={() => remover.mutateAsync(existente.id).then(() => { toast.success("ASO removido."); onFechar(); }, (e) => toast.error((e as Error).message))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : null}
            {podeAlterar && (
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <Input id="ap-aso" type="file" accept=".pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
              </div>
            )}
            {!existente?.aso_path && !podeAlterar && <p className="text-sm text-muted-foreground">Sem ASO anexado.</p>}
          </Campo>

          <Campo id="ap-obs" rotulo="Observação">
            <Textarea id="ap-obs" rows={2} disabled={so} value={f.observacao ?? ""} onChange={(e) => muda("observacao", e.target.value || null)} />
          </Campo>

          {existente && (
            <p className="text-xs text-muted-foreground">
              Aberto por {existente.created_por_nome ?? "—"}{existente.atualizado_por_nome ? ` · última alteração por ${existente.atualizado_por_nome}` : ""}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>{podeAlterar ? "Cancelar" : "Fechar"}</Button>
            {podeAlterar && (
              <Button onClick={enviar} disabled={ocupado}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Configuração (SIS-2026-0918) ─────────────────────────────────────────
// Geral: dias de aviso e periodicidade padrão. Por contrato: a periodicidade
// própria (UFFS nasce com 1 ano pela migration); vazio = usa o padrão.
function ConfigDialog({ config, podeAlterar, onFechar }: { config: ConfigAsoPeriodico | undefined; podeAlterar: boolean; onFechar: () => void }) {
  const [dias, setDias] = useState(String(config?.dias_aviso ?? DIAS_AVISO));
  const [padrao, setPadrao] = useState(String(config?.periodicidade_padrao_meses ?? PERIODICIDADE_PADRAO_MESES));
  const [busca, setBusca] = useState("");
  const salvar = useSalvarConfigPeriodico();
  const so = !podeAlterar;

  const contratos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (config?.contratos ?? []).filter((c) => !q || c.nome.toLowerCase().includes(q));
  }, [config, busca]);

  const enviar = () => {
    const d = Number(dias), p = Number(padrao);
    const e = erroConfig(d, p);
    if (e) { toast.error(e); return; }
    salvar.mutateAsync({ dias_aviso: d, periodicidade_padrao_meses: p })
      .then(() => toast.success("Configuração salva. Vencimentos e status recalculados."), (x) => toast.error((x as Error).message));
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar vencimentos do ASO periódico</DialogTitle>
          <DialogDescription>
            O vencimento conta do último ASO realizado. Contrato sem periodicidade própria usa o padrão.
            {config?.atualizado_por_nome ? ` Última alteração por ${config.atualizado_por_nome}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {!config ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-4">
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Campo id="cfg-dias" rotulo='Dias para "próximo do vencimento"'>
                <Input id="cfg-dias" type="number" min={1} max={365} disabled={so} value={dias} onChange={(e) => setDias(e.target.value)} />
              </Campo>
              <Campo id="cfg-padrao" rotulo="Periodicidade padrão (meses)">
                <Input id="cfg-padrao" type="number" min={1} max={60} disabled={so} value={padrao} onChange={(e) => setPadrao(e.target.value)} />
              </Campo>
              {podeAlterar && (
                <Button onClick={enviar} disabled={salvar.isPending}>
                  {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                </Button>
              )}
            </div>

            {config.sem_contrato > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                {config.sem_contrato} colaborador(es) ativo(s) sem contrato identificado (a filial/local da Senior não casa com nenhum
                contrato do ERP) — usam a periodicidade padrão. Na lista, aparecem marcados como "contrato não identificado".
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-semibold">Periodicidade por contrato</Label>
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Buscar contrato" aria-label="Buscar contrato" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead className="text-right">Ativos</TableHead>
                    <TableHead>Periodicidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contratos.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">Nenhum contrato.</TableCell></TableRow>
                  ) : contratos.map((c) => (
                    <LinhaContrato key={c.contrato_id} c={c} padrao={config.periodicidade_padrao_meses} podeAlterar={podeAlterar} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinhaContrato({ c, padrao, podeAlterar }: { c: ContratoPeriodicidade; padrao: number; podeAlterar: boolean }) {
  const [meses, setMeses] = useState(c.periodicidade_meses == null ? "" : String(c.periodicidade_meses));
  const salvar = useSalvarPeriodicidadeContrato();
  const atual = c.periodicidade_meses == null ? "" : String(c.periodicidade_meses);
  const mudou = meses.trim() !== atual;

  const gravar = (valor: number | null) => {
    if (valor != null) {
      const e = erroMesesContrato(valor);
      if (e) { toast.error(e); return; }
    }
    salvar.mutateAsync({ contrato_id: c.contrato_id, meses: valor })
      .then(() => toast.success(valor == null ? `${c.nome}: volta ao padrão.` : `${c.nome}: a cada ${rotuloPeriodicidade(valor)}.`),
        (x) => toast.error((x as Error).message));
  };

  return (
    <TableRow>
      <TableCell>
        <span className="block">{c.nome}</span>
        {c.status === "encerrado" && <span className="text-xs text-muted-foreground">encerrado</span>}
        {c.motivo && <span className="block text-xs text-muted-foreground">{c.motivo}</span>}
      </TableCell>
      <TableCell className="text-right">{c.colaboradores}</TableCell>
      <TableCell>
        {podeAlterar ? (
          <div className="flex items-center gap-2">
            <Input type="number" min={1} max={60} className="w-24" aria-label={`Meses — ${c.nome}`} placeholder={String(padrao)}
              value={meses} onChange={(e) => setMeses(e.target.value)} />
            <span className="text-xs text-muted-foreground">meses</span>
            {mudou && (
              <Button size="sm" disabled={salvar.isPending} onClick={() => gravar(meses.trim() === "" ? null : Number(meses))}>Salvar</Button>
            )}
            {!mudou && c.periodicidade_meses != null && (
              <Button size="sm" variant="ghost" disabled={salvar.isPending} onClick={() => { setMeses(""); gravar(null); }}>Usar padrão</Button>
            )}
          </div>
        ) : (
          <span>{rotuloPeriodicidade(c.periodicidade_meses ?? padrao)}{c.periodicidade_meses == null ? " (padrão)" : ""}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}
