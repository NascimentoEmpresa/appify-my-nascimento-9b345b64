// =====================================================================
// RH › Gestão de Férias → "Malote em massa" (05/11/2026, pedido do Pablo,
// mig 20261105013000). O RH sobe o lote que a Senior gera por filial (relação
// bancária + um recibo por pessoa) e, numa ida só:
//   1. ARQUIVO: o sistema lê cada página (texto do PDF; página escaneada por
//      OCR) e acha as pessoas — src/lib/rh/loteFerias.ts, com teste.
//   2. CONFERÊNCIA: cada pessoa casada com a solicitação dela (CPF + nome
//      completo + saída), o valor puxado só quando bate com 2 provas
//      independentes (relação bancária, importância, extenso, totais); o resto
//      o RH digita olhando o PDF. Quem não casa fica de fora, com o motivo.
//      Confirmação: o arquivo vai anexado em cada solicitação, com aqueles
//      valores.
//   3. MALOTE: o MESMO PainelDespesaMalote do envio individual, já com o total
//      e uma linha de rateio por colaborador (contrato, integrante, fornecedor
//      "0 - Dispensa 1"), o arquivo anexado e classificação FÉRIAS. Última
//      confirmação → ferias_lote_enviar_malote grava tudo numa transação.
// Nada vai ao banco antes do último clique: desistir no meio não deixa lote
// pela metade.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, Layers, Loader2, Send } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { uploadAnexosMalote, useEmpresasGrupo, useFornecedoresAtivos, useIntegrantes, type RateioLinha } from "@/hooks/useMaloteDespesa";
import { FORM_ID_PAINEL_DESPESA_DIARIA, PainelDespesaMalote, type PayloadPainelDespesaMalote } from "@/pages/malote/PainelDespesaMalote";
import { acharFornecedorPorNome } from "@/pages/malote/rateioPadrao";
import { percentuaisQueFecham } from "@/lib/rh/rateioParaMalote";
import { fmtReais, paraNumero } from "@/lib/rh/reciboFerias";
import {
  casarPessoa, montarLote, nomeDespesaLote,
  type CandidataLote, type Casamento, type Lote, type PessoaLote,
} from "@/lib/rh/loteFerias";
import { BUCKET_RECIBO_FERIAS, Confirmacao } from "./EnviarFeriasMalote";

const db = supabase as unknown as SupabaseClient;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const fmtData = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const hojeIso = () => new Date().toLocaleDateString("sv-SE");
const centavos = (n: number) => Math.round(n * 100);

/** O que o RH decidiu para cada pessoa do arquivo. */
interface Escolha {
  incluir: boolean;
  solicitacaoId: number | null;
  digitado: string;
  conferi: boolean;
}

/** Uma linha da conferência, com tudo resolvido. */
interface Linha {
  pessoa: PessoaLote;
  casamento: Casamento;
  escolha: Escolha;
  candidata: CandidataLote | null;
  automatico: boolean;
  valor: number | null;
  /** Motivo de não poder entrar (null = pode). */
  impedimento: string | null;
  precisaConferir: boolean;
}

function resolver(p: PessoaLote, c: Casamento, e: Escolha, candidatas: CandidataLote[]): Linha {
  const candidata = candidatas.find((x) => x.id === e.solicitacaoId) ?? null;
  const automatico = p.conferencia.confiavel;
  const valorDigitado = paraNumero(e.digitado.trim().replace(/^R\$\s*/, ""));
  const valor = automatico ? p.conferencia.valor : valorDigitado;
  const trocouSolicitacao = e.solicitacaoId != null && e.solicitacaoId !== c.solicitacaoId;
  const precisaConferir = !automatico || c.avisos.length > 0 || trocouSolicitacao;
  let impedimento: string | null = null;
  if (c.bloqueios.length) impedimento = c.bloqueios[0];
  else if (!candidata) impedimento = "Escolha a solicitação destas férias.";
  else if (valor == null || valor <= 0) impedimento = automatico ? "Sem valor." : "Digite o valor líquido olhando o recibo.";
  else if (precisaConferir && !e.conferi) impedimento = "Marque que conferiu no PDF.";
  return { pessoa: p, casamento: c, escolha: e, candidata, automatico, valor, impedimento, precisaConferir };
}

function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  const itens = ["Arquivo do lote", "Conferência", "Malote"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {itens.map((t, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        return (
          <div key={t} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${n < atual ? "bg-green-600 text-white" : n === atual ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {n < atual ? "✓" : n}
            </span>
            <span className={n === atual ? "font-semibold" : "text-muted-foreground"}>{t}</span>
            {i < itens.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

export function EnviarFeriasLoteMalote({ aberto, onFechar, onEnviado }: {
  aberto: boolean;
  onFechar: () => void;
  /** Recarrega a lista depois do envio. */
  onEnviado: () => Promise<void> | void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState("");
  const [lote, setLote] = useState<Lote | null>(null);
  const [paginasOcr, setPaginasOcr] = useState<number[]>([]);
  const [candidatas, setCandidatas] = useState<CandidataLote[]>([]);
  const [casamentos, setCasamentos] = useState<Map<string, Casamento>>(new Map());
  const [escolhas, setEscolhas] = useState<Map<string, Escolha>>(new Map());
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [enviado, setEnviado] = useState<{ numero: string | null; n: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const recomecar = () => {
    setArquivo(null); setLote(null); setErro(""); setProgresso(""); setPaginasOcr([]);
    setCandidatas([]); setCasamentos(new Map()); setEscolhas(new Map()); setEtapa(1);
  };

  const ler = async (f: File) => {
    recomecar();
    setArquivo(f);
    try {
      const { lerPaginasLote } = await import("@/lib/rh/lerReciboFerias");
      const r = await lerPaginasLote(f, setProgresso);
      const l = montarLote(r.paginas);
      if (!l.pessoas.length) throw new Error("Não achei nenhuma pessoa no arquivo (nem relação bancária, nem recibo de férias).");
      setProgresso("Procurando as solicitações no sistema…");
      const { data, error } = await db.rpc("ferias_lote_localizar", {
        p_pessoas: l.pessoas.map((p) => ({ cpf: p.cpf, nome: p.nome })),
      });
      if (error) throw error;
      const cands = ((data ?? []) as CandidataLote[]).map((c) => ({ ...c, id: Number(c.id), colaborador_id: c.colaborador_id != null ? Number(c.colaborador_id) : null }));
      const cas = new Map<string, Casamento>();
      const esc = new Map<string, Escolha>();
      for (const p of l.pessoas) {
        const c = casarPessoa(p, cands);
        cas.set(p.chave, c);
        esc.set(p.chave, {
          incluir: !c.bloqueios.length && c.solicitacaoId != null,
          solicitacaoId: c.solicitacaoId,
          digitado: "",
          conferi: false,
        });
      }
      setLote(l); setPaginasOcr(r.paginasOcr); setCandidatas(cands); setCasamentos(cas); setEscolhas(esc);
      setEtapa(2);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setProgresso("");
    }
  };

  const linhas: Linha[] = useMemo(() => (lote?.pessoas ?? []).map((p) =>
    resolver(p, casamentos.get(p.chave)!, escolhas.get(p.chave)!, candidatas)), [lote, casamentos, escolhas, candidatas]);
  const incluidas = linhas.filter((l) => l.escolha.incluir && !l.impedimento);
  const marcadasComProblema = linhas.filter((l) => l.escolha.incluir && l.impedimento);
  const total = incluidas.reduce((s, l) => s + centavos(l.valor!), 0) / 100;
  // A mesma solicitação para duas pessoas do arquivo não passa.
  const repetidas = useMemo(() => {
    const vistos = new Map<number, number>();
    for (const l of incluidas) vistos.set(l.candidata!.id, (vistos.get(l.candidata!.id) ?? 0) + 1);
    return [...vistos].filter(([, n]) => n > 1).map(([id]) => id);
  }, [incluidas]);

  const mudar = (chave: string, parcial: Partial<Escolha>) =>
    setEscolhas((m) => new Map(m).set(chave, { ...m.get(chave)!, ...parcial }));

  const fechar = () => { if (enviado) void onEnviado(); recomecar(); setEnviado(null); onFechar(); };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-5 w-5" /> Malote em massa — férias de vários colaboradores</DialogTitle>
          <DialogDescription>
            Suba o arquivo de férias da Senior com a relação bancária e os recibos de todos. O sistema lê cada pessoa, acha a solicitação dela,
            anexa o mesmo arquivo em cada uma e cria UMA despesa no Malote com o total. Nada é gravado até o último "Enviar ao Malote".
          </DialogDescription>
        </DialogHeader>
        <Passos atual={enviado ? 3 : etapa} />

        {enviado ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900">
            <div className="font-semibold">✅ Despesa {enviado.numero ?? ""} criada no Malote — R$ {fmtReais(enviado.total)}</div>
            <div className="mt-1">{enviado.n} férias vinculadas: cada solicitação ficou com o arquivo, o valor confirmado e a data do malote de hoje.</div>
          </div>
        ) : etapa === 1 ? (
          <div className="space-y-3">
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); e.target.value = ""; }} />
            {progresso ? (
              <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {progresso}
              </div>
            ) : (
              <Button onClick={() => input.current?.click()} className="gap-1.5"><FileUp className="h-4 w-4" /> Escolher o arquivo do lote</Button>
            )}
            {erro && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                Não consegui ler {arquivo ? <b>{arquivo.name}</b> : "o arquivo"}: {erro}
              </div>
            )}
          </div>
        ) : etapa === 2 && lote && arquivo ? (
          <PassoConferencia
            arquivo={arquivo} lote={lote} paginasOcr={paginasOcr} linhas={linhas} candidatas={candidatas}
            incluidas={incluidas} marcadasComProblema={marcadasComProblema} total={total} repetidas={repetidas}
            onMudar={mudar} onTrocarArquivo={() => { recomecar(); setTimeout(() => input.current?.click(), 0); }}
            onConfirmar={() => setEtapa(3)}
          />
        ) : etapa === 3 && lote && arquivo ? (
          <PassoMaloteLote
            arquivo={arquivo} lote={lote} incluidas={incluidas} total={total}
            onVoltar={() => setEtapa(2)}
            onEnviado={(numero) => setEnviado({ numero, n: incluidas.length, total })}
          />
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Passo 2: conferência ─────────────────────────────────────────────
function PassoConferencia({ arquivo, lote, paginasOcr, linhas, candidatas, incluidas, marcadasComProblema, total, repetidas, onMudar, onTrocarArquivo, onConfirmar }: {
  arquivo: File; lote: Lote; paginasOcr: number[]; linhas: Linha[]; candidatas: CandidataLote[];
  incluidas: Linha[]; marcadasComProblema: Linha[]; total: number; repetidas: number[];
  onMudar: (chave: string, p: Partial<Escolha>) => void; onTrocarArquivo: () => void; onConfirmar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [conferiTudo, setConferiTudo] = useState(false);
  const rel = lote.relacao;
  const podeSeguir = incluidas.length > 0 && !marcadasComProblema.length && !repetidas.length;
  const abrirPdf = () => { const u = URL.createObjectURL(arquivo); window.open(u, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(u), 60_000); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <span>Arquivo: <b>{arquivo.name}</b></span>
        {rel && <span>Filial {rel.filialCodigo} {rel.filialNome} · {rel.banco ?? "—"} · pagamento {fmtData(rel.dataPagamento)}</span>}
        <Button variant="outline" size="sm" onClick={abrirPdf}>Abrir o PDF</Button>
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onTrocarArquivo}>Trocar o arquivo</Button>
      </div>
      {paginasOcr.length > 0 && (
        <p className="text-xs text-amber-800">Página(s) {paginasOcr.join(", ")} sem texto — lidas por OCR (imagem). Confira com atenção.</p>
      )}
      {lote.avisos.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <ul className="list-disc pl-5">{lote.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Incluir</th>
              <th className="p-2 text-left">No arquivo</th>
              <th className="p-2 text-left">Solicitação no sistema</th>
              <th className="p-2 text-left">Valor líquido</th>
              <th className="p-2 text-left">Conferência</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const { pessoa: p, casamento: c, escolha: e } = l;
              const bloqueada = c.bloqueios.length > 0;
              return (
                <tr key={p.chave} className={`border-t align-top ${bloqueada ? "bg-red-50/60" : e.incluir && !l.impedimento ? "bg-green-50/40" : ""}`}>
                  <td className="p-2">
                    <Checkbox checked={e.incluir} disabled={bloqueada} onCheckedChange={(v) => onMudar(p.chave, { incluir: v === true })} />
                  </td>
                  <td className="p-2">
                    <div className="font-semibold">{p.nome ?? "(nome ilegível)"}</div>
                    <div className="text-xs text-muted-foreground">
                      CPF {p.cpf ? p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—"} · cadastro {p.cadastro ?? "—"}
                      {p.paginaRecibo ? ` · recibo na pág. ${p.paginaRecibo}` : " · sem recibo"}
                    </div>
                    {p.recibo?.periodoInicio && (
                      <div className="text-xs text-muted-foreground">Férias {fmtData(p.recibo.periodoInicio)} a {fmtData(p.recibo.periodoFim)}</div>
                    )}
                  </td>
                  <td className="p-2 min-w-[220px]">
                    {c.opcoes.length > 1 || (c.opcoes.length === 1 && !c.solicitacaoId) ? (
                      <select className="w-full rounded border bg-background px-2 py-1 text-sm" value={e.solicitacaoId ?? ""}
                        onChange={(ev) => onMudar(p.chave, { solicitacaoId: ev.target.value ? Number(ev.target.value) : null, conferi: false })}>
                        <option value="">Escolha…</option>
                        {c.opcoes.map((o) => (
                          <option key={o.id} value={o.id}>#{o.id} · saída {fmtData(o.data_saida)} · {o.dias_ferias ?? "—"} dias</option>
                        ))}
                      </select>
                    ) : l.candidata ? (
                      <div>#{l.candidata.id} · saída {fmtData(l.candidata.data_saida)} · {l.candidata.dias_ferias ?? "—"} dias</div>
                    ) : <span className="text-muted-foreground">—</span>}
                    {l.candidata && <div className="text-xs text-muted-foreground">{l.candidata.nome} · {l.candidata.contrato_nome ?? "contrato não achado"}</div>}
                  </td>
                  <td className="p-2 min-w-[170px]">
                    {l.automatico ? (
                      <div>
                        <div className="font-bold text-green-800">R$ {fmtReais(p.conferencia.valor!)}</div>
                        <div className="text-[11px] text-green-800" title={p.conferencia.provas.join("\n")}>✓ {p.conferencia.provas.length} leituras batem</div>
                      </div>
                    ) : !bloqueada ? (
                      <div className="space-y-1">
                        <Input value={e.digitado} onChange={(ev) => onMudar(p.chave, { digitado: ev.target.value, conferi: false })}
                          placeholder={p.conferencia.valor != null ? `lido: ${fmtReais(p.conferencia.valor)}` : "Ex.: 1.234,56"} inputMode="decimal" className="h-8" />
                        {e.digitado && paraNumero(e.digitado.trim().replace(/^R\$\s*/, "")) == null && <div className="text-[11px] text-red-700">Formato 1.234,56</div>}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-xs">
                    {c.bloqueios.map((b) => <div key={b} className="text-red-800">⛔ {b}</div>)}
                    {!l.automatico && !bloqueada && p.conferencia.problemas.map((x) => <div key={x} className="text-amber-800">⚠ {x}</div>)}
                    {c.avisos.map((a) => <div key={a} className="text-amber-800">⚠ {a}</div>)}
                    {c.ok.map((o) => <div key={o} className="text-green-800">✓ {o}</div>)}
                    {!bloqueada && l.precisaConferir && (
                      <label className="mt-1 flex items-start gap-1.5 font-medium text-amber-950">
                        <Checkbox checked={e.conferi} onCheckedChange={(v) => onMudar(p.chave, { conferi: v === true })} className="mt-0.5" />
                        Conferi no PDF
                      </label>
                    )}
                    {e.incluir && l.impedimento && !bloqueada && <div className="mt-1 font-semibold text-red-700">{l.impedimento}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span><b>{incluidas.length}</b> de {linhas.length} incluída(s) · total <b>R$ {fmtReais(total)}</b></span>
        {rel?.totalGeral != null && (
          centavos(rel.totalGeral) === centavos(total)
            ? <span className="text-green-800">✓ Igual ao Total Geral da relação bancária</span>
            : <span className="text-amber-800">⚠ Total Geral da relação: R$ {fmtReais(rel.totalGeral)}</span>
        )}
      </div>
      {repetidas.length > 0 && (
        <p className="text-sm text-red-700">A solicitação {repetidas.map((id) => `#${id}`).join(", ")} está em duas pessoas do arquivo — corrija antes de seguir.</p>
      )}

      {!confirmando ? (
        <Button disabled={!podeSeguir} onClick={() => { setConferiTudo(false); setConfirmando(true); }} className="gap-1.5">
          <CheckCircle2 className="h-4 w-4" /> Confirmar {incluidas.length} férias · R$ {fmtReais(total)}
        </Button>
      ) : (
        <Confirmacao titulo="Confirmar o anexo e os valores" rotulo="Confirmo — seguir para o Malote" desabilitado={!conferiTudo}
          onConfirmar={onConfirmar} onVoltar={() => setConfirmando(false)}>
          <p>O arquivo <b>{arquivo.name}</b> vai anexado como recibo da Senior em cada uma destas {incluidas.length} solicitações, com o valor ao lado:</p>
          <ul className="list-disc pl-5">
            {incluidas.map((l) => <li key={l.pessoa.chave}>{l.candidata!.nome} (#{l.candidata!.id}, saída {fmtData(l.candidata!.data_saida)}) — <b>R$ {fmtReais(l.valor!)}</b>{l.automatico ? "" : " (digitado)"}</li>)}
          </ul>
          <p>Total <b>R$ {fmtReais(total)}</b>. Nada é gravado ainda: no próximo passo você revisa a despesa e envia.</p>
          <label className="flex items-start gap-2">
            <Checkbox checked={conferiTudo} onCheckedChange={(v) => setConferiTudo(v === true)} className="mt-0.5" />
            <span>Conferi: o arquivo é das férias destas pessoas e os valores estão certos.</span>
          </label>
        </Confirmacao>
      )}
      {linhas.length > incluidas.length && (
        <p className="text-xs text-muted-foreground">Quem ficou de fora não é tocado — dá para enviar depois, pelo botão da própria solicitação.</p>
      )}
    </div>
  );
}

// ── Passo 3: a despesa ───────────────────────────────────────────────
function PassoMaloteLote({ arquivo, lote, incluidas, total, onVoltar, onEnviado }: {
  arquivo: File; lote: Lote; incluidas: Linha[]; total: number;
  onVoltar: () => void; onEnviado: (numero: string | null) => void;
}) {
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: fornecedores = [], isFetched: fornecedoresProntos } = useFornecedoresAtivos();
  const { data: integrantes = [], isFetched: integrantesProntos } = useIntegrantes();
  const [classificacaoId, setClassificacaoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [pendente, setPendente] = useState<{ payload: PayloadPainelDespesaMalote; fim: () => void } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const empresasDasPessoas = useMemo(() => [...new Set(incluidas.map((l) => l.candidata!.empresa_id).filter(Boolean))] as string[], [incluidas]);
  useEffect(() => {
    if (classificacaoId || !classificacoes.length) return;
    const achou = classificacoes.find((c) => c.ativo && norm(c.nome) === "ferias");
    if (achou) setClassificacaoId(achou.id);
  }, [classificacoes, classificacaoId]);
  useEffect(() => {
    if (!empresaId && empresasDasPessoas.length) setEmpresaId(empresasDasPessoas[0]);
  }, [empresasDasPessoas, empresaId]);

  const classificacao = classificacoes.find((c) => c.id === classificacaoId) ?? null;
  const fornecedorId = acharFornecedorPorNome(fornecedores, "0 - Dispensa 1")?.id ?? null;
  // Uma linha por colaborador: contrato dele, integrante = ele (se está na
  // lista do combobox — quem está de férias pode não estar "Trabalhando").
  const rateioInicial: RateioLinha[] = useMemo(() => {
    const pcts = percentuaisQueFecham(incluidas.map((l) => l.valor!));
    const ids = new Set(integrantes.map((i) => i.id));
    return incluidas.map((l, k) => ({
      empresa_id: empresaId || null,
      contrato_id: l.candidata!.contrato_id,
      fornecedor_id: fornecedorId,
      integrante_empregado_id: l.candidata!.colaborador_id != null && ids.has(l.candidata!.colaborador_id) ? l.candidata!.colaborador_id : null,
      percentual: pcts[k],
      valor: centavos(l.valor!) / 100,
      ordem: k,
    }));
  }, [incluidas, integrantes, empresaId, fornecedorId]);
  const semContrato = incluidas.filter((l) => !l.candidata!.contrato_id);

  const pronto = !!classificacao && !!empresaId && fornecedoresProntos && integrantesProntos;
  const saidas = incluidas.map((l) => l.candidata!.data_saida).filter(Boolean).sort() as string[];
  const pagamentoLido = lote.relacao?.dataPagamento ?? incluidas.find((l) => l.pessoa.recibo?.pagamento)?.pessoa.recibo?.pagamento ?? null;
  const nomeInicial = nomeDespesaLote(incluidas.map((l) => l.candidata!.contrato_nome), lote.relacao?.filialNome);

  const aoSalvar = (payload: PayloadPainelDespesaMalote) => new Promise<void>((resolve) => setPendente({ payload, fim: resolve }));
  const desistir = () => { pendente?.fim(); setPendente(null); };

  const enviarDeVerdade = async () => {
    if (!pendente) return;
    setEnviando(true);
    const { arquivosNovos, ...despesa } = pendente.payload;
    const despesaId = crypto.randomUUID();
    const limpo = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ()]/g, "_");
    const pathRecibo = `lote/${crypto.randomUUID()}/${limpo}`;
    let reciboSubiu = false;
    let paths: string[] = [];
    try {
      const up = await supabase.storage.from(BUCKET_RECIBO_FERIAS).upload(pathRecibo, arquivo, { upsert: false, contentType: arquivo.type || undefined });
      if (up.error) throw up.error;
      reciboSubiu = true;
      paths = await uploadAnexosMalote(arquivosNovos, despesaId, despesa.nome);
      const { error } = await db.rpc("ferias_lote_enviar_malote", {
        p_itens: incluidas.map((l) => ({
          id: l.candidata!.id,
          valor: l.valor,
          origem: l.automatico ? "leitura" : "digitado",
          leitura: {
            origem: "lote", provas: l.pessoa.conferencia.provas, problemas: l.pessoa.conferencia.problemas,
            avisos: l.casamento.avisos, valor_relacao: l.pessoa.valorRelacao, pagina_recibo: l.pessoa.paginaRecibo,
            liquido: l.pessoa.recibo?.liquido ?? null, cpf: l.pessoa.cpf, cadastro: l.pessoa.cadastro, nome: l.pessoa.nome,
            periodo_inicio: l.pessoa.recibo?.periodoInicio ?? null, periodo_fim: l.pessoa.recibo?.periodoFim ?? null,
            pagamento: l.pessoa.recibo?.pagamento ?? lote.relacao?.dataPagamento ?? null,
          },
        })),
        p_recibo_path: pathRecibo,
        p_recibo_nome: arquivo.name,
        p_despesa_id: despesaId,
        p_despesa: { ...despesa, arquivos: paths },
      });
      if (error) throw error;
      const { data: info } = await db.rpc("ferias_malote_info", { p_ids: [incluidas[0].candidata!.id] });
      const numero = (info as { numero: string | null }[] | null)?.[0]?.numero ?? null;
      toast.success(`Despesa ${numero ?? ""} criada no Malote com ${incluidas.length} férias — entrou na fila de aprovação.`);
      pendente.fim();
      setPendente(null);
      onEnviado(numero);
    } catch (e) {
      if (paths.length) await supabase.storage.from("malote-anexos").remove(paths).catch(() => undefined);
      if (reciboSubiu) await supabase.storage.from(BUCKET_RECIBO_FERIAS).remove([pathRecibo]).catch(() => undefined);
      toast.error("Não foi enviado: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <span><b>{incluidas.length}</b> férias confirmadas · total <b>R$ {fmtReais(total)}</b> · arquivo {arquivo.name}</span>
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onVoltar} disabled={!!pendente}>Voltar à conferência</Button>
      </div>

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
          <p className="text-[11px] text-muted-foreground">Sugerida pela empresa dos colaboradores na Senior.</p>
        </div>
      </div>
      {empresasDasPessoas.length > 1 && (
        <p className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> O lote tem colaboradores de mais de uma empresa — confira a empresa de cada linha do rateio.</p>
      )}
      {semContrato.length > 0 && (
        <p className="text-xs text-amber-800">Sem contrato achado pela filial: {semContrato.map((l) => l.candidata!.nome).join(", ")} — escolha no rateio abaixo.</p>
      )}
      {!fornecedorId && fornecedoresProntos && (
        <p className="text-xs text-amber-800">O fornecedor "0 - Dispensa 1" não apareceu na lista — escolha o fornecedor em cada linha do rateio.</p>
      )}

      {pendente && (
        <Confirmacao titulo="Confirmar o envio ao Malote" rotulo="Enviar ao Malote" ocupado={enviando}
          onConfirmar={enviarDeVerdade} onVoltar={desistir}>
          <p>Criar a despesa <b>{pendente.payload.nome}</b> de <b>R$ {fmtReais(Number(pendente.payload.valor_total))}</b> no Malote, com {pendente.payload.rateio.length} linha(s) de rateio?</p>
          <p>Pagamento em {fmtData(pendente.payload.data_pagamento)} · {pendente.payload.forma_pagamento} · competência {pendente.payload.competencia?.slice(0, 7).split("-").reverse().join("/")}.</p>
          <p>As {incluidas.length} solicitações ficam com o arquivo anexado, o valor confirmado e a data do malote de hoje.</p>
        </Confirmacao>
      )}

      {!pronto ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          {!fornecedoresProntos || !integrantesProntos
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
            valorInicial={total}
            inicial={{
              competencia: saidas[0]?.slice(0, 7),
              dataPagamento: pagamentoLido && pagamentoLido >= hojeIso() ? pagamentoLido : undefined,
              formaPagamento: "Banco Mentore",
            }}
            rateioInicial={rateioInicial}
            arquivosIniciais={[arquivo]}
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
    </div>
  );
}
