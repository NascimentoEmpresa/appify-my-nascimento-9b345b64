// =====================================================================
// RH › Gestão de Férias → "Enviar ao Malote" (04/11/2026, pedido do Pablo,
// mig 20261104007000). Antes o RH gerava as férias na Senior e lançava a
// despesa à mão no Malote; agora sai daqui, em três passos, cada um com
// confirmação ("precisa de confirmação pra tudo"):
//   1. ANEXAR o recibo gerado na Senior (PDF ou imagem) → status Senior
//      "Gerado". Trocar o arquivo apaga o valor já confirmado.
//   2. VALOR: o sistema lê o recibo (src/lib/rh/lerReciboFerias.ts, texto do
//      PDF ou OCR) e só preenche sozinho quando o "Líquido" bate com pelo
//      menos duas das outras formas do recibo (importância, extenso, totais)
//      — regra em src/lib/rh/reciboFerias.ts, com teste. Fora disso o RH
//      digita olhando o PDF. Recibo de outro CPF bloqueia; período ou dias
//      diferentes pedem um "conferi" explícito.
//   3. MALOTE: o MESMO PainelDespesaMalote da criação normal (prazo, exceção,
//      parcelas, rateio — nada de regra duplicada), com o valor travado no
//      confirmado, o recibo já anexado, classificação FÉRIAS, empresa da
//      Senior, contrato da filial e o colaborador como integrante. O envio
//      pede uma última confirmação.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, FileUp, Loader2, Send, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useEmpresasGrupo, uploadAnexosMalote } from "@/hooks/useMaloteDespesa";
import { FORM_ID_PAINEL_DESPESA_DIARIA, PainelDespesaMalote, type PayloadPainelDespesaMalote } from "@/pages/malote/PainelDespesaMalote";
import {
  conferirPessoa, conferirValor, fmtReais, paraNumero,
  type ConferenciaPessoa, type ConferenciaValor, type LeituraRecibo,
} from "@/lib/rh/reciboFerias";

const db = supabase as unknown as SupabaseClient;
export const BUCKET_RECIBO_FERIAS = "ferias-recibos";

/** As colunas da solicitação que o envio usa. */
export interface FeriasParaMalote {
  id: number;
  status: string;
  colaborador_id?: number | null;
  colaborador_nome?: string | null;
  colaborador_filial?: string | null;
  data_saida?: string | null;
  dias_ferias?: number | null;
  recibo_path?: string | null;
  recibo_nome?: string | null;
  recibo_anexado_por?: string | null;
  recibo_anexado_em?: string | null;
  valor_liquido?: number | string | null;
  valor_origem?: string | null;
  valor_leitura?: { pagamento?: string | null } | null;
  valor_confirmado_por?: string | null;
  valor_confirmado_em?: string | null;
  malote_despesa_id?: string | null;
}

export interface MaloteDaFerias { solicitacao_id: number; malote_despesa_id: string; numero: string | null; status: string; ativo: boolean }

interface Contexto {
  matricula: string | null; cpf: string | null; nome: string | null;
  empresa_id: string | null; contrato_id: string | null; contrato_nome: string | null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const fmtData = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const fmtDataHora = (s?: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const hojeIso = () => new Date().toLocaleDateString("sv-SE");

/** "UFRGS - MOTORISTAS - 034/2022" → "UFRGS MOTORISTAS 034.2022" — como o RH já nomeia as despesas de férias no Malote. */
export function nomeDespesaFerias(contrato: string | null | undefined, colaborador: string | null | undefined): string {
  const c = (contrato ?? "").replace(/^\s*\d+\s*-\s*/, "").replace(/\s*-\s*/g, " ").replace(/\//g, ".").replace(/\s+/g, " ").trim();
  return `FERIAS ${c ? `${c} - ` : ""}${(colaborador ?? "").trim()}`.replace(/\s+/g, " ").trim().toUpperCase();
}

async function baixarRecibo(path: string, nome: string): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET_RECIBO_FERIAS).download(path);
  if (error) throw error;
  return new File([data], nome, { type: data.type || (/\.pdf$/i.test(nome) ? "application/pdf" : undefined) });
}

export async function abrirReciboFerias(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET_RECIBO_FERIAS).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) { toast.error("Não foi possível abrir o recibo."); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

/** Caixa de confirmação dentro do próprio diálogo (também no Malote em massa). */
export function Confirmacao({ titulo, children, rotulo, ocupado, onConfirmar, onVoltar, desabilitado }: {
  titulo: string; children: React.ReactNode; rotulo: string; ocupado?: boolean; desabilitado?: boolean;
  onConfirmar: () => void; onVoltar: () => void;
}) {
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-amber-900"><ShieldCheck className="h-4 w-4" /> {titulo}</div>
      <div className="text-sm text-amber-950 space-y-2">{children}</div>
      <div className="flex gap-2">
        <Button onClick={onConfirmar} disabled={ocupado || desabilitado} className="gap-1.5">
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {rotulo}
        </Button>
        <Button variant="outline" onClick={onVoltar} disabled={ocupado}>Voltar</Button>
      </div>
    </div>
  );
}

function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  const itens = ["Recibo da Senior", "Valor", "Malote"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {itens.map((t, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const feito = n < atual;
        return (
          <div key={t} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${feito ? "bg-green-600 text-white" : n === atual ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {feito ? "✓" : n}
            </span>
            <span className={n === atual ? "font-semibold" : "text-muted-foreground"}>{t}</span>
            {i < itens.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

export function EnviarFeriasMalote({ aberto, sol, malote, podeEnviar, onFechar, onMudou }: {
  aberto: boolean;
  sol: FeriasParaMalote;
  malote: MaloteDaFerias | null;
  /** Ação "Enviar ao Malote" do menu rh_ferias (anexar/confirmar só pedem o "alterar"). */
  podeEnviar: boolean;
  onFechar: () => void;
  /** Recarrega a solicitação depois de cada passo gravado. */
  onMudou: () => Promise<void> | void;
}) {
  const [ctx, setCtx] = useState<Contexto | null>(null);
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    db.rpc("ferias_contexto_malote", { p_id: sol.id }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) toast.error("Não foi possível carregar o cadastro do colaborador: " + error.message);
      else setCtx(data as Contexto);
    });
    return () => { vivo = false; };
  }, [aberto, sol.id]);

  // Passo atual sai do que está gravado; "trocar recibo" volta ao 1.
  const [trocando, setTrocando] = useState(false);
  const enviada = !!malote?.ativo;
  const passo: 1 | 2 | 3 = trocando || !sol.recibo_path ? 1 : !sol.valor_confirmado_em ? 2 : 3;

  // O arquivo fica em memória entre os passos (não baixa de novo para ler).
  const [arquivo, setArquivo] = useState<File | null>(null);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Férias de {sol.colaborador_nome} → Malote</DialogTitle>
          <DialogDescription>
            Saída {fmtData(sol.data_saida)} · {sol.dias_ferias ?? "—"} dias{ctx?.contrato_nome ? ` · ${ctx.contrato_nome}` : sol.colaborador_filial ? ` · ${sol.colaborador_filial}` : ""}
          </DialogDescription>
        </DialogHeader>
        <Passos atual={enviada ? 3 : passo} />

        {enviada ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900">
            <div className="font-semibold">✅ Enviada ao Malote — despesa {malote?.numero ?? ""}</div>
            <div className="mt-1">Valor R$ {fmtReais(Number(sol.valor_liquido))} · status no Malote: {malote?.status}</div>
            <div className="mt-1 text-green-800">Para trocar o recibo ou o valor, a despesa precisa ser excluída ou reprovada no Malote.</div>
          </div>
        ) : passo === 1 ? (
          <PassoRecibo sol={sol} trocando={trocando} onCancelarTroca={() => setTrocando(false)}
            onAnexado={async (f) => { setArquivo(f); setTrocando(false); await onMudou(); }} />
        ) : passo === 2 ? (
          <PassoValor sol={sol} ctx={ctx} arquivo={arquivo} onArquivo={setArquivo}
            onTrocar={() => setTrocando(true)} onConfirmado={async () => { await onMudou(); }} />
        ) : (
          <PassoMalote sol={sol} ctx={ctx} arquivo={arquivo} onArquivo={setArquivo} podeEnviar={podeEnviar}
            onTrocar={() => setTrocando(true)} onEnviado={async () => { await onMudou(); }} />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Passo 1 ──────────────────────────────────────────────────────────
function PassoRecibo({ sol, trocando, onCancelarTroca, onAnexado }: {
  sol: FeriasParaMalote; trocando: boolean; onCancelarTroca: () => void; onAnexado: (f: File) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const anexar = async () => {
    if (!escolhido) return;
    setEnviando(true);
    const limpo = escolhido.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ()]/g, "_");
    const path = `${sol.id}/${Date.now()}-${limpo}`;
    try {
      const up = await supabase.storage.from(BUCKET_RECIBO_FERIAS).upload(path, escolhido, { upsert: false, contentType: escolhido.type || undefined });
      if (up.error) throw up.error;
      const { error } = await db.rpc("ferias_recibo_anexar", { p_id: sol.id, p_path: path, p_nome: escolhido.name });
      if (error) {
        await supabase.storage.from(BUCKET_RECIBO_FERIAS).remove([path]).catch(() => undefined);
        throw error;
      }
      toast.success("Recibo anexado. Status Senior: Gerado.");
      await onAnexado(escolhido);
    } catch (e) {
      toast.error("Não foi possível anexar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Anexe o <b>Aviso e Recibo de Férias</b> gerado na Senior para este colaborador (PDF ou foto/escaneado). O sistema lê o valor líquido no próximo passo.
      </p>
      {trocando && sol.recibo_path && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Trocar o recibo apaga o valor já confirmado ({sol.valor_liquido != null ? `R$ ${fmtReais(Number(sol.valor_liquido))}` : "nenhum"}) — ele terá de ser conferido de novo.
          <Button variant="link" className="h-auto p-0 pl-2" onClick={onCancelarTroca}>Manter o atual</Button>
        </div>
      )}
      {!escolhido ? (
        <div>
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setEscolhido(f); e.target.value = ""; }} />
          <Button onClick={() => input.current?.click()} className="gap-1.5"><FileUp className="h-4 w-4" /> Escolher o arquivo do recibo</Button>
        </div>
      ) : (
        <Confirmacao titulo="Confirmar o anexo" rotulo="Confirmar anexo" ocupado={enviando}
          onConfirmar={anexar} onVoltar={() => setEscolhido(null)}>
          <p>Anexar <b>{escolhido.name}</b> ({(escolhido.size / 1024).toFixed(0)} KB) como recibo de férias da Senior de <b>{sol.colaborador_nome}</b>?</p>
          <p>O status Senior destas férias passa para <b>Gerado</b>.</p>
        </Confirmacao>
      )}
    </div>
  );
}

// ── Passo 2 ──────────────────────────────────────────────────────────
function PassoValor({ sol, ctx, arquivo, onArquivo, onTrocar, onConfirmado }: {
  sol: FeriasParaMalote; ctx: Contexto | null; arquivo: File | null; onArquivo: (f: File) => void;
  onTrocar: () => void; onConfirmado: () => Promise<void>;
}) {
  const [progresso, setProgresso] = useState("");
  const [erroLeitura, setErroLeitura] = useState("");
  const [leitura, setLeitura] = useState<LeituraRecibo | null>(null);
  const [origemTexto, setOrigemTexto] = useState("");
  const [digitado, setDigitado] = useState("");
  const [conferi, setConferi] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [gravando, setGravando] = useState(false);

  // Lê uma vez por arquivo.
  useEffect(() => {
    if (!sol.recibo_path) return;
    let vivo = true;
    (async () => {
      setErroLeitura(""); setLeitura(null);
      try {
        const f = arquivo ?? await baixarRecibo(sol.recibo_path!, sol.recibo_nome ?? "recibo.pdf");
        if (!arquivo) onArquivo(f);
        const { lerReciboFerias } = await import("@/lib/rh/lerReciboFerias");
        const r = await lerReciboFerias(f, (m) => vivo && setProgresso(m));
        if (!vivo) return;
        setLeitura(r.leitura); setOrigemTexto(r.origem);
      } catch (e) {
        if (vivo) setErroLeitura(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setProgresso("");
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sol.recibo_path]);

  const conf: ConferenciaValor | null = useMemo(() => (leitura ? conferirValor(leitura) : null), [leitura]);
  const pessoa: ConferenciaPessoa | null = useMemo(() => (leitura ? conferirPessoa(leitura, {
    cpf: ctx?.cpf, matricula: ctx?.matricula, nome: ctx?.nome ?? sol.colaborador_nome,
    dataSaida: sol.data_saida, diasFerias: sol.dias_ferias,
  }) : null), [leitura, ctx, sol.colaborador_nome, sol.data_saida, sol.dias_ferias]);

  const lendo = !!progresso || (!leitura && !erroLeitura);
  const automatico = !!conf?.confiavel;
  const valorDigitado = paraNumero(digitado.trim().replace(/^R\$\s*/, ""));
  const valorFinal = automatico ? conf!.valor : valorDigitado;
  const bloqueado = !!pessoa?.bloqueios.length;
  const precisaConferir = !!pessoa?.avisos.length || !automatico;
  const podeConfirmar = !bloqueado && valorFinal != null && valorFinal > 0 && (!precisaConferir || conferi);

  const confirmar = async () => {
    if (!podeConfirmar || valorFinal == null) return;
    setGravando(true);
    const { error } = await db.rpc("ferias_valor_confirmar", {
      p_id: sol.id, p_valor: valorFinal, p_origem: automatico ? "leitura" : "digitado",
      p_leitura: leitura ? {
        origem: origemTexto, provas: conf?.provas, problemas: conf?.problemas,
        avisos: pessoa?.avisos, liquido: leitura.liquido, importancia: leitura.importancia, extenso: leitura.extenso,
        proventos: leitura.proventos, descontos: leitura.descontos, cadastro: leitura.cadastro, cpf: leitura.cpf,
        periodo_inicio: leitura.periodoInicio, periodo_fim: leitura.periodoFim, pagamento: leitura.pagamento,
      } : { origem: "sem leitura", erro: erroLeitura },
    });
    setGravando(false);
    if (error) { toast.error("Não foi possível confirmar: " + error.message); return; }
    toast.success(`Valor R$ ${fmtReais(valorFinal)} confirmado.`);
    setConfirmando(false);
    await onConfirmado();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Recibo: <b>{sol.recibo_nome}</b> · anexado por {sol.recibo_anexado_por ?? "—"} em {fmtDataHora(sol.recibo_anexado_em)}</span>
        {sol.recibo_path && <Button variant="outline" size="sm" className="gap-1" onClick={() => abrirReciboFerias(sol.recibo_path!)}><ExternalLink className="h-3.5 w-3.5" /> Abrir o recibo</Button>}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onTrocar}>Trocar o recibo</Button>
      </div>

      {lendo ? (
        <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {progresso || "Lendo o recibo…"}
        </div>
      ) : (
        <>
          {erroLeitura && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Não consegui ler o arquivo ({erroLeitura}). Digite o valor líquido olhando o recibo.
            </div>
          )}
          {pessoa && pessoa.bloqueios.length > 0 && (
            <div className="rounded-md border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Este recibo não é deste colaborador</div>
              <ul className="mt-1 list-disc pl-5">{pessoa.bloqueios.map((b) => <li key={b}>{b}</li>)}</ul>
              <Button size="sm" variant="outline" className="mt-2" onClick={onTrocar}>Anexar o recibo certo</Button>
            </div>
          )}
          {pessoa && pessoa.ok.length > 0 && (
            <ul className="text-sm text-green-800">{pessoa.ok.map((o) => <li key={o}>✓ {o}</li>)}</ul>
          )}

          {automatico ? (
            <div className="rounded-lg border-2 border-green-300 bg-green-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-green-800">Valor líquido lido do recibo ({origemTexto})</div>
              <div className="text-3xl font-bold text-green-900">R$ {fmtReais(conf!.valor!)}</div>
              <div className="mt-2 text-xs text-green-900">Conferido por {conf!.provas.length} leituras independentes que batem entre si:</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-green-900">{conf!.provas.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-2">
              <div className="font-semibold text-amber-900">O valor não pôde ser puxado com segurança — digite o líquido olhando o recibo</div>
              {conf && conf.problemas.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-900">{conf.problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
              {conf && conf.provas.length > 0 && <div className="text-xs text-amber-800">Lido: {conf.provas.join(" · ")}</div>}
              <div className="max-w-xs space-y-1">
                <Label className="text-xs">Valor líquido do recibo (R$) *</Label>
                <Input value={digitado} onChange={(e) => setDigitado(e.target.value)} placeholder="Ex.: 692,99" inputMode="decimal" />
                {digitado && valorDigitado == null && <p className="text-xs text-red-700">Use o formato 1.234,56 (com os centavos).</p>}
                {valorDigitado != null && leitura?.liquido != null && Math.round(valorDigitado * 100) !== Math.round(leitura.liquido * 100) && (
                  <p className="text-xs text-red-700">Atenção: o sistema leu R$ {fmtReais(leitura.liquido)} no campo "Líquido". Confira no PDF.</p>
                )}
              </div>
            </div>
          )}

          {pessoa && pessoa.avisos.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">Confira no PDF:</div>
              <ul className="list-disc pl-5">{pessoa.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          )}

          {!confirmando ? (
            <Button disabled={bloqueado || valorFinal == null} onClick={() => { setConferi(false); setConfirmando(true); }} className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Confirmar o valor{valorFinal != null ? ` de R$ ${fmtReais(valorFinal)}` : ""}
            </Button>
          ) : (
            <Confirmacao titulo="Confirmar o valor líquido" rotulo={`Confirmo R$ ${valorFinal != null ? fmtReais(valorFinal) : "—"}`}
              ocupado={gravando} desabilitado={!podeConfirmar} onConfirmar={confirmar} onVoltar={() => setConfirmando(false)}>
              <p>O líquido das férias de <b>{sol.colaborador_nome}</b> é <b>R$ {valorFinal != null ? fmtReais(valorFinal) : "—"}</b>? É este valor que vai para o Malote.</p>
              {precisaConferir && (
                <label className="flex items-start gap-2">
                  <Checkbox checked={conferi} onCheckedChange={(v) => setConferi(v === true)} className="mt-0.5" />
                  <span>Abri o recibo e conferi{!automatico ? " o valor digitado" : ""}{pessoa?.avisos.length ? ", o colaborador e o período" : ""}.</span>
                </label>
              )}
            </Confirmacao>
          )}
        </>
      )}
    </div>
  );
}

// ── Passo 3 ──────────────────────────────────────────────────────────
function PassoMalote({ sol, ctx, arquivo, onArquivo, podeEnviar, onTrocar, onEnviado }: {
  sol: FeriasParaMalote; ctx: Contexto | null; arquivo: File | null; onArquivo: (f: File) => void;
  podeEnviar: boolean; onTrocar: () => void; onEnviado: () => Promise<void>;
}) {
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: empresas = [] } = useEmpresasGrupo();
  const [classificacaoId, setClassificacaoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [pendente, setPendente] = useState<{ payload: PayloadPainelDespesaMalote; fim: () => void } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroArquivo, setErroArquivo] = useState("");
  const valor = Number(sol.valor_liquido);

  useEffect(() => {
    if (classificacaoId || !classificacoes.length) return;
    const achou = classificacoes.find((c) => c.ativo && norm(c.nome) === "ferias");
    if (achou) setClassificacaoId(achou.id);
  }, [classificacoes, classificacaoId]);
  useEffect(() => {
    if (empresaId || !ctx) return;
    const e = ctx.empresa_id;
    if (e) setEmpresaId(e);
  }, [ctx, empresaId]);
  // O recibo segue anexado na despesa (é o que o aprovador do Malote olha).
  useEffect(() => {
    if (arquivo || !sol.recibo_path) return;
    baixarRecibo(sol.recibo_path, sol.recibo_nome ?? "recibo.pdf").then(onArquivo)
      .catch((e) => setErroArquivo(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sol.recibo_path, arquivo]);

  const classificacao = classificacoes.find((c) => c.id === classificacaoId) ?? null;
  const pronto = !!classificacao && !!empresaId && !!ctx && !!arquivo;
  const pagamentoLido = sol.valor_leitura?.pagamento ?? null;
  const nomeInicial = nomeDespesaFerias(ctx?.contrato_nome ?? sol.colaborador_filial, sol.colaborador_nome);

  // O painel chama aoSalvar já validado; aqui ele espera a confirmação final.
  const aoSalvar = (payload: PayloadPainelDespesaMalote) => new Promise<void>((resolve) => setPendente({ payload, fim: resolve }));

  const enviarDeVerdade = async () => {
    if (!pendente) return;
    setEnviando(true);
    const { arquivosNovos, ...despesa } = pendente.payload;
    const despesaId = crypto.randomUUID();
    let paths: string[] = [];
    try {
      paths = await uploadAnexosMalote(arquivosNovos, despesaId, despesa.nome);
      const { error } = await db.rpc("ferias_enviar_malote", { p_id: sol.id, p_despesa_id: despesaId, p_despesa: { ...despesa, arquivos: paths } });
      if (error) throw error;
      const { data: info } = await db.rpc("ferias_malote_info", { p_ids: [sol.id] });
      toast.success(`Despesa ${(info as MaloteDaFerias[] | null)?.[0]?.numero ?? ""} criada no Malote — entrou na fila de aprovação.`);
      pendente.fim();
      setPendente(null);
      await onEnviado();
    } catch (e) {
      if (paths.length) await supabase.storage.from("malote-anexos").remove(paths).catch(() => undefined);
      toast.error("Não foi enviado: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };
  const desistir = () => { pendente?.fim(); setPendente(null); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <span>Valor confirmado: <b>R$ {fmtReais(valor)}</b> ({sol.valor_origem === "leitura" ? "lido do recibo" : "digitado"}) por {sol.valor_confirmado_por} em {fmtDataHora(sol.valor_confirmado_em)}</span>
        {sol.recibo_path && <Button variant="outline" size="sm" className="gap-1" onClick={() => abrirReciboFerias(sol.recibo_path!)}><ExternalLink className="h-3.5 w-3.5" /> Recibo</Button>}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onTrocar}>Trocar o recibo</Button>
      </div>

      {!podeEnviar ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Você anexa e confere, mas não tem a ação <b>Enviar ao Malote</b> da Gestão de Férias. Peça em Administração › Acesso por Usuário.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Classificação *</Label>
              <SearchableSelect value={classificacaoId} onChange={setClassificacaoId}
                options={classificacoes.filter((c) => c.ativo).map((c) => ({ value: c.id, label: c.nome }))} placeholder="Escolha a classificação" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Empresa pagadora *</Label>
              <SearchableSelect value={empresaId} onChange={setEmpresaId}
                options={empresas.map((e) => ({ value: e.id, label: e.nome }))} placeholder="Escolha a empresa" />
              <p className="text-[11px] text-muted-foreground">Sugerida pela empresa do colaborador na Senior.</p>
            </div>
          </div>
          {!ctx?.contrato_id && ctx && (
            <p className="text-xs text-amber-800">Não achei o contrato da filial "{sol.colaborador_filial}" — escolha no rateio abaixo.</p>
          )}
          {erroArquivo && <p className="text-xs text-red-700">Não consegui trazer o recibo para anexar ({erroArquivo}) — anexe à mão no formulário.</p>}

          {pendente && (
            <Confirmacao titulo="Confirmar o envio ao Malote" rotulo="Enviar ao Malote" ocupado={enviando}
              onConfirmar={enviarDeVerdade} onVoltar={desistir}>
              <p>Criar a despesa <b>{pendente.payload.nome}</b> de <b>R$ {fmtReais(Number(pendente.payload.valor_total))}</b> no Malote?</p>
              <p>Pagamento em {fmtData(pendente.payload.data_pagamento)} · {pendente.payload.forma_pagamento} · competência {pendente.payload.competencia?.slice(0, 7).split("-").reverse().join("/")}. Ela entra na fila de aprovação e a data do malote destas férias fica registrada como hoje.</p>
            </Confirmacao>
          )}

          {!pronto ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {!ctx || (!arquivo && !erroArquivo)
                ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Preparando…</span>
                : "Escolha a classificação e a empresa pagadora."}
            </div>
          ) : (
            <div className={pendente ? "pointer-events-none opacity-50" : ""}>
              <PainelDespesaMalote
                key={`${classificacaoId}|${empresaId}`}
                classificacaoId={classificacaoId}
                classificacaoTipo={classificacao?.tipo ?? "contrato"}
                empresaId={empresaId}
                ativo
                nomeInicial={nomeInicial}
                valorInicial={valor}
                inicial={{
                  competencia: sol.data_saida ? sol.data_saida.slice(0, 7) : undefined,
                  dataPagamento: pagamentoLido && pagamentoLido >= hojeIso() ? pagamentoLido : undefined,
                  formaPagamento: "Banco Mentore",
                }}
                linhaRateioPadrao={{ contrato_id: ctx?.contrato_id ?? null, integrante_empregado_id: sol.colaborador_id ?? null }}
                fornecedorPadraoNome="0 - Dispensa 1"
                arquivosIniciais={arquivo ? [arquivo] : []}
                aoSalvar={aoSalvar}
                rotuloEnviar="Enviar ao Malote"
              />
              <div className="mt-3 flex justify-end">
                <Button type="submit" form={FORM_ID_PAINEL_DESPESA_DIARIA} disabled={!!pendente} className="gap-1.5">
                  <Send className="h-4 w-4" /> Revisar e enviar ao Malote
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
