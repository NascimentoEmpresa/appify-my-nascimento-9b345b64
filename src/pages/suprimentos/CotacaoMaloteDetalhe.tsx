import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComprasPassadas } from "@/components/malote/ComprasPassadas";
import {
  useSolicitacaoParaCotar, useSalvarRascunhoCotacao, useEnviarCotacao,
  useAprovarCotacao, useReprovarCotacao, useCancelarCotacao,
  lerCotacoes, cotacaoPreenchida, abrirAnexoMalote,
  ROTULO_COTACAO, fmtBRL, fmtData, fmtDataHora,
  type Cotacao,
} from "@/hooks/useMaloteCotacao";
import { STATUS_BADGE_CLASS, uploadAnexoMalote, useItensDaDespesa } from "@/hooks/useMaloteDespesa";
import { ItensSolicitacao } from "@/components/malote/ItensSolicitacao";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useFornecedores, type FornecedorOpcao } from "@/hooks/useSupEstoque";
import {
  ArrowLeft, Paperclip, Save, Send, Trash2, CheckCircle2, XCircle, Ban,
  Trophy, Loader2, ShieldAlert, Info,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * SIS-2026-0112 — detalhe da solicitação do Malote, pelo lado de Suprimentos.
 *
 * Uma tela, comportamento por status (regras 3 do chamado):
 *   aguardando_cotacao    → ÚNICO estado editável: preenche até 3 e envia
 *   cotacao_realizada     → decide: aprova escolhendo o vencedor, ou reprova
 *   cotacao_aprovada      → card de sucesso com o vencedor
 *   solicitacao_reprovada → card com o motivo; dá para reenviar
 *   cancelada             → card informativo
 *
 * "Somente será possível enviar cotações quando estiver em Cotação Pendente"
 * e "status finais não retornam" são garantidos no banco, pelas RPCs — aqui
 * a tela só evita que o usuário tente.
 */
/** Valor sentinela do select para a cotação sem vínculo — não é id de nada. */
const LEGADO = "__legado__";

export default function CotacaoMaloteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const { data: d, isLoading, error } = useSolicitacaoParaCotar(id);
  const { data: itens = [] } = useItensDaDespesa(id);

  const salvar = useSalvarRascunhoCotacao();
  const enviar = useEnviarCotacao();
  const aprovar = useAprovarCotacao();
  const reprovar = useReprovarCotacao();
  const cancelar = useCancelarCotacao();
  const { data: empresaId } = useEmpresaId();
  const { data: fornecedores = [] } = useFornecedores(empresaId ?? null);

  const [cots, setCots] = useState<Cotacao[]>(lerCotacoes(null));
  const [carregadoDe, setCarregadoDe] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<null | "cancelar" | "reprovar" | "aprovar">(null);
  const [motivo, setMotivo] = useState("");
  const [vencedor, setVencedor] = useState<1 | 2 | 3 | null>(null);
  const [observacoes, setObservacoes] = useState("");

  // Semeia ao carregar (e ao trocar de item), sem useEffect de dependência solta.
  if (d && carregadoDe !== d.id) {
    setCarregadoDe(d.id);
    setCots(lerCotacoes(d));
    setVencedor(d.cotacao_vencedor_num ?? null);
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <p className="font-medium">Não foi possível abrir a solicitação.</p>
        <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        <Button variant="outline" onClick={() => navegar("/app/suprimentos/cotacoes-malote")}>Voltar</Button>
      </div>
    );
  }
  if (isLoading || !d) return <p className="py-20 text-center text-sm text-muted-foreground">Carregando…</p>;

  const editavel = d.status === "aguardando_cotacao";
  const decidivel = d.status === "cotacao_realizada";
  const dispensa = d.tipo === "dispensa_cotacao";
  const minimo = dispensa ? 1 : 3;
  const preenchidas = cots.filter(cotacaoPreenchida).length;
  const ocupado = salvar.isPending || enviar.isPending || aprovar.isPending
    || reprovar.isPending || cancelar.isPending;

  const trocar = (i: number, campo: keyof Cotacao, valor: string) =>
    setCots((c) => c.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navegar("/app/suprimentos/cotacoes-malote")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", STATUS_BADGE_CLASS[d.status])}>
          {ROTULO_COTACAO[d.status] ?? d.status}
        </span>
        <span className="ml-auto text-right text-xs text-muted-foreground">
          Última atualização<br />{fmtDataHora(d.updated_at)}
        </span>
      </div>

      <PageHeader
        title={d.numero}
        module="Suprimentos"
        breadcrumb={["Cotações do Malote", d.numero]}
        subtitle="Solicitação de Despesa / Compra / Manutenção"
      />

      {/* ── Dados da solicitação (leitura) ── */}
      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <Campo rotulo="Nome da solicitação" valor={d.nome} />
        <Campo rotulo="Motivo" valor={d.motivo} />
        <Campo rotulo="Descrição" valor={d.descricao} linhas />
        <Campo rotulo="Link(s)" valor={d.links} />
        <Campo rotulo="Valor estimado" valor={fmtBRL(d.valor_total)} />
        <Campo rotulo="Classificação da despesa" valor={d.classificacao?.nome} />
        <Campo rotulo="Tipo" valor={d.tipo} />
        <Campo rotulo="Data de pagamento" valor={fmtData(d.data_pagamento)} />
        {/* O que foi pedido, item a item (SIS-2026-0207). Antes o comprador
            cotava lendo a descrição em texto corrido. */}
        {itens.length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Itens a cotar ({itens.length})
            </p>
            <ItensSolicitacao itens={itens} editavel={false} />
          </div>
        )}
        {d.excecao && (
          <div className="sm:col-span-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-400/50 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
              <Info className="h-3.5 w-3.5" /> Solicitação marcada como exceção
            </span>
          </div>
        )}
        {d.arquivos?.length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Arquivos anexados</p>
            <div className="flex flex-wrap gap-2">
              {d.arquivos.map((a) => (
                <button key={a} type="button" onClick={() => abrirAnexoMalote(a)}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted">
                  <Paperclip className="h-3.5 w-3.5 opacity-70" />
                  {a.split("/").pop()}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ComprasPassadas
        classificacaoId={d.classificacao_id}
        classificacaoNome={d.classificacao?.nome ?? null}
        ignorarId={d.id}
      />

      {/* ── Cards de estado ── */}
      {d.status === "solicitacao_reprovada" && (
        <Aviso tom="erro" icone={XCircle} titulo="Cotação Reprovada"
               texto="Esta solicitação de cotação foi reprovada. Revise o motivo abaixo antes de reenviar.">
          <p className="mt-2 rounded-md border bg-background/60 p-3 text-sm">
            {d.cotacao_reprovada_motivo ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Reprovado por {d.cotacao_decidida_por_nome ?? "—"} em {fmtDataHora(d.cotacao_decidida_em)}
          </p>
        </Aviso>
      )}

      {d.status === "cancelada" && (
        <Aviso tom="neutro" icone={Ban} titulo="Cotação Cancelada"
               texto="Esta solicitação foi cancelada. Não haverá envio de cotações para aprovação.">
          {d.cotacao_observacoes && (
            <p className="mt-2 text-sm">{d.cotacao_observacoes}</p>
          )}
        </Aviso>
      )}

      {d.status === "cotacao_aprovada" && (
        <Aviso tom="ok" icone={Trophy} titulo="Cotação aprovada e finalizada"
               texto="A solicitação voltou para o Malote e aguarda ser convertida em Despesa.">
          <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Fornecedor: </span>
              <strong>{(d as any)[`cot${d.cotacao_vencedor_num}_fornecedor`] ?? "—"}</strong></p>
            <p><span className="text-muted-foreground">Valor final: </span>
              <strong>{fmtBRL(d.valor_aprovado_cotacao)}</strong></p>
            <p><span className="text-muted-foreground">Aprovado por: </span>
              {d.cotacao_decidida_por_nome ?? "—"} · {fmtDataHora(d.cotacao_decidida_em)}</p>
            {d.cotacao_observacoes && (
              <p className="sm:col-span-2"><span className="text-muted-foreground">Observações: </span>
                {d.cotacao_observacoes}</p>
            )}
          </div>
        </Aviso>
      )}

      {decidivel && (
        <Aviso tom="info" icone={Loader2} titulo="Cotações enviadas"
               texto={`Enviadas por ${d.cotacao_enviada_por_nome ?? "—"} em ${fmtDataHora(d.cotacao_enviada_em)}. Escolha a cotação vencedora para aprovar, ou reprove informando o motivo.`} />
      )}

      {/* ── Cotações ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">Cotações (até 3)</h2>
          <span className="text-xs text-muted-foreground">
            {editavel
              ? dispensa
                ? "Dispensa de cotação: basta 1 cotação."
                : "Adicione as 3 cotações para esta solicitação."
              : "Cotações enviadas anteriormente."}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {cots.map((c, i) => (
            <CartaoCotacao
              key={i} indice={i} cot={c} editavel={editavel} despesaId={d.id}
              fornecedores={fornecedores}
              obrigatoria={i < minimo}
              vencedora={d.cotacao_vencedor_num === i + 1}
              selecionavel={decidivel && cotacaoPreenchida(c)}
              selecionada={vencedor === i + 1}
              onSelecionar={() => setVencedor((i + 1) as 1 | 2 | 3)}
              onTrocar={(campo, valor) => trocar(i, campo, valor)}
              onSelecionarFornecedor={(fid, nome) =>
                setCots((c) => c.map((x, j) => (j === i ? { ...x, fornecedor_id: fid, fornecedor: nome } : x)))
              }
            />
          ))}
        </div>
      </div>

      {/* ── Ações ── */}
      {(editavel || decidivel) && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {editavel && (
            <Button variant="outline" disabled={ocupado}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => setConfirmando("cancelar")}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Cancelar solicitação
            </Button>
          )}
          {decidivel && (
            <Button variant="outline" disabled={ocupado}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => { setMotivo(""); setConfirmando("reprovar"); }}>
              <XCircle className="mr-1.5 h-4 w-4" /> Reprovar cotação
            </Button>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            {editavel && (
              <>
                <Button variant="outline" disabled={ocupado}
                        onClick={() => salvar.mutate({ id: d.id, cotacoes: cots })}>
                  <Save className="mr-1.5 h-4 w-4" /> Salvar rascunho
                </Button>
                <Button disabled={ocupado || preenchidas < minimo}
                        onClick={() => enviar.mutate({ id: d.id, cotacoes: cots })}>
                  <Send className="mr-1.5 h-4 w-4" />
                  {enviar.isPending ? "Enviando…" : "Enviar cotação para aprovação"}
                </Button>
              </>
            )}
            {decidivel && (
              <Button disabled={ocupado || !vencedor}
                      onClick={() => { setObservacoes(""); setConfirmando("aprovar"); }}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar cotação
              </Button>
            )}
          </div>

          {editavel && preenchidas < minimo && (
            <p className="w-full text-xs text-muted-foreground">
              Faltam {minimo - preenchidas} cotação(ões) — cada uma precisa de fornecedor, valor e prazo.
            </p>
          )}
          {decidivel && !vencedor && (
            <p className="w-full text-xs text-muted-foreground">
              Escolha qual cotação venceu para poder aprovar.
            </p>
          )}
        </div>
      )}

      {/* ── Confirmações ── */}
      <AlertDialog open={confirmando !== null} onOpenChange={(o) => !o && setConfirmando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmando === "cancelar" && "Cancelar esta solicitação?"}
              {confirmando === "reprovar" && "Reprovar a cotação?"}
              {confirmando === "aprovar" && `Aprovar a cotação ${vencedor}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmando === "cancelar" && "A solicitação não seguirá para aprovação. Não é possível voltar atrás."}
              {confirmando === "reprovar" && "O motivo é obrigatório e fica visível para quem abriu a solicitação."}
              {confirmando === "aprovar" && "A solicitação volta para o Malote com o valor do fornecedor escolhido. Não é possível voltar atrás."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {confirmando === "reprovar" && (
            <Textarea rows={4} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: valores acima do limite orçado para este tipo de despesa." />
          )}
          {confirmando === "aprovar" && (
            <Textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
                      placeholder="Observações (opcional)" />
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmando === "reprovar" && !motivo.trim()}
              className={confirmando === "aprovar" ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
              onClick={async () => {
                if (confirmando === "cancelar") await cancelar.mutateAsync({ id: d.id });
                if (confirmando === "reprovar") await reprovar.mutateAsync({ id: d.id, motivo });
                if (confirmando === "aprovar" && vencedor)
                  await aprovar.mutateAsync({ id: d.id, vencedor, observacoes });
                setConfirmando(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Peças ────────────────────────────────────────────────────────────

function Campo({ rotulo, valor, linhas }: { rotulo: string; valor?: string | null; linhas?: boolean }) {
  return (
    <div className={cn(linhas && "sm:col-span-2")}>
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p className={cn("text-sm", linhas && "whitespace-pre-wrap")}>{valor || "—"}</p>
    </div>
  );
}

function Aviso({
  tom, icone: Icone, titulo, texto, children,
}: {
  tom: "erro" | "ok" | "info" | "neutro";
  icone: React.ElementType; titulo: string; texto: string; children?: React.ReactNode;
}) {
  const cores = {
    erro: "border-red-400/40 bg-red-50/70 text-red-700 dark:bg-red-950/20 dark:text-red-300",
    ok: "border-emerald-400/40 bg-emerald-50/70 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300",
    info: "border-blue-400/40 bg-blue-50/70 text-blue-700 dark:bg-blue-950/20 dark:text-blue-300",
    neutro: "border-border bg-muted/40 text-muted-foreground",
  }[tom];
  return (
    <div className={cn("rounded-lg border p-4", cores)}>
      <p className="flex items-center gap-2 text-sm font-semibold"><Icone className="h-4 w-4" /> {titulo}</p>
      <p className="mt-1 text-sm opacity-90">{texto}</p>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function CartaoCotacao({
  indice, cot, editavel, obrigatoria, despesaId, vencedora, selecionavel, selecionada,
  fornecedores, onSelecionar, onTrocar, onSelecionarFornecedor,
}: {
  indice: number; cot: Cotacao; editavel: boolean; obrigatoria: boolean; despesaId: string;
  vencedora: boolean; selecionavel: boolean; selecionada: boolean;
  fornecedores: FornecedorOpcao[];
  onSelecionar: () => void; onTrocar: (campo: keyof Cotacao, valor: string) => void;
  /** Grava id e nome juntos — o id é o vínculo, o nome é o snapshot. */
  onSelecionarFornecedor: (id: string, nome: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState(false);
  // Cotação que tem nome mas não tem vínculo: feita antes de o fornecedor ser
  // cadastrado, ou cujo nome não casou no de-para da migration. Continua
  // legível, e escolher do select por cima resolve.
  const fornecedorLegado = !!cot.fornecedor && !cot.fornecedor_id;

  async function anexar(f: File | null) {
    if (!f) return;
    setSubindo(true);
    try {
      const path = await uploadAnexoMalote(f, despesaId);
      onTrocar("anexo_path", path);
      onTrocar("anexo_nome", f.name);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível anexar.");
    } finally {
      setSubindo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn(
      "rounded-lg border p-3",
      vencedora && "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20",
      selecionada && !vencedora && "border-primary ring-1 ring-primary",
    )}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          {indice + 1} {!obrigatoria && <span className="font-normal">(Opcional)</span>}
        </span>
        {vencedora && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <Trophy className="h-3.5 w-3.5" /> Vencedora
          </span>
        )}
        {selecionavel && !vencedora && (
          <Button size="sm" variant={selecionada ? "default" : "outline"} className="h-7 text-[11px]"
                  onClick={onSelecionar}>
            {selecionada ? "Escolhida" : "Escolher"}
          </Button>
        )}
      </div>

      {editavel ? (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Fornecedor {obrigatoria && "*"}</Label>
            {/* O value é o ID, não o nome (SIS-2026-0207). Antes guardava só o
                nome: renomear um fornecedor transformava a cotação antiga em
                "(não cadastrado)", e não dava para puxar prazo nem condição de
                pagamento do cadastro. O nome continua sendo gravado ao lado,
                como snapshot. */}
            <Select value={cot.fornecedor_id ?? (fornecedorLegado ? LEGADO : undefined)}
                    onValueChange={(v) => {
                      if (v === LEGADO) return;
                      const f = fornecedores.find((x) => x.id === v);
                      onSelecionarFornecedor(v, f ? (f.nome_fantasia || f.razao_social) : "");
                    }}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder={fornecedores.length ? "Selecione o fornecedor" : "Nenhum fornecedor cadastrado"} />
              </SelectTrigger>
              <SelectContent>
                {fornecedorLegado && (
                  <SelectItem value={LEGADO}>{cot.fornecedor} (não cadastrado)</SelectItem>
                )}
                {fornecedores.map((f) => {
                  const nome = f.nome_fantasia || f.razao_social;
                  return <SelectItem key={f.id} value={f.id}>{nome}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Valor (R$) {obrigatoria && "*"}</Label>
              <Input className="mt-1 h-9" inputMode="decimal" value={cot.valor}
                     onChange={(e) => onTrocar("valor", e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                     placeholder="0,00" />
            </div>
            <div>
              <Label className="text-xs">Prazo {obrigatoria && "*"}</Label>
              <Input className="mt-1 h-9" type="date" value={cot.prazo}
                     onChange={(e) => onTrocar("prazo", e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Link (opcional)</Label>
            <Input className="mt-1 h-9" value={cot.link}
                   onChange={(e) => onTrocar("link", e.target.value)}
                   placeholder="https://…" />
          </div>
          <div>
            <Label className="text-xs">Anexo (opcional)</Label>
            <input ref={inputRef} type="file" className="hidden"
                   onChange={(e) => anexar(e.target.files?.[0] ?? null)} />
            <div className="mt-1 flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                      disabled={subindo} onClick={() => inputRef.current?.click()}>
                {subindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
                {cot.anexo_nome ? "Trocar" : "Escolher arquivo"}
              </Button>
              {cot.anexo_nome && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{cot.anexo_nome}</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <dl className="space-y-1.5 text-sm">
          <Leitura rotulo="Fornecedor" valor={cot.fornecedor} destaque />
          <Leitura rotulo="Valor (R$)" valor={cot.valor ? fmtBRL(cot.valor) : ""} destaque />
          <Leitura rotulo="Prazo da cotação" valor={fmtData(cot.prazo || null)} />
          <Leitura rotulo="Link" valor={cot.link} />
          <div>
            <dt className="text-[11px] text-muted-foreground">Anexo</dt>
            <dd>
              {cot.anexo_path ? (
                <button type="button" onClick={() => abrirAnexoMalote(cot.anexo_path)}
                        className="inline-flex items-center gap-1.5 text-xs hover:underline">
                  <Paperclip className="h-3.5 w-3.5 opacity-70" />{cot.anexo_nome || "Arquivo"}
                </button>
              ) : <span className="text-xs text-muted-foreground">—</span>}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Leitura({ rotulo, valor, destaque }: { rotulo: string; valor?: string | null; destaque?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className={cn("truncate", destaque ? "font-medium" : "text-xs")}>{valor || "—"}</dd>
    </div>
  );
}
