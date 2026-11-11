import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePostos } from "@/hooks/useSupCatalogo";
import { chaveContrato } from "@/lib/recrutamento/vagaRegras";
import { semCodigoFilial } from "@/lib/rh/colaboradoresUtils";
import {
  ACCEPT_ANEXO, BUCKET, MODELOS_AVISO, MOTIVOS_PEDIDO, MOTIVOS_SOLICITACAO, STATUS_AJUSTE_SOLICITADO, TABELA, TABELA_ANEXOS,
  JUSTIFICATIVAS_DESLIGAMENTO, JUSTIFICATIVA_OUTROS,
  TERMINOS_EXPERIENCIA, erroDoArquivo, erroDoAjuste, fmtDataHora, fmtTamanho, mascaraTelefone, podeAjustarDemissao,
  type AlteracaoAjuste, type AnexoDemissao, type FormAjuste,
} from "@/lib/demissao/solicitacao";
import { Loader2, Paperclip, Pencil, Trash2 } from "lucide-react";

// =====================================================================
// AJUSTAR uma solicitação de demissão — o RH pediu, o encarregado corrige
// (SIS-2026-0805, mig 20261105020000). O mesmo nos dois lugares em que o
// encarregado vê as demissões dele: Solicitar Demissão e Minhas Solicitações.
//
// Antes o único caminho era pedir o cancelamento e abrir outro pedido. Só os
// campos que quem pediu digitou são editáveis: colaborador, contrato, cargo e
// escala vêm do cadastro, e pessoa errada é outra demissão. Quem grava é a RPC
// demissao_reenviar_ajuste, que repete a validação e volta o pedido ao RH.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

const chaveNome = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const comAtual = (lista: readonly string[], atual: string) => (atual && !lista.includes(atual) ? [atual, ...lista] : [...lista]);

interface FichaAjuste extends FormAjuste {
  colaborador_nome: string | null;
  contrato: string | null;
  ajuste_por: string | null;
  ajuste_em: string | null;
  ajuste_motivo: string | null;
}

export function BotaoAjustarDemissao({ solicitacao, onAjustada, avisar, compacto }: {
  solicitacao: { id: number; status: string };
  onAjustada: () => void;
  /** Toast da tela que hospeda o botão. */
  avisar: (msg: string, tipo: "ok" | "err" | "info") => void;
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  if (!podeAjustarDemissao(solicitacao)) return null;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setAberto(true)} title="O RH pediu ajuste nesta solicitação: corrija e reenvie"
        className={compacto ? "h-7 bg-amber-600 px-2.5 text-xs hover:bg-amber-700" : "bg-amber-600 hover:bg-amber-700"}>
        <Pencil className="mr-1 h-3 w-3" /> Ajustar solicitação
      </Button>
      {aberto && (
        <DialogAjuste id={solicitacao.id} avisar={avisar}
          onFechar={() => setAberto(false)}
          onEnviada={() => { setAberto(false); onAjustada(); }} />
      )}
    </>
  );
}

function DialogAjuste({ id, avisar, onFechar, onEnviada }: {
  id: number;
  avisar: (msg: string, tipo: "ok" | "err" | "info") => void;
  onFechar: () => void;
  onEnviada: () => void;
}) {
  const [ficha, setFicha] = useState<FichaAjuste | null>(null);
  const [form, setForm] = useState<FormAjuste | null>(null);
  const [anexos, setAnexos] = useState<AnexoDemissao[]>([]);
  const [remover, setRemover] = useState<number[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [contratos, setContratos] = useState<{ id: string; nome: string }[]>([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data, error }, { data: lista }, { data: cat }] = await Promise.all([
        db.from(TABELA).select("*").eq("id", id).single(),
        db.from(TABELA_ANEXOS).select("*").eq("solicitacao_id", id).order("id"),
        db.from("contratos").select("id, nome").order("nome"),
      ]);
      if (!vivo) return;
      if (error || !data) { avisar("Não consegui abrir a solicitação: " + (error?.message ?? "não encontrada"), "err"); onFechar(); return; }
      setFicha(data as FichaAjuste);
      setForm({
        data_solicitacao: data.data_solicitacao ?? "", colaborador_posto: data.colaborador_posto ?? "",
        motivo_solicitacao: data.motivo_solicitacao ?? "", motivo_pedido: data.motivo_pedido ?? "", relato: data.relato ?? "",
        // As abertas antes de 10/11/2026 chegam sem justificativa: o ajuste pede (é obrigatória).
        justificativa_desligamento: data.justificativa_desligamento ?? "", justificativa_complemento: data.justificativa_complemento ?? "",
        termino_experiencia: data.termino_experiencia ?? "", data_aviso: data.data_aviso ?? "", modelo_aviso: data.modelo_aviso ?? "",
        colaborador_telefone: data.colaborador_telefone ?? "", colaborador_email: data.colaborador_email ?? "",
      });
      setAnexos((lista ?? []) as AnexoDemissao[]);
      setContratos((cat ?? []) as { id: string; nome: string }[]);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Os postos do contrato: a mesma lista do formulário de abertura. Sem catálogo, o posto fica como está.
  const contratoId = useMemo(() => {
    const nome = semCodigoFilial(ficha?.contrato ?? "");
    if (!chaveNome(nome)) return null;
    return (contratos.find((c) => chaveNome(c.nome) === chaveNome(nome))
      ?? contratos.find((c) => chaveContrato(c.nome) === chaveContrato(nome)))?.id ?? null;
  }, [contratos, ficha?.contrato]);
  const { data: postos = [] } = usePostos(contratoId);

  const setCampo = (campo: keyof FormAjuste, valor: string) => setForm((f) => (f ? { ...f, [campo]: valor } : f));
  const qtdAnexos = anexos.filter((a) => !remover.includes(a.id)).length + arquivos.length;

  const adicionar = (lista: FileList | null) => {
    if (!lista) return;
    for (const f of Array.from(lista)) {
      const erro = erroDoArquivo(f);
      if (erro) { avisar(erro, "err"); continue; }
      setArquivos((a) => [...a, f]);
    }
  };

  const enviar = async () => {
    if (!form) return;
    const falta = erroDoAjuste(form, qtdAnexos);
    if (falta) { avisar(falta, "err"); return; }
    setEnviando(true);
    // Sobe primeiro e registra na RPC: se ela recusar, os arquivos novos saem do bucket e nada mudou.
    const enviados: { nome: string; storage_path: string; tamanho: number; tipo: string | null }[] = [];
    const desfazer = async () => { if (enviados.length) await supabase.storage.from(BUCKET).remove(enviados.map((e) => e.storage_path)); };
    for (const arquivo of arquivos) {
      const caminho = `${id}/${Date.now()}-${arquivo.name.replace(/[^\w.-]+/g, "_")}`;
      const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo);
      if (error) {
        await desfazer();
        setEnviando(false);
        avisar(`Não consegui enviar "${arquivo.name}": ${error.message}. Nada foi salvo — tente de novo.`, "err");
        return;
      }
      enviados.push({ nome: arquivo.name, storage_path: caminho, tamanho: arquivo.size, tipo: arquivo.type || null });
    }
    const { data, error } = await db.rpc("demissao_reenviar_ajuste", {
      p_id: id, p_dados: form, p_anexos_novos: enviados, p_anexos_remover: remover, p_observacao: observacao.trim() || null,
    });
    if (error) {
      await desfazer();
      setEnviando(false);
      avisar(error.message, "err");
      return;
    }
    const removidos = ((data as { removidos?: string[] } | null)?.removidos ?? []).filter(Boolean);
    if (removidos.length) await supabase.storage.from(BUCKET).remove(removidos);
    setEnviando(false);
    avisar(`Solicitação #${id} ajustada e reenviada ao RH.`, "ok");
    onEnviada();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !enviando) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajustar solicitação de demissão #{id}</DialogTitle>
          <DialogDescription>
            {ficha?.colaborador_nome ?? "Carregando…"}. Ao reenviar, a solicitação volta para o RH, sem passar de novo pela aprovação.
          </DialogDescription>
        </DialogHeader>

        {!form || !ficha ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">
                O que o RH pediu{ficha.ajuste_por ? ` (${ficha.ajuste_por}` : ""}{ficha.ajuste_em ? ` · ${fmtDataHora(ficha.ajuste_em)})` : ficha.ajuste_por ? ")" : ""}:
              </p>
              <p className="whitespace-pre-wrap">{ficha.ajuste_motivo}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="aj-data-sol">Data da solicitação *</Label>
                <Input id="aj-data-sol" type="date" className="mt-1" value={form.data_solicitacao}
                  onChange={(e) => setCampo("data_solicitacao", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="aj-data-aviso">Data do aviso *</Label>
                <Input id="aj-data-aviso" type="date" className="mt-1" value={form.data_aviso}
                  onChange={(e) => setCampo("data_aviso", e.target.value)} />
              </div>
            </div>

            {postos.length > 0 && (
              <Lista rotulo="Posto *" valor={form.colaborador_posto} aoMudar={(v) => setCampo("colaborador_posto", v)}
                opcoes={comAtual(postos.map((p) => p.nome), form.colaborador_posto)} />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Lista rotulo="Motivo da solicitação *" valor={form.motivo_solicitacao} aoMudar={(v) => setCampo("motivo_solicitacao", v)}
                opcoes={comAtual(MOTIVOS_SOLICITACAO, form.motivo_solicitacao)} />
              <Lista rotulo="Motivo do pedido de demissão *" valor={form.motivo_pedido} aoMudar={(v) => setCampo("motivo_pedido", v)}
                opcoes={comAtual(MOTIVOS_PEDIDO, form.motivo_pedido)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Lista rotulo="Justificativa do desligamento *" valor={form.justificativa_desligamento}
                aoMudar={(v) => setCampo("justificativa_desligamento", v)} opcoes={[...JUSTIFICATIVAS_DESLIGAMENTO]} />
              <div>
                <Label htmlFor="aj-just-comp">
                  {form.justificativa_desligamento === JUSTIFICATIVA_OUTROS ? "Descreva a justificativa *" : "Complemento da justificativa"}
                </Label>
                <Textarea id="aj-just-comp" className="mt-1 min-h-10" maxLength={1000} value={form.justificativa_complemento}
                  onChange={(e) => setCampo("justificativa_complemento", e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="aj-relato">Relato do motivo *</Label>
              <Textarea id="aj-relato" className="mt-1 min-h-24" value={form.relato} onChange={(e) => setCampo("relato", e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Lista rotulo="Término de contrato de experiência *" valor={form.termino_experiencia} aoMudar={(v) => setCampo("termino_experiencia", v)}
                opcoes={comAtual(TERMINOS_EXPERIENCIA, form.termino_experiencia)} />
              <Lista rotulo="Modelo de aviso *" valor={form.modelo_aviso} aoMudar={(v) => setCampo("modelo_aviso", v)}
                opcoes={comAtual(MODELOS_AVISO, form.modelo_aviso)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="aj-tel">Telefone do colaborador *</Label>
                <Input id="aj-tel" className="mt-1" value={form.colaborador_telefone}
                  onChange={(e) => setCampo("colaborador_telefone", mascaraTelefone(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="aj-mail">E-mail do colaborador *</Label>
                <Input id="aj-mail" type="email" className="mt-1" value={form.colaborador_email}
                  onChange={(e) => setCampo("colaborador_email", e.target.value)} />
              </div>
            </div>

            <div>
              <Label htmlFor="aj-docs">Documentos *</Label>
              <ul className="mt-1 space-y-2">
                {anexos.filter((a) => !remover.includes(a.id)).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                    <span className="text-xs text-muted-foreground">{fmtTamanho(a.tamanho)}</span>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${a.nome}`} onClick={() => setRemover((r) => [...r, a.id])}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
                {arquivos.map((a, i) => (
                  <li key={`${a.name}-${i}`} className="flex items-center gap-2 rounded-md border border-primary/30 px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{a.name} (novo)</span>
                    <span className="text-xs text-muted-foreground">{fmtTamanho(a.size)}</span>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${a.name}`} onClick={() => setArquivos((l) => l.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <Input id="aj-docs" type="file" multiple accept={ACCEPT_ANEXO} className="mt-2"
                onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
            </div>

            <div>
              <Label htmlFor="aj-obs">Observação para o RH (opcional)</Label>
              <Textarea id="aj-obs" className="mt-1" placeholder="Ex.: a data foi corrigida conforme o aviso assinado."
                value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onFechar} disabled={enviando}>Voltar</Button>
              <Button type="button" onClick={enviar} disabled={enviando}>
                {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</> : "Reenviar ao RH"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Lista({ rotulo, valor, aoMudar, opcoes }: { rotulo: string; valor: string; aoMudar: (v: string) => void; opcoes: string[] }) {
  return (
    <div>
      <Label>{rotulo}</Label>
      <Select value={valor} onValueChange={aoMudar}>
        <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * O ajuste pedido pelo RH, ou o que foi corrigido depois do reenvio. Vale para
 * o encarregado e para o RH — é a mesma informação nas duas pontas.
 */
export function AvisoAjusteDemissao({ solicitacao }: { solicitacao: {
  status: string; ajuste_por?: string | null; ajuste_em?: string | null; ajuste_motivo?: string | null;
  ajuste_feito_por?: string | null; ajuste_feito_em?: string | null; ajuste_observacao?: string | null;
  ajuste_alteracoes?: AlteracaoAjuste[] | null;
} }) {
  const s = solicitacao;
  if (!s.ajuste_em) return null;
  if (s.status === STATUS_AJUSTE_SOLICITADO) {
    return (
      <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">
          ✏️ Ajuste pedido pelo RH{s.ajuste_por ? ` (${s.ajuste_por})` : ""} em {fmtDataHora(s.ajuste_em)} — aguardando quem solicitou
        </p>
        <p className="whitespace-pre-wrap">{s.ajuste_motivo}</p>
      </div>
    );
  }
  if (!s.ajuste_feito_em) return null;
  const alteracoes = s.ajuste_alteracoes ?? [];
  return (
    <div className="space-y-1 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="font-semibold">
        ✏️ Ajustada por {s.ajuste_feito_por ?? "quem solicitou"} em {fmtDataHora(s.ajuste_feito_em)}
      </p>
      <p><span className="font-medium">O RH pediu:</span> {s.ajuste_motivo}</p>
      {alteracoes.length > 0 && (
        <ul className="list-disc pl-5">
          {alteracoes.map((a) => (
            <li key={a.campo}>{a.campo}: {a.campo === "Relato" ? "alterado" : `${a.antes || "—"} → ${a.depois || "—"}`}</li>
          ))}
        </ul>
      )}
      {s.ajuste_observacao && <p><span className="font-medium">Observação:</span> {s.ajuste_observacao}</p>}
    </div>
  );
}

