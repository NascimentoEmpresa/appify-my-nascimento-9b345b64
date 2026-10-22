import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { corDoStatus, fmtData, fmtDataHora } from "@/lib/demissao/solicitacao";
import {
  HOMOLOGACOES, MEIOS_ENVIO, MEIOS_RETORNO, SIGLA_EMPRESA, STATUS_PADRAO, STATUS_RESCISAO, TIPOS_DESLIGAMENTO,
  demissaoCancelada, edicaoInicial, erroDatasRescisao, erroIdentificacao, limparEdicao, sugerirDataDemissao, sugerirDataPagamento,
  type EdicaoRescisao, type IdentificacaoRescisao, type LinhaRescisao,
} from "@/lib/demissao/rescisao";
import { buscarHistoricoRescisao, type HistoricoRescisao } from "@/hooks/useRescisoes";
import { CheckCircle2, ExternalLink, FileSpreadsheet, History, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A ficha da rescisão — abre pelo nome na planilha (RH › Rescisões) ou pelo
 * "Nova rescisão". Tudo que a planilha do RH tinha numa linha, mais:
 *   · a identificação editável quando a linha NÃO é do ERP (importada ou
 *     lançada à mão) — na do ERP quem manda é a solicitação;
 *   · "Como está na planilha": a linha original do Excel, sem normalizar;
 *   · o histórico das trocas de coluna (RH_RESCISAO_HISTORICO).
 */

const EDICAO_VAZIA: EdicaoRescisao = {
  homologacao: null, data_aviso: null, data_ultimo_dia: null, data_demissao: null, data_pagamento: null,
  tipo_desligamento: null, rescisao_programada: false, vales_programados: false,
  malote_data: null, malote_obs: null, envio_meio: null, envio_data: null, envio_obs: null,
  retorno_meio: null, retorno_data: null, retorno_obs: null, status_rescisao: STATUS_PADRAO, observacao: null,
  pontos_ajustados: null, data_admissao: null,
};

const IDENT_VAZIA: IdentificacaoRescisao = {
  empresa: null, matricula: null, colaborador_nome: null, contrato: null, data_recebimento: null, solicitado_por: null,
};

export type AbrirFicha = { modo: "editar"; linha: LinhaRescisao } | { modo: "nova" } | null;

export function FichaRescisao({ abrir, podeEditar, podeExcluir, onFechar, onSalvar, onExcluir }: {
  abrir: AbrirFicha;
  podeEditar: boolean;
  podeExcluir: boolean;
  onFechar: () => void;
  /** `ident` só vem quando a identificação é editável (linha fora do ERP ou nova). */
  onSalvar: (linha: LinhaRescisao | null, e: EdicaoRescisao, ident: IdentificacaoRescisao | null) => Promise<boolean>;
  onExcluir: (linha: LinhaRescisao) => Promise<boolean>;
}) {
  const linha = abrir?.modo === "editar" ? abrir.linha : null;
  const nova = abrir?.modo === "nova";
  const identEditavel = nova || (!!linha && !linha.solicitacao);

  const [e, setE] = useState<EdicaoRescisao | null>(null);
  const [ident, setIdent] = useState<IdentificacaoRescisao>(IDENT_VAZIA);
  const [salvando, setSalvando] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [historico, setHistorico] = useState<HistoricoRescisao[] | null>(null);

  useEffect(() => {
    setConfirmaExcluir(false);
    setHistorico(null);
    if (!abrir) { setE(null); return; }
    if (abrir.modo === "nova") {
      setE(EDICAO_VAZIA);
      setIdent({ ...IDENT_VAZIA, data_recebimento: new Date().toISOString().slice(0, 10) });
      return;
    }
    const l = abrir.linha;
    setE(edicaoInicial(l));
    setIdent({
      empresa: l.empresa, matricula: l.matricula, colaborador_nome: l.nome === "—" ? null : l.nome,
      contrato: l.contrato, data_recebimento: l.recebido, solicitado_por: l.solicitadoPor,
    });
    if (l.rescisao) buscarHistoricoRescisao(l.rescisao.id).then(setHistorico).catch(() => setHistorico([]));
  }, [abrir]);

  if (!abrir || !e) return null;

  const set = <K extends keyof EdicaoRescisao>(k: K, v: EdicaoRescisao[K]) => setE((x) => (x ? { ...x, [k]: v } : x));
  const setI = (k: keyof IdentificacaoRescisao, v: string) => setIdent((x) => ({ ...x, [k]: v || null }));
  const erro = erroDatasRescisao(e) ?? (identEditavel ? erroIdentificacao(ident) : null);
  const somenteLeitura = !podeEditar;

  const campoData = (k: "data_aviso" | "data_ultimo_dia" | "data_demissao" | "data_pagamento" | "data_admissao", rotulo: string) => (
    <div>
      <Label htmlFor={k}>{rotulo}</Label>
      <Input id={k} type="date" className="mt-1" disabled={somenteLeitura} value={e[k] ?? ""} onChange={(ev) => set(k, ev.target.value || null)} />
    </div>
  );
  const escolha = <K extends keyof EdicaoRescisao>(k: K, rotulo: string, opcoes: readonly string[]) => (
    <div>
      <Label>{rotulo}</Label>
      <Select disabled={somenteLeitura} value={(e[k] as string | null) ?? "nenhum"} onValueChange={(v) => set(k, (v === "nenhum" ? null : v) as EdicaoRescisao[K])}>
        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="nenhum">—</SelectItem>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  // Recalcular pela régua: só preenche demissão e pagamento a partir do que
  // está na ficha — não sai mexendo sozinho em data que o RH digitou.
  const recalcular = () => {
    const dem = sugerirDataDemissao(e.data_ultimo_dia, e.tipo_desligamento);
    setE((x) => (x ? { ...x, data_demissao: dem ?? x.data_demissao, data_pagamento: sugerirDataPagamento(dem ?? x.data_demissao) ?? x.data_pagamento } : x));
  };

  const original = linha?.planilhaOriginal ? Object.entries(linha.planilhaOriginal) : [];

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !salvando) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl grid-cols-[minmax(0,1fr)] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> {nova ? "Nova rescisão" : `Rescisão · ${linha!.nome}`}
            {linha?.solicitacao && <Badge variant="outline" className={corDoStatus(linha.solicitacao.status)}>#{linha.solicitacao.id} · {linha.solicitacao.status}</Badge>}
            {linha && !linha.solicitacao && (
              <Badge variant="outline">{linha.origem === "manual" ? "lançada no sistema" : `planilha${linha.planilhaAba ? ` · ${linha.planilhaAba}` : ""}`}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {linha && demissaoCancelada(linha) && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            A solicitação desta demissão está <b>{linha.statusFluxo}</b> no ERP, depois de já ter entrado na planilha.
            Se a demissão não vai acontecer, exclua esta linha.
          </p>
        )}

        {linha?.solicitacao && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {[linha.empresa, linha.matricula && `mat. ${linha.matricula}`, linha.contrato].filter(Boolean).join(" · ") || "—"}
              {" · "}pedido por {linha.solicitadoPor ?? "—"} em {fmtData(linha.recebido)}
            </span>
            <Link to={`/app/rh/solicitacoes-demissao?abrir=${linha.solicitacao.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Abrir a solicitação <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {identEditavel && (
          <div className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-semibold">Funcionário</h3>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-4">
                <Label htmlFor="colaborador_nome">Nome *</Label>
                <Input id="colaborador_nome" className="mt-1 uppercase" disabled={somenteLeitura} value={ident.colaborador_nome ?? ""} onChange={(ev) => setI("colaborador_nome", ev.target.value.toUpperCase())} />
              </div>
              <div>
                <Label>Empresa</Label>
                <Select disabled={somenteLeitura} value={ident.empresa ?? "nenhum"} onValueChange={(v) => setI("empresa", v === "nenhum" ? "" : v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">—</SelectItem>
                    {Object.values(SIGLA_EMPRESA).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="matricula">Matrícula</Label>
                <Input id="matricula" className="mt-1" disabled={somenteLeitura} value={ident.matricula ?? ""} onChange={(ev) => setI("matricula", ev.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="contrato">Contrato</Label>
                <Input id="contrato" className="mt-1" disabled={somenteLeitura} value={ident.contrato ?? ""} onChange={(ev) => setI("contrato", ev.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="solicitado_por">Solicitado por</Label>
                <Input id="solicitado_por" className="mt-1" placeholder="Ex.: e-mail, WhatsApp, Alessandra" disabled={somenteLeitura} value={ident.solicitado_por ?? ""} onChange={(ev) => setI("solicitado_por", ev.target.value)} />
              </div>
              <div>
                <Label htmlFor="data_recebimento">Recebido</Label>
                <Input id="data_recebimento" type="date" className="mt-1" disabled={somenteLeitura} value={ident.data_recebimento ?? ""} onChange={(ev) => setI("data_recebimento", ev.target.value)} />
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {escolha("status_rescisao", "Status da rescisão", STATUS_RESCISAO)}
          {escolha("homologacao", "Homologação", HOMOLOGACOES)}
          {escolha("tipo_desligamento", "Tipo de desligamento", TIPOS_DESLIGAMENTO)}
        </div>

        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Datas</h3>
            {!somenteLeitura && (
              <Button type="button" variant="ghost" size="sm" onClick={recalcular} disabled={!e.data_ultimo_dia}>
                Recalcular demissão e pagamento
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {campoData("data_aviso", "Aviso")}
            {campoData("data_ultimo_dia", "Último dia")}
            {campoData("data_demissao", "Demissão")}
            {campoData("data_pagamento", "Pagamento")}
            {campoData("data_admissao", "Admissão")}
          </div>
          {erroDatasRescisao(e) && <p className="mt-2 text-sm text-destructive">{erroDatasRescisao(e)}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-semibold">Programadas</h3>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox disabled={somenteLeitura} checked={e.rescisao_programada} onCheckedChange={(v) => set("rescisao_programada", !!v)} /> Rescisão
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox disabled={somenteLeitura} checked={e.vales_programados} onCheckedChange={(v) => set("vales_programados", !!v)} /> Vales
              </label>
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <Label htmlFor="pontos_ajustados" className="text-sm font-semibold">Pontos ajustados?</Label>
            <Input id="pontos_ajustados" className="mt-2" placeholder="Ex.: OK, falta ajustar outubro" disabled={somenteLeitura}
              value={e.pontos_ajustados ?? ""} onChange={(ev) => set("pontos_ajustados", ev.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <h3 className="mb-2 text-sm font-semibold">Malote (rescisão e FGTS)</h3>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <div>
              <Label htmlFor="malote_data">Data</Label>
              <Input id="malote_data" type="date" className="mt-1" disabled={somenteLeitura} value={e.malote_data ?? ""} onChange={(ev) => set("malote_data", ev.target.value || null)} />
            </div>
            <div>
              <Label htmlFor="malote_obs">Observação</Label>
              <Input id="malote_obs" className="mt-1" disabled={somenteLeitura} value={e.malote_obs ?? ""} onChange={(ev) => set("malote_obs", ev.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["envio", "retorno"] as const).map((lado) => (
            <div key={lado} className="space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">{lado === "envio" ? "Envio da documentação" : "Retorno da documentação"}</h3>
              <div className="grid grid-cols-2 gap-2">
                {escolha(`${lado}_meio`, "Meio", lado === "envio" ? MEIOS_ENVIO : MEIOS_RETORNO)}
                <div>
                  <Label htmlFor={`${lado}_data`}>Data</Label>
                  <Input id={`${lado}_data`} type="date" className="mt-1" disabled={somenteLeitura} value={e[`${lado}_data`] ?? ""}
                    onChange={(ev) => set(`${lado}_data`, ev.target.value || null)} />
                </div>
              </div>
              <Input placeholder={lado === "envio" ? "Ex.: impresso entregue ao Carlos" : "Observação"} disabled={somenteLeitura}
                value={e[`${lado}_obs`] ?? ""} onChange={(ev) => set(`${lado}_obs`, ev.target.value)} />
            </div>
          ))}
        </div>

        <div>
          <Label htmlFor="observacao">Observação</Label>
          <Textarea id="observacao" className="mt-1" disabled={somenteLeitura} value={e.observacao ?? ""} onChange={(ev) => set("observacao", ev.target.value)} />
        </div>

        {original.length > 0 && (
          <details className="rounded-lg border bg-muted/30 p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Como está na planilha{linha?.planilhaAba ? ` (aba ${linha.planilhaAba})` : ""}
            </summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {original.map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-2">
                  <dt className="shrink-0 font-semibold text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {historico && historico.length > 0 && (
          <details className="rounded-lg border p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Histórico ({historico.length})</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {historico.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="text-muted-foreground">{fmtDataHora(h.em)}</span>
                  <span>{h.status_de ? <>{h.status_de} → <b>{h.status_para ?? "—"}</b></> : <>criada em <b>{h.status_para ?? "—"}</b></>}</span>
                  {h.por && <span className="text-muted-foreground">· {h.por}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {erro && identEditavel && !erroDatasRescisao(e) && <p className="text-sm text-destructive">{erro}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {podeExcluir && linha?.rescisao && !confirmaExcluir && (
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmaExcluir(true)} disabled={salvando}>
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </Button>
            )}
            {confirmaExcluir && linha && (
              <div className="flex items-center gap-2">
                <span className="text-sm">{linha.solicitacao ? "Apaga a ficha (a solicitação continua)." : "Apagar esta linha?"}</span>
                <Button variant="destructive" size="sm" disabled={salvando}
                  onClick={async () => { setSalvando(true); const ok = await onExcluir(linha); setSalvando(false); if (!ok) setConfirmaExcluir(false); }}>
                  Sim, excluir
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmaExcluir(false)}>Não</Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>{somenteLeitura ? "Fechar" : "Cancelar"}</Button>
            {!somenteLeitura && (
              <Button disabled={salvando || !!erro} className={cn(salvando && "opacity-80")}
                onClick={async () => {
                  setSalvando(true);
                  await onSalvar(linha, limparEdicao(e), identEditavel ? ident : null);
                  setSalvando(false);
                }}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Salvar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
