// Jurídico / Patrimônio — aba "Parcelas" do drawer, reformulada no
// SIS-2026-0909 (16/11/2026) a partir do mock da Diretoria Administrativa
// ("Financiamento com nova seção de INCC", exemplo CASA DO SENILTON):
//
//   filtros (competência + situação) → 3 cartões (pago, amortização, saldo
//   com data) → faixa (juros, seguros e taxas, correção) → identificação
//   (credor, sistema, indexador, prazo) → Condições do financiamento →
//   Correção por INCC → evolução do saldo no período → tabela de parcelas,
//   cada uma com "Detalhar" (composição completa, pagamentos, evolução do
//   saldo, FGTS/FGHAB, pagador, comprovante e demonstrativo).
//
// A conta está toda em ./financiamento.ts (testada). Aqui é só desenho,
// formulário e gravação. O visual segue o resto de Patrimonios.tsx (classes
// jp-*, estilos inline) — o chamado pediu para manter o layout do ERP.
//
// Campo vazio NUNCA vira zero: "Não informado" / "A confirmar" / "A apurar"
// conforme o campo (pedido explícito do chamado).

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  numeroOuNulo, resolverParcelas, saldoDeReferencia, evolucaoDoSaldo,
  opcoesDePeriodo, rotuloPeriodo, rotuloIndice, corDaSituacao, SITUACOES, historicoIncc, calcularIncc,
  APLICACOES_INCC, MODALIDADES_INCC, BASES_INCC, rotuloAplicacaoIncc, lerImportacao, planejarImportacao,
  csvDasParcelas, detalheReconhecido, rotuloParcela, CAMPOS_COMPONENTES, recortesDaAba, parcelaParaEdicao,
  pagamentosSemComprovante, tipoDoIndice, permissoesDaAba,
  type ParcelaFinanciamento, type PagamentoParcela, type LinhaResolvida, type Situacao, type EvolucaoSaldo,
} from "./financiamento";

/**
 * O que o usuário pode fazer na aba, pela mesma régua da RLS: os dois
 * códigos de menu da tela ('patrimonios' e 'juridico_patrimonios') e a ação.
 * Revisão de 16/11: a UI mostrava editar/excluir para quem só visualiza.
 */
function usePermissoesDaAba() {
  const i1 = useScreenAccess("patrimonios", "incluir").data, i2 = useScreenAccess("juridico_patrimonios", "incluir").data;
  const a1 = useScreenAccess("patrimonios", "alterar").data, a2 = useScreenAccess("juridico_patrimonios", "alterar").data;
  const e1 = useScreenAccess("patrimonios", "excluir").data, e2 = useScreenAccess("juridico_patrimonios", "excluir").data;
  return permissoesDaAba({ incluir: !!(i1 || i2), alterar: !!(a1 || a2), excluir: !!(e1 || e2) });
}

// ── Tipos das tabelas ────────────────────────────────────────────────────
export interface Financiamento {
  id: number; patrimonio_id: number; nome?: string | null; credor?: string | null;
  sistema_amortizacao?: string | null; indexador?: string | null; prazo_meses?: number | null;
  taxa_juros_nominal_aa?: number | null; taxa_juros_efetiva_aa?: number | null; cet_aa?: number | null;
  data_referencia?: string | null; saldo_devedor_informado?: number | null; saldo_devedor_data?: string | null;
  cotas_fgts_contratadas?: number | null; parcelas_fgts_remanescentes?: number | null;
  fgts_nao_utilizado?: number | null; percentual_fgts_utilizado?: number | null;
  saldo_perda_renda_fghab?: number | null; produto_fonte_recursos?: string | null;
  pagador?: string | null; conta_bancaria?: string | null; documento_origem?: string | null; documento_data?: string | null;
  incc_aplicacao?: string | null; incc_modalidade?: string | null; incc_fase?: string | null;
  incc_base_tipo?: string | null; incc_base_descricao?: string | null; incc_periodicidade?: string | null;
  incc_defasagem_meses?: number | null; incc_vigencia_inicio?: string | null; incc_vigencia_fim?: string | null;
  observacoes?: string | null; atualizado_por?: string | null; updated_at?: string | null;
}
interface Pagamento extends PagamentoParcela {
  id: number; patrimonio_id: number; observacao?: string | null;
  comprovante_path?: string | null; comprovante_nome?: string | null; criado_por?: string | null;
}
interface AplicacaoInccLinha {
  id: number; financiamento_id: number; patrimonio_id: number; competencia: string; modalidade?: string | null;
  fonte?: string | null; taxa_indice_pct?: number | null; percentual_aplicado?: number | null; fator_aplicado?: number | null;
  base_tipo?: string | null; base_calculo?: number | null; valor_anterior?: number | null; valor_corrigido?: number | null;
  correcao?: number | null; observacao?: string | null; criado_por?: string | null; created_at?: string | null;
}
/** Parcela como vem do banco, já com a baixa das contas (ver baixaParcelas). */
export type ParcelaDaAba = ParcelaFinanciamento & {
  id: number; patrimonio_id: number; origem?: string | null; lancamento_financeiro?: string | null;
  documento_origem?: string | null; documento_data?: string | null; demonstrativo_path?: string | null;
  demonstrativo_nome?: string | null; atualizado_por?: string | null; updated_at?: string | null;
};

interface Props {
  db: SupabaseClient;
  patrimonioId: number;
  /** Parcelas do patrimônio, já com `baixa` (planilha / Malote / conta). */
  parcelas: ParcelaDaAba[];
  /** As MESMAS parcelas cruas, como estão no banco — para o formulário de edição. */
  brutas: ParcelaDaAba[];
  autor: string;
  toast: (msg: string, t?: string) => void;
  logHist: (acao: string, detalhe?: string) => Promise<void>;
  /** Recarrega as parcelas no pai depois de gravar. */
  recarregarParcelas: () => Promise<void>;
  /** Abre um arquivo do bucket juridico-docs. */
  abrirArquivo: (path: string) => void;
  /** Sobe para juridico-docs e devolve o path (ou null se falhou). */
  subirArquivo: (file: File, pasta: string) => Promise<string | null>;
}

// ── Formatação ───────────────────────────────────────────────────────────
const hoje = () => new Date().toISOString().slice(0, 10);
const fmtDt = (s?: string | null) => { if (!s) return null; const d = new Date(s.length <= 10 ? s + "T12:00:00" : s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const money = (v?: number | null) => v == null || isNaN(Number(v)) ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctAa = (v?: number | null) => v == null ? null : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}% a.a.`;
const pct = (v?: number | null) => v == null ? null : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
const int = (v?: number | null) => v == null ? null : String(v);
const sinal = (v: number | null, pos: string, neg: string) => v == null ? null : `${v >= 0 ? pos : neg} ${money(Math.abs(v))}`;
const mesAno = (s?: string | null) => { if (!s) return null; const [a, m] = s.slice(0, 7).split("-"); return `${m}/${a}`; };

/** Texto vazio: cada campo tem o seu ("Não informado", "A confirmar", "A apurar"). */
type Vazio = "Não informado" | "Não informada" | "A confirmar" | "A apurar" | "A informar" | "Nada pago";
const ou = (v: string | null | undefined, vazio: Vazio = "Não informado") => (v == null || v === "" ? vazio : v);

const COR = { azul: "#0f3171", verde: "#15803d", laranja: "#ea580c", cinza: "#64748b", claro: "#94a3b8", borda: "#e2e8f0", texto: "#0f172a" };
const caixa: CSSProperties = { background: "#fff", border: `1px solid ${COR.borda}`, borderRadius: 14, padding: "14px 18px", marginBottom: 12, boxShadow: "0 8px 24px rgba(15,23,42,.05)" };
const rotuloCampo: CSSProperties = { fontSize: 11.5, color: COR.cinza, marginBottom: 3 };
const valorCampo = (vazio: boolean): CSSProperties => ({ fontSize: 15, fontWeight: 800, color: vazio ? COR.claro : COR.texto, overflowWrap: "anywhere" });
const tituloCaixa: CSSProperties = { fontSize: 15, fontWeight: 800, color: COR.texto };

function Campo({ rotulo, valor, vazio = "Não informado", cor }: { rotulo: string; valor: string | null | undefined; vazio?: Vazio; cor?: string }) {
  const v = valor == null || valor === "";
  return (
    <div style={{ minWidth: 0 }}>
      <div style={rotuloCampo}>{rotulo}</div>
      <div style={{ ...valorCampo(v), ...(cor && !v ? { color: cor } : {}) }}>{v ? vazio : valor}</div>
    </div>
  );
}
const grade = (cols: number): CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${cols}px, 1fr))`, gap: "12px 16px" });

// ── Formulários ──────────────────────────────────────────────────────────
type FormTexto = Record<string, string>;
const paraForm = (o: Record<string, unknown> | null | undefined, campos: string[]): FormTexto =>
  Object.fromEntries(campos.map(c => [c, o?.[c] == null ? "" : String(o[c])]));
const CAMPOS_FIN_NUM = ["prazo_meses", "taxa_juros_nominal_aa", "taxa_juros_efetiva_aa", "cet_aa", "saldo_devedor_informado",
  "cotas_fgts_contratadas", "parcelas_fgts_remanescentes", "fgts_nao_utilizado", "percentual_fgts_utilizado", "saldo_perda_renda_fghab", "incc_defasagem_meses"];
const CAMPOS_FIN_DATA = ["data_referencia", "saldo_devedor_data", "documento_data", "incc_vigencia_inicio", "incc_vigencia_fim"];
const CAMPOS_FIN_TXT = ["nome", "credor", "sistema_amortizacao", "indexador", "produto_fonte_recursos", "pagador", "conta_bancaria",
  "documento_origem", "observacoes", "incc_aplicacao", "incc_modalidade", "incc_fase", "incc_base_tipo", "incc_base_descricao", "incc_periodicidade"];
const CAMPOS_FIN = [...CAMPOS_FIN_TXT, ...CAMPOS_FIN_NUM, ...CAMPOS_FIN_DATA];
const INTEIROS = new Set(["prazo_meses", "cotas_fgts_contratadas", "parcelas_fgts_remanescentes", "incc_defasagem_meses", "numero"]);

const CAMPOS_PARC_TXT = ["rotulo", "lancamento_financeiro", "documento_origem", "indice_tipo"];
const CAMPOS_PARC_DATA = ["vencimento", "data_pagamento", "documento_data"];
const CAMPOS_PARC_NUM = ["numero", "valor", "valor_pago", ...CAMPOS_COMPONENTES];
const CAMPOS_PARC = [...CAMPOS_PARC_TXT, ...CAMPOS_PARC_DATA, ...CAMPOS_PARC_NUM, "financiamento_id"];
const ROTULO_COMP: Record<string, string> = {
  amortizacao: "Amortização", juros: "Juros", seguro_mip: "MIP", seguro_dfi: "DFI", seguros_fghab: "Seguros / FGHAB",
  taxas: "Taxas", valor_fcvs: "Valor FCVS", fgts_utilizado: "FGTS utilizado", encargo_liquido: "Encargo líquido",
  valor_impontualidade: "Valores da impontualidade", multa_atraso: "Multa por atraso", juros_atraso: "Juros por atraso",
  diferenca_valor: "Diferença de valor", atualizacao_monetaria: "Atualização monetária", outros_movimentos: "Outros movimentos do saldo",
  saldo_anterior: "Saldo anterior", saldo_devedor: "Saldo devedor (após a parcela)", indice_correcao: "Índice de correção",
};

/** Texto do formulário → payload: "" vira null (não informado), número em pt-BR. */
function deForm(f: FormTexto, num: string[], datas: string[], txt: string[]): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const c of txt) out[c] = f[c]?.trim() ? f[c].trim() : null;
  for (const c of datas) out[c] = f[c] || null;
  for (const c of num) { const n = numeroOuNulo(f[c]); out[c] = n == null ? null : INTEIROS.has(c) ? Math.trunc(n) : n; }
  return out;
}

export function AbaFinanciamento({ db, patrimonioId, parcelas, brutas, autor, toast, logHist, recarregarParcelas, abrirArquivo, subirArquivo }: Props) {
  const pode = usePermissoesDaAba();
  const [fins, setFins] = useState<Financiamento[]>([]);
  const [finSel, setFinSel] = useState<number | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [incc, setIncc] = useState<AplicacaoInccLinha[]>([]);
  const [periodo, setPeriodo] = useState<string | null>(null);   // null = ainda não escolheu (usa o padrão)
  const [fSituacao, setFSituacao] = useState<"" | Situacao>("");
  const [aberta, setAberta] = useState<number | null>(null);
  const [verTodas, setVerTodas] = useState(false);

  const [modalFin, setModalFin] = useState<null | { id: number | null; foco: "condicoes" | "incc" }>(null);
  const [formFin, setFormFin] = useState<FormTexto>({});
  const [formApl, setFormApl] = useState<FormTexto>({});
  const [modalParc, setModalParc] = useState<null | { id: number | null }>(null);
  const [formParc, setFormParc] = useState<FormTexto>({});
  const [flagsParc, setFlagsParc] = useState({ encargos_inclusos: true, seguros_fghab_subtotal: true, projetado: false });
  const [modalPag, setModalPag] = useState<null | { parcela: ParcelaDaAba }>(null);
  const [formPag, setFormPag] = useState<FormTexto>({});
  const [arqPag, setArqPag] = useState<File | null>(null);
  const [modalImp, setModalImp] = useState(false);
  const [textoImp, setTextoImp] = useState("");
  const [impProjetado, setImpProjetado] = useState(false);
  const [gravando, setGravando] = useState(false);

  // ── Carga ─────────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    const [f, pg, ic] = await Promise.all([
      db.from("JUR_PATRIMONIO_FINANCIAMENTOS").select("*").eq("patrimonio_id", patrimonioId).order("id"),
      db.from("JUR_PATRIMONIO_PARCELA_PAGAMENTOS").select("*").eq("patrimonio_id", patrimonioId).order("data_pagamento").limit(5000),
      db.from("JUR_PATRIMONIO_INCC_APLICACOES").select("*").eq("patrimonio_id", patrimonioId).order("competencia").limit(2000),
    ]);
    if (f.error) console.warn("financiamentos:", f.error.message);
    setFins((f.data ?? []) as Financiamento[]);
    setPagamentos((pg.data ?? []) as Pagamento[]);
    setIncc((ic.data ?? []) as AplicacaoInccLinha[]);
    setFinSel(atual => atual ?? ((f.data ?? [])[0]?.id ?? null));
  }, [db, patrimonioId]);
  useEffect(() => { carregar(); }, [carregar]);

  const fin = fins.find(f => f.id === finSel) ?? fins[0] ?? null;
  // Mais de um contrato no imóvel: cada parcela é do seu; as sem vínculo
  // (importadas antes deste chamado) ficam com o primeiro.
  const doContrato = useMemo(() => {
    if (fins.length <= 1 || !fin) return parcelas;
    return parcelas.filter(p => p.financiamento_id != null ? Number(p.financiamento_id) === fin.id : fin.id === fins[0].id);
  }, [parcelas, fins, fin]);

  const resolvidas = useMemo(() => resolverParcelas(doContrato, pagamentos, hoje()), [doContrato, pagamentos]);
  const opcoesPeriodo = useMemo(() => opcoesDePeriodo(doContrato), [doContrato]);
  // Abre no mês da última parcela paga (a informação mais recente); sem
  // nenhuma paga, no contrato inteiro.
  const periodoPadrao = useMemo(() => {
    const pagas = resolvidas.filter(l => l.pago != null && l.pago > 0 && l.p.vencimento).map(l => String(l.p.vencimento));
    return pagas.length ? pagas.sort().pop()!.slice(0, 7) : "";
  }, [resolvidas]);
  const per = periodo ?? periodoPadrao;
  // Tabela = período + situação; resumo e evolução = só o período (ver
  // recortesDaAba). O saldo nunca passa de hoje (saldoDeReferencia).
  const { filtradas, resumo, evolucao: evolPeriodo } = recortesDaAba(resolvidas, per, fSituacao, hoje());
  const saldo = saldoDeReferencia(doContrato, per, fin, hoje());
  const aplicacoes = historicoIncc(incc.filter(a => !fin || a.financiamento_id === fin.id));
  const LIMITE = 120;
  const visiveis = verTodas ? filtradas : filtradas.slice(0, LIMITE);

  // ── Gravação: financiamento ──────────────────────────────────────────
  const abrirFin = (foco: "condicoes" | "incc", novo = false) => {
    const base = novo ? null : fin;
    setFormFin({ ...paraForm(base as unknown as Record<string, unknown>, CAMPOS_FIN), incc_aplicacao: base?.incc_aplicacao ?? "a_confirmar" });
    setFormApl({ competencia: "", modalidade: base?.incc_modalidade ?? "", fonte: "", taxa_indice_pct: "", percentual_aplicado: "", fator_aplicado: "", base_tipo: base?.incc_base_tipo ?? "saldo", base_calculo: "", valor_anterior: "", valor_corrigido: "", correcao: "", observacao: "" });
    setModalFin({ id: base?.id ?? null, foco });
  };
  const salvarFin = async () => {
    if (!modalFin) return;
    const payload: Record<string, string | number | null> = { ...deForm(formFin, CAMPOS_FIN_NUM, CAMPOS_FIN_DATA, CAMPOS_FIN_TXT), incc_aplicacao: formFin.incc_aplicacao || "a_confirmar", atualizado_por: autor };
    setGravando(true);
    let id = modalFin.id;
    if (id) {
      const { error } = await db.from("JUR_PATRIMONIO_FINANCIAMENTOS").update(payload).eq("id", id);
      if (error) { setGravando(false); toast("Erro: " + error.message, "err"); return; }
    } else {
      const { data, error } = await db.from("JUR_PATRIMONIO_FINANCIAMENTOS").insert({ ...payload, patrimonio_id: patrimonioId, criado_por: autor }).select("id").single();
      if (error) { setGravando(false); toast("Erro: " + error.message, "err"); return; }
      id = data.id as number;
      setFinSel(id);
    }
    await logHist(modalFin.foco === "incc" ? "Regra do INCC atualizada" : modalFin.id ? "Condições do financiamento atualizadas" : "Financiamento cadastrado",
      [payload.credor, payload.sistema_amortizacao, payload.indexador, modalFin.foco === "incc" ? rotuloAplicacaoIncc(String(payload.incc_aplicacao)) : null].filter(Boolean).join(" · "));
    setGravando(false); setModalFin(null); toast("Financiamento salvo.", "ok"); carregar();
  };
  const calcApl = calcularIncc(numeroOuNulo(formApl.base_calculo) ?? numeroOuNulo(formApl.valor_anterior), { fator: numeroOuNulo(formApl.fator_aplicado), percentual: numeroOuNulo(formApl.percentual_aplicado) ?? numeroOuNulo(formApl.taxa_indice_pct) });
  const adicionarAplicacao = async () => {
    if (!modalFin?.id) { toast("Salve a regra antes de lançar aplicações.", "err"); return; }
    const comp = formApl.competencia; // AAAA-MM do <input type=month>
    if (!/^\d{4}-\d{2}$/.test(comp)) { toast("Informe a competência do índice (mês/ano).", "err"); return; }
    const num = (c: string) => numeroOuNulo(formApl[c]);
    const correcao = num("correcao") ?? (num("valor_anterior") != null && num("valor_corrigido") != null ? Math.round((num("valor_corrigido")! - num("valor_anterior")!) * 100) / 100 : calcApl?.correcao ?? null);
    const linha = {
      financiamento_id: modalFin.id, patrimonio_id: patrimonioId, competencia: `${comp}-01`,
      modalidade: formApl.modalidade || null, fonte: formApl.fonte?.trim() || null,
      taxa_indice_pct: num("taxa_indice_pct"), percentual_aplicado: num("percentual_aplicado"), fator_aplicado: num("fator_aplicado"),
      base_tipo: formApl.base_tipo || null, base_calculo: num("base_calculo"),
      valor_anterior: num("valor_anterior") ?? num("base_calculo"),
      valor_corrigido: num("valor_corrigido") ?? calcApl?.corrigido ?? null,
      correcao, observacao: formApl.observacao?.trim() || null, criado_por: autor,
    };
    const { error } = await db.from("JUR_PATRIMONIO_INCC_APLICACOES").insert(linha);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    await logHist("Aplicação do INCC lançada", `${mesAno(linha.competencia)} · ${linha.modalidade ?? "INCC"} · correção ${money(correcao) ?? "a apurar"}`);
    setFormApl(f => ({ ...f, competencia: "", taxa_indice_pct: "", percentual_aplicado: "", fator_aplicado: "", base_calculo: "", valor_anterior: "", valor_corrigido: "", correcao: "", observacao: "" }));
    toast("Aplicação lançada.", "ok"); carregar();
  };
  const excluirAplicacao = async (a: AplicacaoInccLinha) => {
    if (!confirm(`Excluir a aplicação do INCC de ${mesAno(a.competencia)}?`)) return;
    const { error } = await db.from("JUR_PATRIMONIO_INCC_APLICACOES").delete().eq("id", a.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    await logHist("Aplicação do INCC excluída", `${mesAno(a.competencia)} · correção ${money(a.correcao) ?? "—"}`);
    carregar();
  };

  // ── Gravação: parcela ────────────────────────────────────────────────
  const abrirParc = (comBaixa: ParcelaDaAba | null) => {
    // A linha CRUA do banco: a que a tabela desenha traz o valor_pago da conta
    // paga no Malote, e salvar o formulário gravaria esse valor (revisão 16/11).
    const p = comBaixa ? parcelaParaEdicao(comBaixa.id, brutas) ?? comBaixa : null;
    setFormParc({ ...paraForm(p as unknown as Record<string, unknown>, CAMPOS_PARC), financiamento_id: p?.financiamento_id != null ? String(p.financiamento_id) : fin ? String(fin.id) : "" });
    setFlagsParc({ encargos_inclusos: p?.encargos_inclusos !== false, seguros_fghab_subtotal: p?.seguros_fghab_subtotal !== false, projetado: !!p?.projetado });
    setModalParc({ id: p?.id ?? null });
  };
  const salvarParc = async () => {
    if (!modalParc) return;
    if (!formParc.vencimento && !formParc.numero && !formParc.rotulo) { toast("Informe ao menos o número ou o vencimento da parcela.", "err"); return; }
    const payload: Record<string, unknown> = {
      ...deForm(formParc, CAMPOS_PARC_NUM, CAMPOS_PARC_DATA, CAMPOS_PARC_TXT),
      ...flagsParc,
      financiamento_id: formParc.financiamento_id ? Number(formParc.financiamento_id) : null,
      atualizado_por: autor,
    };
    if (payload.indice_correcao == null) payload.indice_tipo = null;
    else if (!payload.indice_tipo) payload.indice_tipo = tipoDoIndice(Number(payload.indice_correcao), formParc.indice_correcao);
    setGravando(true);
    const rot = rotuloParcela({ numero: payload.numero as number | null, rotulo: payload.rotulo as string | null });
    if (modalParc.id) {
      const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").update(payload).eq("id", modalParc.id);
      if (error) { setGravando(false); toast("Erro: " + error.message, "err"); return; }
      await logHist("Composição da parcela atualizada", `${rot} · venc. ${fmtDt(payload.vencimento as string) ?? "—"}`);
    } else {
      const ordem = Math.max(0, ...parcelas.map(p => Number(p.ordem ?? 0))) + 1;
      const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").insert({ ...payload, patrimonio_id: patrimonioId, ordem, origem: "Cadastro manual" });
      if (error) { setGravando(false); toast("Erro: " + error.message, "err"); return; }
      await logHist("Parcela do financiamento cadastrada", `${rot} · venc. ${fmtDt(payload.vencimento as string) ?? "—"} · ${money(payload.valor as number) ?? "—"}`);
    }
    setGravando(false); setModalParc(null); toast("Parcela salva.", "ok"); await recarregarParcelas();
  };
  const excluirParc = async (p: ParcelaDaAba) => {
    // A FK dos pagamentos não cascateia mais (revisão de 16/11): parcela com
    // pagamento registrado só sai depois de excluir os pagamentos.
    if (pagamentos.some(x => String(x.parcela_id) === String(p.id))) { toast("Esta parcela tem pagamentos registrados — exclua os pagamentos antes.", "err"); return; }
    if (!confirm(`Excluir a parcela ${rotuloParcela(p)} (${fmtDt(p.vencimento) ?? "sem vencimento"})?`)) return;
    const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").delete().eq("id", p.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    await logHist("Parcela do financiamento excluída", `${rotuloParcela(p)} · ${money(numeroOuNulo(p.valor)) ?? "—"}`);
    setModalParc(null); setAberta(null); toast("Parcela excluída.", "ok"); await recarregarParcelas(); carregar();
  };
  const anexarDemonstrativo = async (p: ParcelaDaAba, file: File) => {
    const path = await subirArquivo(file, `${patrimonioId}/financiamento/demonstrativos`);
    if (!path) return;
    const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").update({ demonstrativo_path: path, demonstrativo_nome: file.name, atualizado_por: autor }).eq("id", p.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    // Também na aba Documentos do imóvel, para achar sem abrir a parcela.
    await db.from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: patrimonioId, kind: "documento", tipo: `Demonstrativo — parcela ${rotuloParcela(p)}`, nome: file.name, storage_path: path, criado_por: autor });
    await logHist("Demonstrativo anexado", `${rotuloParcela(p)} · ${file.name}`);
    toast("Demonstrativo anexado.", "ok"); await recarregarParcelas();
  };

  // ── Gravação: pagamento ──────────────────────────────────────────────
  // `anexar` = veio do "Anexar comprovante": abre já apontando para o último
  // pagamento SEM comprovante (revisão de 16/11 — antes sempre criava um
  // pagamento novo, duplicando o valor pago).
  const abrirPag = (p: ParcelaDaAba, anexar = false) => {
    const daParcela = pagamentos.filter(x => String(x.parcela_id) === String(p.id));
    const ja = daParcela.reduce((s, x) => s + (numeroOuNulo(x.valor) ?? 0), 0);
    const falta = Math.max(0, (numeroOuNulo(p.valor) ?? 0) - ja);
    const semComp = pagamentosSemComprovante(daParcela);
    const alvo = anexar && semComp.length ? String(semComp[semComp.length - 1].id) : "";
    setFormPag({ pagamento_id: alvo, data_pagamento: hoje(), valor: falta ? String(falta.toFixed(2)).replace(".", ",") : "", observacao: "" });
    setArqPag(null);
    setModalPag({ parcela: p });
  };
  const salvarPag = async () => {
    if (!modalPag) return;
    const p = modalPag.parcela;
    // Anexar a um pagamento que já existe: só sobe o arquivo e liga.
    if (formPag.pagamento_id) {
      if (!arqPag) { toast("Escolha o arquivo do comprovante.", "err"); return; }
      setGravando(true);
      const path = await subirArquivo(arqPag, `${patrimonioId}/financiamento/comprovantes`);
      if (!path) { setGravando(false); return; }
      const { error } = await db.from("JUR_PATRIMONIO_PARCELA_PAGAMENTOS").update({ comprovante_path: path, comprovante_nome: arqPag.name }).eq("id", Number(formPag.pagamento_id));
      if (error) { setGravando(false); toast("Erro: " + error.message, "err"); return; }
      await db.from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: patrimonioId, kind: "documento", tipo: `Comprovante — parcela ${rotuloParcela(p)}`, nome: arqPag.name, storage_path: path, criado_por: autor });
      await logHist("Comprovante anexado ao pagamento", `${rotuloParcela(p)} · ${arqPag.name}`);
      setGravando(false); setModalPag(null); toast("Comprovante anexado.", "ok"); carregar();
      return;
    }
    const valor = numeroOuNulo(formPag.valor);
    if (!formPag.data_pagamento || valor == null) { toast("Informe a data e o valor pago.", "err"); return; }
    setGravando(true);
    let path: string | null = null;
    if (arqPag) { path = await subirArquivo(arqPag, `${patrimonioId}/financiamento/comprovantes`); if (!path) { setGravando(false); return; } }
    const { error } = await db.from("JUR_PATRIMONIO_PARCELA_PAGAMENTOS").insert({
      parcela_id: p.id, patrimonio_id: patrimonioId, data_pagamento: formPag.data_pagamento, valor,
      observacao: formPag.observacao?.trim() || null, comprovante_path: path, comprovante_nome: arqPag?.name ?? null, criado_por: autor,
    });
    if (error) { setGravando(false); toast("Erro: " + error.message, "err"); return; }
    if (path && arqPag) await db.from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: patrimonioId, kind: "documento", tipo: `Comprovante — parcela ${rotuloParcela(p)}`, nome: arqPag.name, storage_path: path, criado_por: autor });
    await logHist("Pagamento de parcela registrado", `${rotuloParcela(p)} · ${money(valor)} em ${fmtDt(formPag.data_pagamento)}${arqPag ? " · com comprovante" : ""}`);
    setGravando(false); setModalPag(null); toast("Pagamento registrado.", "ok"); carregar();
  };
  const excluirPag = async (pg: Pagamento, p: ParcelaDaAba) => {
    if (!confirm(`Excluir o pagamento de ${money(numeroOuNulo(pg.valor))} em ${fmtDt(pg.data_pagamento)}?`)) return;
    const { error } = await db.from("JUR_PATRIMONIO_PARCELA_PAGAMENTOS").delete().eq("id", pg.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    await logHist("Pagamento de parcela excluído", `${rotuloParcela(p)} · ${money(numeroOuNulo(pg.valor))} em ${fmtDt(pg.data_pagamento)}`);
    carregar();
  };

  // ── Importação ───────────────────────────────────────────────────────
  const leitura = useMemo(() => (textoImp.trim() ? lerImportacao(textoImp) : null), [textoImp]);
  const plano = useMemo(() => (leitura?.linhas.length ? planejarImportacao(leitura.linhas, doContrato) : null), [leitura, doContrato]);
  const lerArquivoImp = async (file: File) => {
    if (/\.xlsx?$/i.test(file.name)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      setTextoImp(XLSX.utils.sheet_to_csv(ws, { FS: "\t", dateNF: "dd/mm/yyyy" }));
    } else setTextoImp(await file.text());
  };
  const importar = async () => {
    if (!plano) return;
    setGravando(true);
    const extra = { atualizado_por: autor, ...(impProjetado ? { projetado: true } : {}) };
    let ok = 0; const falhas: string[] = [];
    // Uma por vez em lotes pequenos: cada linha tem o seu conjunto de colunas
    // e coluna que não veio NÃO pode ser apagada.
    for (let i = 0; i < plano.atualizar.length; i += 15) {
      const lote = plano.atualizar.slice(i, i + 15);
      const rs = await Promise.all(lote.map(a => db.from("JUR_PATRIMONIO_PARCELAS").update({ ...a.dados, ...extra }).eq("id", a.id)));
      rs.forEach((r, k) => r.error ? falhas.push(`${lote[k].dados.numero ?? lote[k].dados.vencimento}: ${r.error.message}`) : ok++);
    }
    if (plano.inserir.length) {
      // PostgREST exige as mesmas chaves em todas as linhas do lote.
      const chaves = [...new Set(plano.inserir.flatMap(l => Object.keys(l)))];
      let ordem = Math.max(0, ...parcelas.map(p => Number(p.ordem ?? 0)));
      const linhas = plano.inserir.map(l => ({
        ...Object.fromEntries(chaves.map(c => [c, l[c] ?? null])), ...extra,
        patrimonio_id: patrimonioId, financiamento_id: fin?.id ?? null, ordem: ++ordem, origem: "Importação",
      }));
      const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").insert(linhas);
      if (error) falhas.push("novas parcelas: " + error.message); else ok += linhas.length;
    }
    await logHist("Composição das parcelas importada", `${plano.atualizar.length} atualizada(s), ${plano.inserir.length} nova(s)${impProjetado ? " · projetadas" : ""}${falhas.length ? ` · ${falhas.length} falha(s)` : ""}`);
    setGravando(false);
    if (falhas.length) toast(`Importadas ${ok}; ${falhas.length} com erro: ${falhas[0]}`, "err");
    else { toast(`${ok} parcela(s) importada(s).`, "ok"); setModalImp(false); setTextoImp(""); }
    await recarregarParcelas();
  };

  const exportarCsv = () => {
    const blob = new Blob(["﻿" + csvDasParcelas(filtradas)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `parcelas-${patrimonioId}${per ? "-" + per : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ── Desenho ──────────────────────────────────────────────────────────
  const btn = (bg: string, cor: string, borda = bg): CSSProperties => ({ background: bg, color: cor, border: `1px solid ${borda}` });
  const cartao = (rotulo: string, valor: string | null, cor: string, apoio: string, vazio: Vazio = "A apurar") => (
    <div style={{ ...caixa, marginBottom: 0, flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: COR.claro, textTransform: "uppercase", letterSpacing: ".5px" }}>{rotulo}</div>
      <div style={{ fontSize: valor && valor.length > 15 ? 21 : 25, fontWeight: 800, color: valor ? cor : COR.claro, marginTop: 4 }}>{valor ?? vazio}</div>
      <div style={{ fontSize: 11.5, color: COR.claro, marginTop: 2 }}>{apoio}</div>
    </div>
  );
  const blocoEvolucao = (e: EvolucaoSaldo | null, tituloSaldo: string) => e && (
    <div>
      <div style={grade(140)}>
        <Campo rotulo="Saldo anterior" valor={money(e.saldoAnterior)} vazio="A apurar" />
        <Campo rotulo="Atualização monetária" valor={sinal(e.atualizacao, "+", "−")} vazio="A apurar" />
        <Campo rotulo="Amortização" valor={e.amortizacao == null ? null : `− ${money(e.amortizacao)}`} vazio="A apurar" />
        {e.outros != null && <Campo rotulo="Outros movimentos" valor={sinal(e.outros, "+", "−")} />}
        <div><div style={{ ...rotuloCampo, color: COR.azul }}>{tituloSaldo}</div><div style={{ ...valorCampo(e.saldoApos == null), color: e.saldoApos == null ? COR.claro : COR.laranja }}>{money(e.saldoApos) ?? "A apurar"}</div></div>
      </div>
      {e.variacao != null && (
        <div style={{ marginTop: 12, background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, color: "#1e3a8a" }}>
          <b>{e.variacao <= 0 ? "Redução líquida" : "Aumento líquido"} da dívida no período: {money(Math.abs(e.variacao))}.</b>
          <div style={{ color: "#475569", marginTop: 2 }}>A correção atualiza o saldo e não deve ser somada novamente ao pagamento.</div>
        </div>
      )}
      {e.divergencia != null && (
        <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "7px 12px", fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>
          O saldo informado difere em {money(e.divergencia)} da conta saldo anterior + atualização − amortização. Conferir com o demonstrativo.
        </div>
      )}
    </div>
  );

  const detalhe = (l: LinhaResolvida) => {
    const p = l.p as ParcelaDaAba;
    const c = l.comp;
    const e = evolucaoDoSaldo([p], doContrato);
    const outros = Object.entries(p.detalhes ?? {}).filter(([k, v]) => !detalheReconhecido(k) && v != null && v !== "");
    const m = (v: number | null) => money(v);
    return (
      <div style={{ background: "#f8fafc", borderTop: `1px solid ${COR.borda}`, padding: 14 }}>
        <div style={caixa}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={tituloCaixa}>Detalhamento completo da {rotuloParcela(p)} parcela</div>
            <button className="jp-btn" onClick={() => setAberta(null)} style={{ background: "none", color: COR.azul, textDecoration: "underline", padding: 0 }}>Recolher</button>
          </div>
          <div style={{ fontSize: 12.5, color: COR.cinza, margin: "4px 0 12px" }}>
            Vencimento: {fmtDt(p.vencimento) ?? "não informado"} · Pagamento: {fmtDt(l.dataPagamento) ?? "não informado"}
            {p.projetado && <span style={{ marginLeft: 8, fontWeight: 800, color: "#475569", background: "#f1f5f9", borderRadius: 20, padding: "1px 8px", fontSize: 10.5 }}>VALORES PROJETADOS</span>}
            {c.daPlanilha && <span title="Parte da composição veio das colunas da planilha ATIVO IMOBILIZADO" style={{ marginLeft: 8, fontWeight: 800, color: "#92400e", background: "#fef3c7", borderRadius: 20, padding: "1px 8px", fontSize: 10.5 }}>DA PLANILHA</span>}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: COR.claro, textTransform: "uppercase", margin: "4px 0 6px" }}>Amortização, juros, seguros e taxas</div>
          <div style={grade(130)}>
            <Campo rotulo="Amortização" valor={m(c.amortizacao)} vazio="A apurar" />
            <Campo rotulo="Juros" valor={m(c.juros)} vazio="A apurar" />
            <Campo rotulo="MIP" valor={m(c.seguro_mip)} />
            <Campo rotulo="DFI" valor={m(c.seguro_dfi)} />
            <Campo rotulo={`Seguros / FGHAB${p.seguros_fghab_subtotal !== false ? " — subtotal" : ""}`} valor={m(c.seguros_fghab)} />
            <Campo rotulo="Taxas" valor={m(c.taxas)} />
            <Campo rotulo="Valor FCVS" valor={m(c.valor_fcvs)} />
            <Campo rotulo="FGTS utilizado" valor={m(c.fgts_utilizado)} />
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: COR.claro, textTransform: "uppercase", margin: "14px 0 6px" }}>Cobrança e pagamento</div>
          <div style={grade(130)}>
            <Campo rotulo="Encargo líquido" valor={m(c.encargo_liquido)} />
            <Campo rotulo="Valores da impontualidade" valor={m(c.valor_impontualidade)} />
            {c.multa_atraso != null && <Campo rotulo="Multa por atraso" valor={m(c.multa_atraso)} />}
            {c.juros_atraso != null && <Campo rotulo="Juros por atraso" valor={m(c.juros_atraso)} />}
            <Campo rotulo="Valor devido" valor={m(numeroOuNulo(p.valor))} />
            <Campo rotulo="Valor pago" valor={m(l.pago)} vazio="A informar" />
            <Campo rotulo="Diferença de valor" valor={c.diferenca_valor == null ? null : `${c.diferenca_valor > 0 ? "+ " : c.diferenca_valor < 0 ? "− " : ""}${m(Math.abs(c.diferenca_valor))}`}
              cor={c.diferenca_valor ? "#6d28d9" : undefined} />
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: COR.claro, textTransform: "uppercase", margin: "14px 0 6px" }}>Atualização da dívida</div>
          <div style={grade(130)}>
            <Campo rotulo="Atualização monetária" valor={m(c.atualizacao_monetaria)} vazio="A apurar" />
            <Campo rotulo="Saldo devedor" valor={m(c.saldo_devedor)} vazio="A apurar" />
            <Campo rotulo={`Índice de correção${c.indice_tipo ? ` — ${c.indice_tipo}` : ""}`} valor={rotuloIndice(c.indice_correcao, c.indice_tipo)} />
          </div>
          <div style={{ fontSize: 11.5, color: COR.cinza, marginTop: 12, lineHeight: 1.5 }}>
            {p.seguros_fghab_subtotal !== false ? "Seguros / FGHAB é o subtotal de MIP e DFI — não é somado de novo." : "Seguros / FGHAB é cobrado à parte de MIP e DFI."}
            {p.encargos_inclusos !== false && (c.seguros != null || c.taxas != null) && " Seguros e taxas já estão incluídos no valor devido."}
            {c.diferenca_valor ? " A diferença de valor fica sujeita à conciliação." : ""}
          </div>
          {outros.length > 0 && (
            <div style={{ fontSize: 11.5, color: COR.cinza, marginTop: 8 }}>
              Outras colunas da planilha: {outros.map(([k, v]) => `${k}: ${typeof v === "number" ? v.toLocaleString("pt-BR") : String(v)}`).join(" · ")}
            </div>
          )}
        </div>

        {/* Pagamentos */}
        <div style={caixa}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={tituloCaixa}>Pagamentos desta parcela</div>
            {pode.registrarPagamento && <button className="jp-btn" onClick={() => abrirPag(p)} style={btn("#0f3171", "#fff")}>+ Registrar pagamento</button>}
          </div>
          {l.pagamentos.length === 0
            ? <div style={{ fontSize: 12.5, color: COR.claro }}>{p.baixa === "malote" ? "Paga pelo Malote (conta do contrato)." : p.baixa === "conta" ? "Baixa dada na conta do contrato (Contas / Obrigações)." : p.baixa === "planilha" ? "Paga conforme a planilha ATIVO IMOBILIZADO." : l.pago != null ? `Valor pago informado: ${money(l.pago)}.` : "Nenhum pagamento registrado."}</div>
            : (l.pagamentos as Pagamento[]).map(pg => (
              <div key={pg.id} style={{ display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid #f1f5f9", padding: "7px 0", fontSize: 12.5, flexWrap: "wrap" }}>
                <b style={{ minWidth: 90 }}>{fmtDt(pg.data_pagamento)}</b>
                <b style={{ minWidth: 110, color: COR.verde }}>{money(numeroOuNulo(pg.valor))}</b>
                <span style={{ color: COR.cinza, flex: 1 }}>{pg.observacao}{pg.criado_por ? ` · ${pg.criado_por}` : ""}</span>
                {pg.comprovante_path
                  ? <button className="jp-btn" onClick={() => abrirArquivo(pg.comprovante_path!)} style={btn("#eef4ff", COR.azul, "#dbe4f0")}>📎 Comprovante</button>
                  : pode.anexarComprovante && <button className="jp-btn" title="Anexar o comprovante a ESTE pagamento"
                      onClick={() => { abrirPag(p, true); setFormPag(f => ({ ...f, pagamento_id: String(pg.id) })); }} style={btn("#fff", COR.azul, "#cbd5e1")}>⬆ Anexar comprovante</button>}
                {pode.excluirPagamento && <button className="jp-btn" onClick={() => excluirPag(pg, p)} style={{ background: "none", color: "#dc2626", padding: "4px 6px" }}>Excluir</button>}
              </div>
            ))}
          {l.situacao === "PARCIAL" && <div style={{ fontSize: 12, color: "#a16207", fontWeight: 700, marginTop: 6 }}>Falta {money(Math.max(0, (numeroOuNulo(p.valor) ?? 0) - (l.pago ?? 0)))} para quitar a parcela.</div>}
          {l.situacao === "A CONFERIR" && <div style={{ fontSize: 12, color: "#6d28d9", fontWeight: 700, marginTop: 6 }}>Pagamento diferente do valor devido — conferir.</div>}
        </div>

        {e && <div style={caixa}><div style={{ ...tituloCaixa, marginBottom: 10 }}>Evolução do saldo devedor</div>{blocoEvolucao(e, "Saldo após a parcela")}</div>}

        <div style={caixa}>
          <div style={{ ...tituloCaixa, marginBottom: 10 }}>FGTS e FGHAB — dados do contrato</div>
          <div style={grade(170)}>
            <Campo rotulo="Cotas FGTS contratadas" valor={int(fin?.cotas_fgts_contratadas)} />
            <Campo rotulo="Parcelas FGTS remanescentes" valor={int(fin?.parcelas_fgts_remanescentes)} />
            <Campo rotulo="FGTS não utilizado" valor={money(fin?.fgts_nao_utilizado)} />
            <Campo rotulo="Percentual FGTS utilizado" valor={pct(fin?.percentual_fgts_utilizado)} />
            <Campo rotulo="Saldo perda de renda FGHAB" valor={money(fin?.saldo_perda_renda_fghab)} />
            <Campo rotulo="Produto / fonte de recursos" valor={fin?.produto_fonte_recursos} />
          </div>
          <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 12, paddingTop: 10, ...grade(200) }}>
            <Campo rotulo="Empresa/pessoa pagadora" valor={fin?.pagador} vazio="A informar" />
            <Campo rotulo="Conta bancária" valor={fin?.conta_bancaria} vazio="A informar" />
            <Campo rotulo="Lançamento financeiro vinculado" valor={p.lancamento_financeiro} vazio="A informar" />
            <Campo rotulo="Documento de origem" valor={[p.documento_origem ?? fin?.documento_origem, fmtDt(p.documento_data ?? fin?.documento_data)].filter(Boolean).join(" · ") || null} vazio="A informar" />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(pode.anexarComprovante || pode.registrarPagamento) && <button className="jp-btn" onClick={() => abrirPag(p, true)} style={btn("#fff", COR.azul, "#cbd5e1")}>⬆ Anexar comprovante</button>}
          {p.demonstrativo_path
            ? <button className="jp-btn" onClick={() => abrirArquivo(p.demonstrativo_path!)} style={btn("#fff", COR.azul, "#cbd5e1")}>📄 Ver demonstrativo</button>
            : pode.anexarDemonstrativo && <label className="jp-btn" style={{ ...btn("#fff", COR.azul, "#cbd5e1"), display: "inline-block" }}>⬆ Anexar demonstrativo
                <input type="file" style={{ display: "none" }} onChange={ev => { const f = ev.target.files?.[0]; if (f) anexarDemonstrativo(p, f); ev.target.value = ""; }} /></label>}
          {pode.editarParcela && <button className="jp-btn" onClick={() => abrirParc(p)} style={btn("#f1f5f9", "#475569")}>Editar composição</button>}
        </div>
        <div style={{ fontSize: 11, color: COR.claro, marginTop: 10 }}>
          Origem: {[p.documento_origem ?? fin?.documento_origem ?? p.origem, (p.documento_data ?? fin?.data_referencia) ? `referência ${fmtDt(p.documento_data ?? fin?.data_referencia)}` : null, p.vencimento ? `parcela de ${rotuloPeriodo(String(p.vencimento).slice(0, 7)).toLowerCase()}` : null].filter(Boolean).join(" · ") || "não informada"}
          {p.atualizado_por && ` · última alteração por ${p.atualizado_por}${p.updated_at ? ` em ${fmtDt(p.updated_at)}` : ""}`}
        </div>
      </div>
    );
  };

  return (<>
    {/* Filtros */}
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      {fins.length > 1 && (
        <select className="jp-fi" style={{ width: "auto", minWidth: 160 }} value={fin?.id ?? ""} onChange={e => { setFinSel(Number(e.target.value)); setAberta(null); }}>
          {fins.map(f => <option key={f.id} value={f.id}>{f.nome || f.credor || `Contrato ${f.id}`}</option>)}
        </select>
      )}
      <label style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>Competência</label>
      <select className="jp-fi" style={{ width: "auto", minWidth: 150 }} value={per} onChange={e => { setPeriodo(e.target.value); setAberta(null); }}>
        <option value="">Contrato inteiro</option>
        {opcoesPeriodo.map(o => <option key={o} value={o}>{o.length === 4 ? `— ${o} (ano todo)` : rotuloPeriodo(o)}</option>)}
      </select>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>Situação</label>
      <select className="jp-fi" style={{ width: "auto", minWidth: 130 }} value={fSituacao} onChange={e => setFSituacao(e.target.value as "" | Situacao)}>
        {SITUACOES.map(s => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
      </select>
      <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {pode.novaParcela && <button className="jp-btn" onClick={() => abrirParc(null)} style={btn("#fff", COR.azul, "#dbe4f0")}>+ Parcela</button>}
        {pode.importar && <button className="jp-btn" onClick={() => { setTextoImp(""); setImpProjetado(false); setModalImp(true); }} style={btn("#fff", COR.azul, "#dbe4f0")}>⬆ Importar composição</button>}
        <button className="jp-btn" onClick={exportarCsv} disabled={!filtradas.length} style={btn("#fff", COR.azul, "#dbe4f0")}>⬇ CSV</button>
      </div>
    </div>

    {/* Cartões */}
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      {cartao("Pago no período", money(resumo.pago), COR.azul, per ? `Competência: ${rotuloPeriodo(per).toLowerCase()}` : "Contrato inteiro", "Nada pago")}
      {cartao("Amortização no período", money(resumo.amortizacao), COR.verde, "Parte destinada ao principal")}
      {cartao(saldo?.data ? `Saldo em ${fmtDt(saldo.data)}` : "Saldo devedor", money(saldo?.valor), COR.laranja, saldo ? `${saldo.origem}${saldo.projetado ? " · projetado" : ""}` : "Sem saldo informado", "Não informado")}
    </div>
    <div style={{ ...caixa, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
      <Campo rotulo="Juros" valor={money(resumo.juros)} vazio="A apurar" />
      <Campo rotulo="Seguros e taxas" valor={money(resumo.segurosETaxas)} vazio="A apurar" />
      <Campo rotulo="Correção do saldo" valor={money(resumo.correcao)} vazio="A apurar" />
      {resumo.vencidoEmAberto > 0 && <Campo rotulo="Vencido em aberto" valor={money(resumo.vencidoEmAberto)} cor="#b91c1c" />}
      {resumo.futuro > 0 && <Campo rotulo="Parcelas futuras (projeção)" valor={money(resumo.futuro)} cor={COR.cinza} />}
    </div>

    {/* Identificação */}
    <div style={{ display: "flex", gap: "6px 28px", flexWrap: "wrap", fontSize: 13, color: "#475569", padding: "2px 4px 10px" }}>
      <span>Credor: <b style={{ color: fin?.credor ? COR.texto : COR.claro }}>{ou(fin?.credor)}</b></span>
      <span>Sistema: <b style={{ color: fin?.sistema_amortizacao ? COR.texto : COR.claro }}>{ou(fin?.sistema_amortizacao)}</b></span>
      <span>Indexador: <b style={{ color: fin?.indexador ? COR.texto : COR.claro }}>{ou(fin?.indexador)}</b></span>
      <span>Prazo contratado: <b style={{ color: fin?.prazo_meses ? COR.texto : COR.claro }}>{fin?.prazo_meses ? `${fin.prazo_meses} meses` : "Não informado"}</b></span>
    </div>

    {/* Condições */}
    <div style={caixa}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={tituloCaixa}>Condições do financiamento</div>
        <div style={{ display: "flex", gap: 6 }}>
          {fin && pode.cadastrarContrato && <button className="jp-btn" onClick={() => abrirFin("condicoes", true)} style={btn("#fff", COR.cinza, COR.borda)} title="Outro contrato no mesmo imóvel (ex.: duas cotas)">+ Outro contrato</button>}
          {(fin ? pode.editarContrato : pode.cadastrarContrato) && <button className="jp-btn" onClick={() => abrirFin("condicoes")} style={btn("#fff", COR.azul, "#cbd5e1")}>{fin ? "Editar condições" : "Cadastrar financiamento"}</button>}
        </div>
      </div>
      <div style={grade(170)}>
        <Campo rotulo="Juros anuais nominais" valor={pctAa(fin?.taxa_juros_nominal_aa)} vazio="Não informado" />
        <Campo rotulo="Juros anuais efetivos" valor={pctAa(fin?.taxa_juros_efetiva_aa)} vazio="Não informado" />
        <Campo rotulo="Custo Efetivo Total (CET)" valor={pctAa(fin?.cet_aa)} vazio="Não informado" />
      </div>
      <div style={{ fontSize: 11.5, color: COR.claro, marginTop: 10 }}>
        Referência: {fmtDt(fin?.data_referencia) ?? "não informada"} · Indexador contratual: {fin?.indexador ?? "não informado"}
        {fin?.atualizado_por && ` · alterado por ${fin.atualizado_por}${fin.updated_at ? ` em ${fmtDt(fin.updated_at)}` : ""}`}
      </div>
    </div>

    {/* INCC */}
    <div style={caixa}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ ...tituloCaixa, fontSize: 17 }}>Correção por INCC</div>
          <div style={{ fontSize: 12, color: COR.cinza }}>Cadastro do índice por contrato e fase da operação</div>
        </div>
        {(fin ? pode.editarContrato : pode.cadastrarContrato) && <button className="jp-btn" onClick={() => abrirFin("incc")} style={btn("#fff", COR.azul, "#cbd5e1")}>Configurar INCC</button>}
      </div>
      {(() => {
        const ult = aplicacoes[aplicacoes.length - 1];
        const fase = fin?.incc_fase ? ` · fase: ${fin.incc_fase}` : "";
        const base = ult?.base_calculo ?? ult?.valor_anterior;
        const baseTipo = BASES_INCC.find(b => b.valor === (ult?.base_tipo ?? fin?.incc_base_tipo))?.rotulo;
        const taxa = ult ? [ult.taxa_indice_pct != null ? `${pct(ult.taxa_indice_pct)} índice` : null, ult.percentual_aplicado != null ? `${pct(ult.percentual_aplicado)} aplicado` : ult.fator_aplicado != null ? `fator ${rotuloIndice(ult.fator_aplicado, "fator")}` : null].filter(Boolean).join(" · ") : null;
        const per2 = [fin?.incc_periodicidade, fin?.incc_defasagem_meses != null ? `defasagem ${fin.incc_defasagem_meses} ${fin.incc_defasagem_meses === 1 ? "mês" : "meses"}` : null].filter(Boolean).join(" · ");
        const vig = fin?.incc_vigencia_inicio || fin?.incc_vigencia_fim ? `${fmtDt(fin?.incc_vigencia_inicio) ?? "…"} a ${fmtDt(fin?.incc_vigencia_fim) ?? "em aberto"}` : null;
        return (<>
          <div style={grade(160)}>
            <Campo rotulo="Aplicação no contrato" valor={rotuloAplicacaoIncc(fin?.incc_aplicacao) + fase} />
            <Campo rotulo="Modalidade do INCC" valor={ult?.modalidade ?? fin?.incc_modalidade} vazio="Não informado" />
            <Campo rotulo="Competência do índice" valor={mesAno(ult?.competencia)} vazio="Não informado" />
            <Campo rotulo="Taxa de INCC (%)" valor={taxa} vazio="Não informada" />
            <Campo rotulo={`Base de cálculo (R$)${baseTipo ? ` — ${baseTipo.toLowerCase()}` : ""}`} valor={money(base)} vazio="A informar" />
            <Campo rotulo="Correção por INCC (R$)" valor={money(ult?.correcaoValor)} vazio="A apurar" />
            <Campo rotulo="Periodicidade / defasagem" valor={per2 || null} vazio="A confirmar" />
            <Campo rotulo="Vigência" valor={vig} vazio="A informar" />
          </div>
          <div style={{ fontSize: 11.5, color: COR.claro, marginTop: 10 }}>
            Modalidades disponíveis: INCC-M, INCC-DI e INCC-10.
            {aplicacoes.length ? ` Correção acumulada: ${money(aplicacoes[aplicacoes.length - 1].acumulado)} em ${aplicacoes.length} aplicação(ões).` : " Nenhuma aplicação do índice lançada."}
            {fin?.indexador && !/INCC/i.test(fin.indexador) && ` O indexador contratual deste financiamento é ${fin.indexador}; a correção dele aparece em "Correção do saldo".`}
          </div>
          {aplicacoes.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: COR.claro, fontSize: 10.5, textTransform: "uppercase", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Competência</th><th style={{ textAlign: "left", padding: "6px 8px" }}>Fonte</th>
                  <th style={{ padding: "6px 8px" }}>Índice</th><th style={{ padding: "6px 8px" }}>Valor anterior</th><th style={{ padding: "6px 8px" }}>Após reajuste</th>
                  <th style={{ padding: "6px 8px" }}>Correção</th><th style={{ padding: "6px 8px" }}>Acumulado</th></tr></thead>
                <tbody>{[...aplicacoes].reverse().map(a => (
                  <tr key={a.id} style={{ borderTop: "1px solid #f1f5f9", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>{mesAno(a.competencia)} {a.modalidade && <span style={{ color: COR.claro, fontWeight: 600 }}>{a.modalidade}</span>}</td>
                    <td style={{ textAlign: "left", padding: "6px 8px", color: COR.cinza }}>{a.fonte ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{a.fator_aplicado != null ? rotuloIndice(a.fator_aplicado, "fator") : a.percentual_aplicado != null ? pct(a.percentual_aplicado) : a.taxa_indice_pct != null ? pct(a.taxa_indice_pct) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{money(a.valor_anterior) ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{money(a.valor_corrigido) ?? "—"}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{money(a.correcaoValor) ?? "A apurar"}</td>
                    <td style={{ padding: "6px 8px", color: COR.azul, fontWeight: 700 }}>{money(a.acumulado)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>);
      })()}
    </div>

    {/* Evolução do saldo no período */}
    {evolPeriodo && (
      <div style={caixa}><div style={{ ...tituloCaixa, marginBottom: 10 }}>Evolução do saldo devedor — {rotuloPeriodo(per).toLowerCase()}{per ? "" : " (até hoje)"}</div>{blocoEvolucao(evolPeriodo, per ? "Saldo ao fim do período" : "Saldo atual")}</div>
    )}

    {/* Tabela */}
    <div style={{ background: "#fff", border: `1px solid ${COR.borda}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: COR.claro, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".5px" }}>
              <th style={{ textAlign: "left", padding: "9px 12px" }}>Parcela</th>
              <th style={{ textAlign: "left", padding: "9px 12px" }}>Vencimento</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Valor devido</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Amortização</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Juros</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Seguros</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Taxas</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Valor pago</th>
              <th style={{ textAlign: "right", padding: "9px 12px" }}>Saldo devedor</th>
              <th style={{ textAlign: "center", padding: "9px 12px" }}>Situação</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 22, textAlign: "center", color: COR.claro }}>
                {parcelas.length ? "Nenhuma parcela neste filtro." : "Nenhuma parcela cadastrada. Use “+ Parcela” ou “Importar composição” (cole a tabela do demonstrativo)."}
              </td></tr>
            )}
            {visiveis.map(l => {
              const p = l.p as ParcelaDaAba;
              const cor = corDaSituacao(l.situacao);
              const ab = aberta === p.id;
              return (
                <FragmentoLinha key={p.id}>
                  <tr style={{ borderTop: "1px solid #f1f5f9", background: ab ? "#f8fafc" : undefined, cursor: "pointer" }} onClick={() => setAberta(ab ? null : p.id)}>
                    <td style={{ padding: "9px 12px", fontWeight: 800, color: COR.texto }}>{rotuloParcela(p)}</td>
                    <td style={{ padding: "9px 12px", color: "#475569" }}>{fmtDt(p.vencimento) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 800, color: COR.texto }}>{money(numeroOuNulo(p.valor)) ?? "—"}</td>
                    {/* Amortização, juros e saldo na própria linha (revisão de
                        16/11): ver a evolução sem abrir parcela por parcela. */}
                    <td style={{ padding: "9px 12px", textAlign: "right", color: COR.verde }}>{money(l.comp.amortizacao) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: COR.cinza }}>{money(l.comp.juros) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: COR.cinza }}>{money(l.comp.seguros) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: COR.cinza }}>{money(l.comp.taxas) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: COR.texto }}>{money(l.pago) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: COR.laranja, fontWeight: 700 }}>{money(l.comp.saldo_devedor) ?? "—"}</td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      <span title={p.baixa === "malote" ? "Paga pelo Malote (conta do contrato)" : p.baixa === "conta" ? "Baixa dada na conta do contrato" : undefined}
                        style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: cor.fundo, color: cor.texto, whiteSpace: "nowrap" }}>{l.situacao}</span>
                      {(p.baixa === "malote" || p.baixa === "conta") && <div style={{ fontSize: 9.5, color: COR.cinza, marginTop: 2 }}>{p.baixa === "malote" ? "pelo Malote" : "baixa na conta"}</div>}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>
                      <button className="jp-btn" aria-label={ab ? "Recolher" : "Detalhar"} title={ab ? "Recolher" : "Detalhar"}
                        onClick={ev => { ev.stopPropagation(); setAberta(ab ? null : p.id); }}
                        style={{ background: "none", color: COR.azul, padding: "2px 6px", fontSize: 14 }}>{ab ? "▴" : "▾"}</button>
                    </td>
                  </tr>
                  {ab && p.encargos_inclusos !== false && (l.comp.seguros != null || l.comp.taxas != null) && (
                    <tr style={{ background: "#f8fafc" }}><td colSpan={11} style={{ padding: "0 12px 8px", fontSize: 11.5, color: COR.cinza }}>Seguros e taxas já estão incluídos no valor devido.</td></tr>
                  )}
                  {ab && <tr><td colSpan={11} style={{ padding: 0 }}>{detalhe(l)}</td></tr>}
                </FragmentoLinha>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 14px", borderTop: "1px solid #eef2f7", fontSize: 11, color: COR.claro, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span>{filtradas.length} parcela(s) no filtro{resumo.projetadas ? ` · ${resumo.projetadas} com valores projetados` : ""}</span>
        {filtradas.length > LIMITE && <button className="jp-btn" onClick={() => setVerTodas(v => !v)} style={{ background: "none", color: COR.azul, padding: 0 }}>{verTodas ? "Mostrar menos" : `Mostrar todas (${filtradas.length})`}</button>}
        {parcelas[0]?.origem && <span>Origem: {[...new Set(parcelas.map(x => x.origem).filter(Boolean))].join(" · ")}</span>}
      </div>
    </div>

    {/* ── Modal: financiamento / INCC ── */}
    {modalFin && (
      <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setModalFin(null); }}>
        <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COR.texto, marginBottom: 12 }}>
            {modalFin.foco === "incc" ? "Configurar INCC" : modalFin.id ? "Condições do financiamento" : "Cadastrar financiamento"}
          </div>
          {modalFin.foco === "condicoes" && (<>
            <div className="jp-grid2">
              <div className="jp-fg"><label>Nome do contrato</label><input className="jp-fi" value={formFin.nome} onChange={e => setFormFin(f => ({ ...f, nome: e.target.value }))} placeholder="Ex.: Contrato CAIXA 8.4444…" /></div>
              <div className="jp-fg"><label>Credor</label><input className="jp-fi" value={formFin.credor} onChange={e => setFormFin(f => ({ ...f, credor: e.target.value }))} placeholder="CAIXA, construtora…" /></div>
              <div className="jp-fg"><label>Sistema de amortização</label>
                <input className="jp-fi" list="jp-sistemas" value={formFin.sistema_amortizacao} onChange={e => setFormFin(f => ({ ...f, sistema_amortizacao: e.target.value }))} />
                <datalist id="jp-sistemas"><option value="SAC" /><option value="PRICE" /><option value="SACRE" /><option value="Direto com a construtora" /></datalist></div>
              <div className="jp-fg"><label>Indexador contratual</label>
                <input className="jp-fi" list="jp-indexadores" value={formFin.indexador} onChange={e => setFormFin(f => ({ ...f, indexador: e.target.value }))} />
                <datalist id="jp-indexadores"><option value="TR" /><option value="INCC" /><option value="IPCA" /><option value="IGP-M" /><option value="Sem indexador" /></datalist></div>
              <div className="jp-fg"><label>Prazo contratado (meses)</label><input className="jp-fi" inputMode="numeric" value={formFin.prazo_meses} onChange={e => setFormFin(f => ({ ...f, prazo_meses: e.target.value }))} /></div>
              <div className="jp-fg"><label>Data de referência</label><input className="jp-fi" type="date" value={formFin.data_referencia} onChange={e => setFormFin(f => ({ ...f, data_referencia: e.target.value }))} /></div>
              <div className="jp-fg"><label>Juros anuais nominais (% a.a.)</label><input className="jp-fi" inputMode="decimal" value={formFin.taxa_juros_nominal_aa} onChange={e => setFormFin(f => ({ ...f, taxa_juros_nominal_aa: e.target.value }))} placeholder="9,7978" /></div>
              <div className="jp-fg"><label>Juros anuais efetivos (% a.a.)</label><input className="jp-fi" inputMode="decimal" value={formFin.taxa_juros_efetiva_aa} onChange={e => setFormFin(f => ({ ...f, taxa_juros_efetiva_aa: e.target.value }))} placeholder="10,2499" /></div>
              <div className="jp-fg"><label>CET (% a.a.)</label><input className="jp-fi" inputMode="decimal" value={formFin.cet_aa} onChange={e => setFormFin(f => ({ ...f, cet_aa: e.target.value }))} placeholder="10,97" /></div>
              <div className="jp-fg"><label>Saldo devedor informado (R$)</label><input className="jp-fi" inputMode="decimal" value={formFin.saldo_devedor_informado} onChange={e => setFormFin(f => ({ ...f, saldo_devedor_informado: e.target.value }))} placeholder="Use só se não vier nas parcelas" /></div>
              <div className="jp-fg"><label>Data do saldo informado</label><input className="jp-fi" type="date" value={formFin.saldo_devedor_data} onChange={e => setFormFin(f => ({ ...f, saldo_devedor_data: e.target.value }))} /></div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: COR.azul, textTransform: "uppercase", margin: "6px 0 8px" }}>FGTS e FGHAB</div>
            <div className="jp-grid2">
              <div className="jp-fg"><label>Cotas FGTS contratadas</label><input className="jp-fi" inputMode="numeric" value={formFin.cotas_fgts_contratadas} onChange={e => setFormFin(f => ({ ...f, cotas_fgts_contratadas: e.target.value }))} /></div>
              <div className="jp-fg"><label>Parcelas FGTS remanescentes</label><input className="jp-fi" inputMode="numeric" value={formFin.parcelas_fgts_remanescentes} onChange={e => setFormFin(f => ({ ...f, parcelas_fgts_remanescentes: e.target.value }))} /></div>
              <div className="jp-fg"><label>FGTS não utilizado (R$)</label><input className="jp-fi" inputMode="decimal" value={formFin.fgts_nao_utilizado} onChange={e => setFormFin(f => ({ ...f, fgts_nao_utilizado: e.target.value }))} /></div>
              <div className="jp-fg"><label>Percentual FGTS utilizado (%)</label><input className="jp-fi" inputMode="decimal" value={formFin.percentual_fgts_utilizado} onChange={e => setFormFin(f => ({ ...f, percentual_fgts_utilizado: e.target.value }))} /></div>
              <div className="jp-fg"><label>Saldo perda de renda FGHAB (R$)</label><input className="jp-fi" inputMode="decimal" value={formFin.saldo_perda_renda_fghab} onChange={e => setFormFin(f => ({ ...f, saldo_perda_renda_fghab: e.target.value }))} /></div>
              <div className="jp-fg"><label>Produto / fonte de recursos</label><input className="jp-fi" value={formFin.produto_fonte_recursos} onChange={e => setFormFin(f => ({ ...f, produto_fonte_recursos: e.target.value }))} placeholder="901 — SFH / 15 — SBPE" /></div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: COR.azul, textTransform: "uppercase", margin: "6px 0 8px" }}>Pagador e documento</div>
            <div className="jp-grid2">
              <div className="jp-fg"><label>Empresa/pessoa pagadora</label><input className="jp-fi" value={formFin.pagador} onChange={e => setFormFin(f => ({ ...f, pagador: e.target.value }))} /></div>
              <div className="jp-fg"><label>Conta bancária</label><input className="jp-fi" value={formFin.conta_bancaria} onChange={e => setFormFin(f => ({ ...f, conta_bancaria: e.target.value }))} /></div>
              <div className="jp-fg"><label>Documento de origem</label><input className="jp-fi" value={formFin.documento_origem} onChange={e => setFormFin(f => ({ ...f, documento_origem: e.target.value }))} placeholder="Demonstrativo CAIXA" /></div>
              <div className="jp-fg"><label>Data do documento</label><input className="jp-fi" type="date" value={formFin.documento_data} onChange={e => setFormFin(f => ({ ...f, documento_data: e.target.value }))} /></div>
            </div>
            <div className="jp-fg"><label>Observações</label><textarea className="jp-fi" rows={2} value={formFin.observacoes} onChange={e => setFormFin(f => ({ ...f, observacoes: e.target.value }))} /></div>
          </>)}

          {modalFin.foco === "incc" && (<>
            <div style={{ fontSize: 12, color: COR.cinza, marginBottom: 10 }}>A regra vale para {fin?.nome || fin?.credor || "este financiamento"}. O INCC é aplicado conforme o contrato; outros indexadores (TR, IPCA…) ficam no campo Indexador das condições.</div>
            <div className="jp-grid2">
              <div className="jp-fg"><label>Aplicação no contrato</label>
                <select className="jp-fi" value={formFin.incc_aplicacao} onChange={e => setFormFin(f => ({ ...f, incc_aplicacao: e.target.value }))}>
                  {APLICACOES_INCC.map(a => <option key={a.valor} value={a.valor}>{a.rotulo}</option>)}</select></div>
              <div className="jp-fg"><label>Fase da operação</label><input className="jp-fi" list="jp-fases" value={formFin.incc_fase} onChange={e => setFormFin(f => ({ ...f, incc_fase: e.target.value }))} />
                <datalist id="jp-fases"><option value="Obra (até as chaves)" /><option value="Pós-chaves" /><option value="Contrato inteiro" /></datalist></div>
              <div className="jp-fg"><label>Modalidade</label>
                <select className="jp-fi" value={formFin.incc_modalidade} onChange={e => setFormFin(f => ({ ...f, incc_modalidade: e.target.value }))}>
                  <option value="">Selecionar</option>{MODALIDADES_INCC.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
              <div className="jp-fg"><label>Base de cálculo</label>
                <select className="jp-fi" value={formFin.incc_base_tipo} onChange={e => setFormFin(f => ({ ...f, incc_base_tipo: e.target.value }))}>
                  <option value="">Selecionar</option>{BASES_INCC.map(b => <option key={b.valor} value={b.valor}>{b.rotulo}</option>)}</select></div>
              <div className="jp-fg"><label>Periodicidade do reajuste</label><input className="jp-fi" list="jp-periods" value={formFin.incc_periodicidade} onChange={e => setFormFin(f => ({ ...f, incc_periodicidade: e.target.value }))} />
                <datalist id="jp-periods"><option value="Mensal" /><option value="Anual" /><option value="Conforme contrato" /></datalist></div>
              <div className="jp-fg"><label>Defasagem do índice (meses)</label><input className="jp-fi" inputMode="numeric" value={formFin.incc_defasagem_meses} onChange={e => setFormFin(f => ({ ...f, incc_defasagem_meses: e.target.value }))} placeholder="Ex.: 2 (índice de 2 meses antes)" /></div>
              <div className="jp-fg"><label>Vigência — início</label><input className="jp-fi" type="date" value={formFin.incc_vigencia_inicio} onChange={e => setFormFin(f => ({ ...f, incc_vigencia_inicio: e.target.value }))} /></div>
              <div className="jp-fg"><label>Vigência — término</label><input className="jp-fi" type="date" value={formFin.incc_vigencia_fim} onChange={e => setFormFin(f => ({ ...f, incc_vigencia_fim: e.target.value }))} /></div>
            </div>
            <div className="jp-fg"><label>Base — descrição (quando “outra obrigação”)</label><input className="jp-fi" value={formFin.incc_base_descricao} onChange={e => setFormFin(f => ({ ...f, incc_base_descricao: e.target.value }))} /></div>

            <div style={{ borderTop: "1px dashed #e2e8f0", marginTop: 6, paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: COR.azul, textTransform: "uppercase", marginBottom: 8 }}>Lançar aplicação do índice (histórico por competência)</div>
              {!modalFin.id && <div style={{ fontSize: 12, color: "#b45309", marginBottom: 8 }}>Salve a regra primeiro; depois as aplicações podem ser lançadas.</div>}
              <div className="jp-grid2">
                <div className="jp-fg"><label>Competência</label><input className="jp-fi" type="month" value={formApl.competencia} onChange={e => setFormApl(f => ({ ...f, competencia: e.target.value }))} /></div>
                <div className="jp-fg"><label>Modalidade</label>
                  <select className="jp-fi" value={formApl.modalidade} onChange={e => setFormApl(f => ({ ...f, modalidade: e.target.value }))}>
                    <option value="">—</option>{MODALIDADES_INCC.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                <div className="jp-fg"><label>Fonte do índice</label><input className="jp-fi" value={formApl.fonte} onChange={e => setFormApl(f => ({ ...f, fonte: e.target.value }))} placeholder="FGV/IBRE, boleto da construtora…" /></div>
                <div className="jp-fg"><label>Taxa do índice no mês (%)</label><input className="jp-fi" inputMode="decimal" value={formApl.taxa_indice_pct} onChange={e => setFormApl(f => ({ ...f, taxa_indice_pct: e.target.value }))} /></div>
                <div className="jp-fg"><label>% aplicado no reajuste</label><input className="jp-fi" inputMode="decimal" value={formApl.percentual_aplicado} onChange={e => setFormApl(f => ({ ...f, percentual_aplicado: e.target.value }))} placeholder="Se diferente da taxa" /></div>
                <div className="jp-fg"><label>…ou fator aplicado</label><input className="jp-fi" inputMode="decimal" value={formApl.fator_aplicado} onChange={e => setFormApl(f => ({ ...f, fator_aplicado: e.target.value }))} placeholder="1,00580000" /></div>
                <div className="jp-fg"><label>Base de cálculo</label>
                  <select className="jp-fi" value={formApl.base_tipo} onChange={e => setFormApl(f => ({ ...f, base_tipo: e.target.value }))}>
                    {BASES_INCC.map(b => <option key={b.valor} value={b.valor}>{b.rotulo}</option>)}</select></div>
                <div className="jp-fg"><label>Base / valor anterior (R$)</label><input className="jp-fi" inputMode="decimal" value={formApl.base_calculo} onChange={e => setFormApl(f => ({ ...f, base_calculo: e.target.value }))} /></div>
                <div className="jp-fg"><label>Valor após o reajuste (R$)</label><input className="jp-fi" inputMode="decimal" value={formApl.valor_corrigido} onChange={e => setFormApl(f => ({ ...f, valor_corrigido: e.target.value }))} placeholder={calcApl ? `calculado: ${calcApl.corrigido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""} /></div>
                <div className="jp-fg"><label>Correção (R$)</label><input className="jp-fi" inputMode="decimal" value={formApl.correcao} onChange={e => setFormApl(f => ({ ...f, correcao: e.target.value }))} placeholder={calcApl ? `calculada: ${calcApl.correcao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "do documento"} /></div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="jp-fi" placeholder="Observação" value={formApl.observacao} onChange={e => setFormApl(f => ({ ...f, observacao: e.target.value }))} />
                {pode.lancarIncc && <button className="jp-btn" disabled={!modalFin.id} onClick={adicionarAplicacao} style={{ ...btn("#eef4ff", COR.azul, "#dbe4f0"), whiteSpace: "nowrap", opacity: modalFin.id ? 1 : .5 }}>+ Lançar</button>}
              </div>
              {aplicacoes.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 160, overflowY: "auto" }}>
                  {[...aplicacoes].reverse().map(a => (
                    <div key={a.id} style={{ display: "flex", gap: 10, fontSize: 12, padding: "5px 0", borderTop: "1px solid #f1f5f9", alignItems: "center" }}>
                      <b style={{ minWidth: 64 }}>{mesAno(a.competencia)}</b>
                      <span style={{ flex: 1, color: COR.cinza }}>{a.modalidade ?? "INCC"} · {money(a.valor_anterior) ?? "—"} → {money(a.valor_corrigido) ?? "—"} · correção {money(a.correcaoValor) ?? "a apurar"}{a.criado_por ? ` · ${a.criado_por}` : ""}</span>
                      {pode.excluirIncc && <button className="jp-btn" onClick={() => excluirAplicacao(a)} style={{ background: "none", color: "#dc2626", padding: "2px 6px" }}>Excluir</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>)}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="jp-btn" onClick={() => setModalFin(null)} style={btn("#fff", "#475569", COR.borda)}>Fechar</button>
            <button className="jp-btn" disabled={gravando} onClick={salvarFin} style={btn(COR.azul, "#fff")}>{gravando ? "Salvando…" : modalFin.foco === "incc" ? "Salvar regra" : "Salvar"}</button>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: parcela ── */}
    {modalParc && (
      <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setModalParc(null); }}>
        <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COR.texto, marginBottom: 4 }}>{modalParc.id ? "Composição da parcela" : "Nova parcela do financiamento"}</div>
          <div style={{ fontSize: 11.5, color: COR.claro, marginBottom: 12 }}>Deixe em branco o que o documento não traz — fica “não informado”, não zero.</div>
          <div style={grade(150)}>
            <div className="jp-fg"><label>Nº da parcela</label><input className="jp-fi" inputMode="numeric" value={formParc.numero} onChange={e => setFormParc(f => ({ ...f, numero: e.target.value }))} /></div>
            <div className="jp-fg"><label>Rótulo (sem número)</label><input className="jp-fi" value={formParc.rotulo} onChange={e => setFormParc(f => ({ ...f, rotulo: e.target.value }))} placeholder="Reforço, sinal…" /></div>
            <div className="jp-fg"><label>Vencimento</label><input className="jp-fi" type="date" value={formParc.vencimento} onChange={e => setFormParc(f => ({ ...f, vencimento: e.target.value }))} /></div>
            <div className="jp-fg"><label>Data do pagamento</label><input className="jp-fi" type="date" value={formParc.data_pagamento} onChange={e => setFormParc(f => ({ ...f, data_pagamento: e.target.value }))} /></div>
            <div className="jp-fg"><label>Valor devido (R$)</label><input className="jp-fi" inputMode="decimal" value={formParc.valor} onChange={e => setFormParc(f => ({ ...f, valor: e.target.value }))} /></div>
            <div className="jp-fg"><label>Valor pago (R$)</label><input className="jp-fi" inputMode="decimal" value={formParc.valor_pago} onChange={e => setFormParc(f => ({ ...f, valor_pago: e.target.value }))} placeholder="ou registre os pagamentos" /></div>
            {fins.length > 1 && <div className="jp-fg"><label>Contrato</label>
              <select className="jp-fi" value={formParc.financiamento_id} onChange={e => setFormParc(f => ({ ...f, financiamento_id: e.target.value }))}>
                {fins.map(f => <option key={f.id} value={f.id}>{f.nome || f.credor || `Contrato ${f.id}`}</option>)}</select></div>}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: COR.azul, textTransform: "uppercase", margin: "4px 0 8px" }}>Composição</div>
          <div style={grade(150)}>
            {CAMPOS_COMPONENTES.filter(c => c !== "indice_correcao").map(c => (
              <div key={c} className="jp-fg"><label>{ROTULO_COMP[c]}</label><input className="jp-fi" inputMode="decimal" value={formParc[c]} onChange={e => setFormParc(f => ({ ...f, [c]: e.target.value }))} /></div>
            ))}
            <div className="jp-fg"><label>Índice de correção</label><input className="jp-fi" inputMode="decimal" value={formParc.indice_correcao} onChange={e => setFormParc(f => ({ ...f, indice_correcao: e.target.value }))} placeholder="1,00122401 ou 0,58" /></div>
            <div className="jp-fg"><label>O índice é</label>
              <select className="jp-fi" value={formParc.indice_tipo} onChange={e => setFormParc(f => ({ ...f, indice_tipo: e.target.value }))}>
                <option value="">Detectar</option><option value="fator">Fator</option><option value="percentual">Percentual (%)</option></select></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#475569", margin: "4px 0 10px" }}>
            <label><input type="checkbox" checked={flagsParc.seguros_fghab_subtotal} onChange={e => setFlagsParc(f => ({ ...f, seguros_fghab_subtotal: e.target.checked }))} /> “Seguros / FGHAB” é o subtotal de MIP + DFI (não somar de novo)</label>
            <label><input type="checkbox" checked={flagsParc.encargos_inclusos} onChange={e => setFlagsParc(f => ({ ...f, encargos_inclusos: e.target.checked }))} /> Seguros e taxas já estão incluídos no valor devido</label>
            <label><input type="checkbox" checked={flagsParc.projetado} onChange={e => setFlagsParc(f => ({ ...f, projetado: e.target.checked }))} /> Valores projetados (ainda não confirmados por demonstrativo)</label>
          </div>
          <div style={grade(200)}>
            <div className="jp-fg"><label>Lançamento financeiro vinculado</label><input className="jp-fi" value={formParc.lancamento_financeiro} onChange={e => setFormParc(f => ({ ...f, lancamento_financeiro: e.target.value }))} placeholder="Nº da despesa no Malote, lançamento…" /></div>
            <div className="jp-fg"><label>Documento de origem</label><input className="jp-fi" value={formParc.documento_origem} onChange={e => setFormParc(f => ({ ...f, documento_origem: e.target.value }))} placeholder="Demonstrativo CAIXA" /></div>
            <div className="jp-fg"><label>Data do documento</label><input className="jp-fi" type="date" value={formParc.documento_data} onChange={e => setFormParc(f => ({ ...f, documento_data: e.target.value }))} /></div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
            <div>{modalParc.id && pode.excluirParcela && <button className="jp-btn" onClick={() => { const p = parcelas.find(x => x.id === modalParc.id); if (p) excluirParc(p); }} style={btn("#fef2f2", "#dc2626", "#fecaca")}>Excluir parcela</button>}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="jp-btn" onClick={() => setModalParc(null)} style={btn("#fff", "#475569", COR.borda)}>Cancelar</button>
              <button className="jp-btn" disabled={gravando} onClick={salvarParc} style={btn(COR.azul, "#fff")}>{gravando ? "Salvando…" : "Salvar parcela"}</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: pagamento ── */}
    {modalPag && (
      <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setModalPag(null); }}>
        <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COR.texto, marginBottom: 4 }}>Pagamento da parcela {rotuloParcela(modalPag.parcela)}</div>
          <div style={{ fontSize: 12, color: COR.cinza, marginBottom: 12 }}>Valor devido: {money(numeroOuNulo(modalPag.parcela.valor)) ?? "não informado"}. Pode haver mais de um pagamento na mesma parcela.</div>
          {(() => {
            const semComp = pagamentosSemComprovante(pagamentos.filter(x => String(x.parcela_id) === String(modalPag.parcela.id)));
            if (!semComp.length || !pode.anexarComprovante) return null;
            return (
              <div className="jp-fg"><label>Anexar a</label>
                <select className="jp-fi" value={formPag.pagamento_id} onChange={e => setFormPag(f => ({ ...f, pagamento_id: e.target.value }))}>
                  {pode.registrarPagamento && <option value="">Novo pagamento</option>}
                  {semComp.map(pg => <option key={pg.id} value={String(pg.id)}>Pagamento de {fmtDt(pg.data_pagamento)} — {money(numeroOuNulo(pg.valor))} (sem comprovante)</option>)}
                </select></div>
            );
          })()}
          {!formPag.pagamento_id && <div className="jp-grid2">
            <div className="jp-fg"><label>Data</label><input className="jp-fi" type="date" value={formPag.data_pagamento} onChange={e => setFormPag(f => ({ ...f, data_pagamento: e.target.value }))} /></div>
            <div className="jp-fg"><label>Valor pago (R$)</label><input className="jp-fi" inputMode="decimal" value={formPag.valor} onChange={e => setFormPag(f => ({ ...f, valor: e.target.value }))} /></div>
          </div>}
          {!formPag.pagamento_id && <div className="jp-fg"><label>Observação</label><input className="jp-fi" value={formPag.observacao} onChange={e => setFormPag(f => ({ ...f, observacao: e.target.value }))} /></div>}
          <div className="jp-fg"><label>{formPag.pagamento_id ? "Comprovante" : "Comprovante (opcional)"}</label><input type="file" onChange={e => setArqPag(e.target.files?.[0] ?? null)} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button className="jp-btn" onClick={() => setModalPag(null)} style={btn("#fff", "#475569", COR.borda)}>Cancelar</button>
            <button className="jp-btn" disabled={gravando} onClick={salvarPag} style={btn(COR.azul, "#fff")}>{gravando ? "Salvando…" : formPag.pagamento_id ? "Anexar" : "Registrar"}</button>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: importação ── */}
    {modalImp && (
      <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget) setModalImp(false); }}>
        <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COR.texto, marginBottom: 4 }}>Importar composição das parcelas</div>
          <div style={{ fontSize: 12, color: COR.cinza, marginBottom: 10, lineHeight: 1.5 }}>
            Cole aqui a tabela do demonstrativo (copiada do Excel) ou escolha um arquivo .xlsx/.csv. A primeira linha com os títulos é o cabeçalho.
            Colunas reconhecidas: Parcela, Vencimento, Valor devido, Amortização, Juros, MIP, DFI, Seguros / FGHAB, Taxas, Valor FCVS, FGTS, Encargo líquido,
            Impontualidade, Valor pago, Data do pagamento, Diferença, Atualização monetária, Saldo anterior, Saldo devedor, Índice, Outros.
            A parcela é casada pelo número (ou pelo mês do vencimento); a que não existe é criada. Coluna que não veio não apaga nada.
          </div>
          <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={e => { const f = e.target.files?.[0]; if (f) lerArquivoImp(f); e.target.value = ""; }} style={{ marginBottom: 8 }} />
          <textarea className="jp-fi" rows={8} value={textoImp} onChange={e => setTextoImp(e.target.value)} placeholder={"Parcela\tVencimento\tValor devido\tAmortização\tJuros\tMIP\tDFI\t…\n83\t06/03/2026\t2.370,11\t601,06\t1.692,01\t24,58\t27,46\t…"} style={{ fontFamily: "monospace", fontSize: 11.5 }} />
          {leitura && (
            <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
              {leitura.reconhecidas.length > 0 && <div><b>Colunas reconhecidas:</b> {leitura.reconhecidas.join(", ")}</div>}
              {leitura.ignoradas.length > 0 && <div style={{ color: "#b45309" }}><b>Ignoradas:</b> {leitura.ignoradas.join(", ")}</div>}
              {plano && <div style={{ color: COR.verde }}><b>{plano.atualizar.length}</b> parcela(s) atualizada(s) · <b>{plano.inserir.length}</b> nova(s)</div>}
              {leitura.erros.slice(0, 5).map((er, i) => <div key={i} style={{ color: "#b91c1c" }}>{er}</div>)}
              {leitura.erros.length > 5 && <div style={{ color: "#b91c1c" }}>… e mais {leitura.erros.length - 5} aviso(s).</div>}
            </div>
          )}
          <label style={{ display: "block", fontSize: 12.5, color: "#475569", marginTop: 8 }}><input type="checkbox" checked={impProjetado} onChange={e => setImpProjetado(e.target.checked)} /> Marcar como valores projetados (simulação, não demonstrativo)</label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button className="jp-btn" onClick={() => setModalImp(false)} style={btn("#fff", "#475569", COR.borda)}>Cancelar</button>
            <button className="jp-btn" disabled={!plano || gravando} onClick={importar} style={{ ...btn(COR.azul, "#fff"), opacity: plano ? 1 : .5 }}>{gravando ? "Importando…" : "Importar"}</button>
          </div>
        </div>
      </div>
    )}
  </>);
}

/** <></> com key, para as duas/três linhas de cada parcela. */
function FragmentoLinha({ children }: { children: ReactNode }) { return <>{children}</>; }
