import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ContratosDashboardTab, type FiltroDashboard } from "./contratos/ContratosDashboardTab";
import { Plus, Pencil, Trash2, Building2, CalendarDays, TrendingUp, FileText, ExternalLink, Archive, ChevronDown, ChevronUp } from "lucide-react";
import {
  useContratosERP,
  useContratoERPUpsert,
  useContratoERPDelete,
} from "@/hooks/useContratosERP";
import type { ContratoERP, ContratoERPInput } from "@/hooks/useContratosERP";
import {
  usePlanilhaCustos,
  somarValorExecutadoMensalContrato,
  somarCustoIndiretoMensalContrato,
  somarLucroMensalContrato,
  somarQuantFuncExecContrato,
} from "@/hooks/usePlanilhaCusto";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useContratoDocsPorContrato } from "@/hooks/useDocumentos";
import {
  useContratoQuadro, useContratoQuadroSalvar, useContratoQuadroGerarVagas, somarCriadas,
} from "@/hooks/useContratoQuadro";
import { QuadroPostosContrato, paraFormulario } from "@/components/licitacoes/QuadroPostosContrato";
import { CardObrigatorios } from "@/components/licitacoes/CardObrigatorios";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  type LinhaQuadroForm, conferirContrato, contratoCompleto, errosDoQuadro,
  conferirQuadroComContrato, paraPayload, totalDeVagas,
} from "@/lib/licitacoes/quadroPostos";
import { BADGE as DOC_BADGE, periodLabel } from "@/pages/Documentos";
import { corEmpresa, corEmpresaFundo } from "@/pages/malote/EmpresaContratoBadge";

export const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  encerrado: "Encerrado",
  suspenso: "Suspenso",
};

export const STATUS_COLOR: Record<string, string> = {
  ativo: "bg-emerald-100 text-emerald-700",
  encerrado: "bg-slate-100 text-slate-500",
  suspenso: "bg-amber-100 text-amber-700",
};

export function fmt(v: number | null) {
  if (!v) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtData(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export const AVISO_VIGENCIA_LABEL: Record<string, string> = {
  em_vigencia: "Em vigência",
  a_vencer: "A vencer",
  vencido: "Vencido",
};

export const AVISO_VIGENCIA_COLOR: Record<string, string> = {
  em_vigencia: "bg-emerald-500",
  a_vencer: "bg-amber-500",
  vencido: "bg-rose-500",
};

// Coluna "Aviso de Vigência" do mockup 2 — mesmo critério de dias restantes
// já usado nas abas Em Vigência/A Vencer (>90 dias = em vigência, 0-90 =
// a vencer, negativo = vencido). Exportado: reaproveitado também pelo
// ContratosDashboardTab.tsx (SIS-2026-0325, dashboard).
export function vigenciaInfo(c: Pick<ContratoERP, "vigencia_inicial" | "vigencia_final">) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const inicio = c.vigencia_inicial ? new Date(c.vigencia_inicial + "T00:00:00") : null;
  const fim = c.vigencia_final ? new Date(c.vigencia_final + "T00:00:00") : null;

  const mesesExecucao = inicio && fim
    ? Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    : 0;
  const diasParaFinalizar = fim ? Math.round((fim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const avisoVigencia = diasParaFinalizar === null ? null : diasParaFinalizar < 0 ? "vencido" : diasParaFinalizar <= 90 ? "a_vencer" : "em_vigencia";

  return { mesesExecucao, diasParaFinalizar, avisoVigencia };
}

type FiscalFields =
  | "issqn_pct" | "ir_pct" | "cofins_pct" | "pis_pct" | "csll_pct"
  | "prazo_pagamento" | "codigo_servico_lc116" | "codigo_servico_municipal_cnae"
  | "conta_pagamento" | "email_envio_nf" | "instrucoes_envio";

type ContratoFormState = Omit<ContratoERPInput, FiscalFields>;

const EMPTY: ContratoFormState = {
  empresa_id: "",
  nome: "",
  cliente: "",
  cnpj_cliente: null,
  vigencia_meses: null,
  data_inicio: null,
  status: "ativo",
  grade_id: null,
  capa_id: null,
  cidade: null,
  numero_edital: null,
  data_fim_vigencia: null,
  vigencia_inicial: null,
  vigencia_final: null,
  quant_func_estipulado: null,
  quant_func_exec: null,
  quant_func_exec_real: null,
  valor_mensal_contratado: null,
  valor_executado_mensal: null,
  valor_mensal_ano_anterior: null,
  valor_garantia_contratual: null,
  custo_anual_insumos: null,
  status_solicitacao: null,
};

interface FiscalForm {
  issqn_pct: string;
  ir_pct: string;
  cofins_pct: string;
  pis_pct: string;
  csll_pct: string;
  prazo_pagamento: string;
  codigo_servico_lc116: string;
  codigo_servico_municipal_cnae: string;
  conta_pagamento: string;
  email_envio_nf: string;
  instrucoes_envio: string;
}

const FISCAL_EMPTY: FiscalForm = {
  issqn_pct: "", ir_pct: "", cofins_pct: "", pis_pct: "", csll_pct: "",
  prazo_pagamento: "", codigo_servico_lc116: "", codigo_servico_municipal_cnae: "",
  conta_pagamento: "", email_envio_nf: "", instrucoes_envio: "",
};

function fiscalParaForm(d: ContratoERP | null | undefined): FiscalForm {
  const pctToStr = (v: number | undefined | null) => (v ? String(Number(v) * 100) : "");
  if (!d) return { ...FISCAL_EMPTY };
  return {
    issqn_pct: pctToStr(d.issqn_pct),
    ir_pct: pctToStr(d.ir_pct),
    cofins_pct: pctToStr(d.cofins_pct),
    pis_pct: pctToStr(d.pis_pct),
    csll_pct: pctToStr(d.csll_pct),
    prazo_pagamento: d.prazo_pagamento ?? "",
    codigo_servico_lc116: d.codigo_servico_lc116 ?? "",
    codigo_servico_municipal_cnae: d.codigo_servico_municipal_cnae ?? "",
    conta_pagamento: d.conta_pagamento ?? "",
    email_envio_nf: d.email_envio_nf ?? "",
    instrucoes_envio: d.instrucoes_envio ?? "",
  };
}

export default function ContratosERP() {
  const navigate = useNavigate();
  // SIS-2026-0309: lê contratos/planilha de todas as empresas do grupo — o
  // filtro de "empresa ativa" só limitava a visão. A empresa de um contrato
  // novo agora é campo explícito do formulário (ver EMPTY/Select abaixo),
  // não mais herdada do seletor global.
  const { data: contratos = [], isLoading } = useContratosERP({ todasEmpresas: true });
  const { data: planilha = [] } = usePlanilhaCustos({ todasEmpresas: true });
  const { data: empresasGrupo = [] } = useEmpresasGrupo();
  const upsert = useContratoERPUpsert();
  const del = useContratoERPDelete();

  // SIS-2026-0325 (dashboard, achado tardio): "dashboard" é a landing —
  // mockup batizou a página de "Controle de Contratos" e o dashboard é a
  // cara principal dela; "lista" é a tela de KPIs/abas/tabela já entregue,
  // virou o destino de "Ver detalhes"/"Ver todos" dos cards do dashboard.
  const [viewTab, setViewTab] = useState<"dashboard" | "lista">("dashboard");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<string>("todas");
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<ContratoERP | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContratoERP | null>(null);
  const [mostrarSubtotalPorEmpresa, setMostrarSubtotalPorEmpresa] = useState(false);
  const [form, setForm] = useState<ContratoFormState>(EMPTY);
  const [fiscal, setFiscal] = useState<FiscalForm>(FISCAL_EMPTY);

  const { data: docsContrato = [] } = useContratoDocsPorContrato(editando?.id);

  // ── Quadro de postos (24/09/2026) ─────────────────────────────────────
  // O que o contrato exige em pessoas, por posto — e de onde saem as
  // solicitações de vaga. Mora no estado do modal porque o contrato NOVO
  // ainda não tem id: o quadro só pode ser gravado depois do upsert, e até
  // lá ele existe só aqui. Ver src/lib/licitacoes/quadroPostos.ts.
  const [quadro, setQuadro] = useState<LinhaQuadroForm[]>([]);
  const { data: quadroSalvo = [], isSuccess: quadroCarregou } = useContratoQuadro(editando?.id ?? null);
  const salvarQuadro = useContratoQuadroSalvar();
  const gerarVagas = useContratoQuadroGerarVagas();

  // Carrega o quadro do contrato quando ele chega do banco, UMA vez por
  // contrato — comparar por id evita sobrescrever o que a pessoa está
  // digitando a cada refetch.
  //
  // O `quadroCarregou` não é zelo: sem ele o efeito rodava na primeira
  // renderização, com a query ainda pendente e `quadroSalvo` vazio, marcava o
  // contrato como carregado e saía pela porta de cima quando os dados
  // chegavam. O quadro aparecia vazio em TODO contrato editado — e salvar
  // nesse estado mandaria uma lista vazia para `contrato_quadro_salvar`, que
  // desativa o que não veio no envio: o quadro inteiro do contrato apagado
  // por abrir e salvar a tela.
  const idQuadroCarregado = useRef<string | null>(null);
  useEffect(() => {
    if (!editando || !quadroCarregou) return;
    if (idQuadroCarregado.current === editando.id) return;
    idQuadroCarregado.current = editando.id;
    setQuadro(quadroSalvo.map(paraFormulario));
  }, [editando, quadroSalvo, quadroCarregou]);

  const geradasPorId = useMemo(() => {
    const m: Record<string, { geradas: number; vivas: number }> = {};
    for (const l of quadroSalvo) m[l.id] = { geradas: l.vagas_geradas, vivas: l.vagas_vivas };
    return m;
  }, [quadroSalvo]);

  // Quem pode MEXER no quadro (não só ver). Editar contrato existente pede
  // 'alterar'; contrato novo pede 'incluir' — é a mesma régua que a RPC
  // `contrato_quadro_salvar` aplica no banco, que é quem de fato recusa.
  const podeAlterarQuadro = useScreenAccess("contrato_quadro_postos", "alterar").data === true;
  const podeIncluirQuadro = useScreenAccess("contrato_quadro_postos", "incluir").data === true;
  const podeEditarQuadro = editando ? podeAlterarQuadro : podeIncluirQuadro;

  // Conferência do contrato + do quadro, para o card do topo e para o botão
  // de salvar. Os dois leem a MESMA função — um card que diz "completo" com
  // o botão desabilitado seria pior que card nenhum.
  const itensObrigatorios = useMemo(() => conferirContrato(form), [form]);
  const errosQuadro = useMemo(() => errosDoQuadro(quadro), [quadro]);
  const conferenciaQuadro = useMemo(
    () => conferirQuadroComContrato(quadro, form.quant_func_estipulado),
    [quadro, form.quant_func_estipulado],
  );
  const podeSalvar = contratoCompleto(form) && errosQuadro.length === 0;

  // Quantas vagas ainda faltam abrir — o que o botão anuncia e o que o
  // confirm pergunta. Desconta as já geradas: reabrir um contrato salvo não
  // pode prometer 30 vagas quando 30 já existem.
  const vagasPendentes = Math.max(
    totalDeVagas(quadro) - Object.values(geradasPorId).reduce((s, g) => s + g.geradas, 0),
    0,
  );

  // SIS-2026-0325: agregados por contrato (execução real/custo indireto/
  // lucro mensal, vindos ao vivo da Planilha de Custo) — substitui o
  // cálculo duplicado que existia só pra "Vlr. Mensal", reaproveitando os
  // helpers genéricos de usePlanilhaCusto.ts.
  const agregadosPorContrato = useMemo(() => {
    const map = new Map<string, { valorExecMensal: number; custoIndiretoMensal: number; lucroMensal: number; quantExecCalc: number }>();
    for (const c of contratos) {
      map.set(c.id, {
        valorExecMensal: somarValorExecutadoMensalContrato(planilha, c.id),
        custoIndiretoMensal: somarCustoIndiretoMensalContrato(planilha, c.id),
        lucroMensal: somarLucroMensalContrato(planilha, c.id),
        quantExecCalc: somarQuantFuncExecContrato(planilha, c.id),
      });
    }
    return map;
  }, [contratos, planilha]);

  // Agregado do contrato em edição no modal — "—" em contrato novo (sem
  // linhas na Planilha de Custo ainda vinculadas).
  const agregadoEditando = editando ? agregadosPorContrato.get(editando.id) : undefined;

  // Campos calculados do modal — derivados do `form` em edição, não
  // persistidos. Fórmulas seguem exatamente as legendas do mockup do
  // Iury (seções 2, 4, 5 e 6).
  const mesesExecucao = useMemo(() => {
    // "Calculado pela diferença entre vigência inicial e final"
    if (!form.vigencia_inicial || !form.vigencia_final) return 0;
    const inicio = new Date(form.vigencia_inicial + "T00:00:00");
    const fim = new Date(form.vigencia_final + "T00:00:00");
    return Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24 * 30)));
  }, [form.vigencia_inicial, form.vigencia_final]);

  const diasParaFinalizar = useMemo(() => {
    // "Calculado em relação à data atual"
    if (!form.vigencia_final) return 0;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const fim = new Date(form.vigencia_final + "T00:00:00");
    return Math.round((fim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  }, [form.vigencia_final]);

  // "Valor mensal ano atual contratado - Valor mensal ano anterior"
  const diferencaMensal = (form.valor_mensal_contratado ?? 0) - (form.valor_mensal_ano_anterior ?? 0);

  // Seção 5/6 — "Campos calculados automaticamente" a partir da Planilha
  // de Custo (agregadoEditando) + dos campos manuais do form.
  const valorExecMensalCalc = agregadoEditando?.valorExecMensal ?? 0;
  const custoIndiretoMensalCalc = agregadoEditando?.custoIndiretoMensal ?? 0;
  const lucroMensalCalc = agregadoEditando?.lucroMensal ?? 0;
  const totalLucroCustoMensal = custoIndiretoMensalCalc + lucroMensalCalc; // "Custo ind. mensal + Lucro mensal"
  // "Valor executado ano atual / Quant. Func. Exec."
  const valorPorColaborador = form.quant_func_exec ? (form.valor_executado_mensal ?? 0) / form.quant_func_exec : 0;
  // "Total lucro e custo mensal / Quant. Func. Estip."
  const mediaCustoLucroPorFuncionario = form.quant_func_estipulado ? totalLucroCustoMensal / form.quant_func_estipulado : 0;

  const [aba, setAba] = useState<"execucao_real" | "em_vigencia" | "a_vencer" | "finalizados">("execucao_real");

  // Critério de cada aba — provisório, a ajustar com o usuário depois de
  // ver a tela funcionando (ver "Perguntas em Aberto" do plano do
  // SIS-2026-0325: não veio no texto do chamado, só no mockup visual).
  const filtered = useMemo(() => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const em90dias = new Date(hoje); em90dias.setDate(em90dias.getDate() + 90);
    return contratos.filter((c) => {
      if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
      if (filtroEmpresaId !== "todas" && c.empresa_id !== filtroEmpresaId) return false;
      if (busca) {
        const q = busca.toLowerCase();
        if (!c.nome.toLowerCase().includes(q) && !c.cliente.toLowerCase().includes(q)) return false;
      }
      const fimVigencia = c.vigencia_final ? new Date(c.vigencia_final + "T00:00:00") : null;
      if (aba === "finalizados") return c.status === "encerrado";
      if (c.status === "encerrado") return false;
      if (aba === "execucao_real") return true;
      if (aba === "em_vigencia") return !fimVigencia || fimVigencia >= hoje;
      if (aba === "a_vencer") return !!fimVigencia && fimVigencia >= hoje && fimVigencia <= em90dias;
      return true;
    });
  }, [contratos, busca, filtroStatus, filtroEmpresaId, aba]);

  // KPIs do mockup 2 — somados sobre a aba/filtro atual (`filtered`), não
  // sobre todos os contratos, pra bater com o que a tabela abaixo mostra.
  const kpiValorMensalContratado = filtered.reduce((s, c) => s + (c.valor_mensal_contratado ?? 0), 0);
  const kpiValorExecutadoAnoAtual = filtered.reduce((s, c) => s + (c.valor_executado_mensal ?? 0), 0);
  const kpiLucroMensal = filtered.reduce((s, c) => s + (agregadosPorContrato.get(c.id)?.lucroMensal ?? 0), 0);
  const kpiLucroECustoMensal = filtered.reduce((s, c) => {
    const ag = agregadosPorContrato.get(c.id);
    return s + (ag?.custoIndiretoMensal ?? 0) + (ag?.lucroMensal ?? 0);
  }, 0);

  // Subtotais da tabela — "TOTAL GERAL" + 1 linha por empresa, sobre o
  // conjunto atualmente filtrado/exibido (mesma lógica dos KPIs acima).
  const subtotalCampos = (rows: ContratoERP[]) => ({
    mesesExecucao: rows.reduce((s, c) => s + vigenciaInfo(c).mesesExecucao, 0),
    diasParaFinalizar: rows.reduce((s, c) => s + (vigenciaInfo(c).diasParaFinalizar ?? 0), 0),
    valorGarantia: rows.reduce((s, c) => s + (c.valor_garantia_contratual ?? 0), 0),
    quantFuncEstip: rows.reduce((s, c) => s + (c.quant_func_estipulado ?? 0), 0),
    valorMensalContratado: rows.reduce((s, c) => s + (c.valor_mensal_contratado ?? 0), 0),
    valorExecutadoAnoAtual: rows.reduce((s, c) => s + (c.valor_executado_mensal ?? 0), 0),
  });
  const totalGeral = subtotalCampos(filtered);
  const subtotaisPorEmpresa = empresasGrupo
    .map((e) => ({ empresa: e, linhas: filtered.filter((c) => c.empresa_id === e.id) }))
    .filter((g) => g.linhas.length > 0)
    .map((g) => ({ empresa: g.empresa, ...subtotalCampos(g.linhas) }));

  function irParaLista(filtro?: FiltroDashboard) {
    if (filtro?.aba) setAba(filtro.aba);
    if (filtro?.empresaId) setFiltroEmpresaId(filtro.empresaId);
    setViewTab("lista");
  }

  function abrirNovo() {
    setEditando(null);
    setForm(EMPTY);
    setFiscal(FISCAL_EMPTY);
    // Contrato novo começa com o quadro vazio — e `idQuadroCarregado` volta a
    // null para que o efeito carregue o quadro do próximo contrato editado.
    setQuadro([]);
    idQuadroCarregado.current = null;
    setModalOpen(true);
  }

  function abrirEditar(c: ContratoERP) {
    setEditando(c);
    if (idQuadroCarregado.current !== c.id) {
      // Zera enquanto o quadro do contrato escolhido não chega: sem isto o
      // modal abriria mostrando o quadro do contrato anterior.
      setQuadro([]);
      idQuadroCarregado.current = null;
    }
    setForm({
      empresa_id: c.empresa_id,
      nome: c.nome,
      cliente: c.cliente,
      cnpj_cliente: c.cnpj_cliente,
      vigencia_meses: c.vigencia_meses,
      data_inicio: c.data_inicio,
      status: c.status,
      grade_id: c.grade_id,
      capa_id: c.capa_id,
      cidade: c.cidade,
      numero_edital: c.numero_edital,
      data_fim_vigencia: c.data_fim_vigencia,
      vigencia_inicial: c.vigencia_inicial,
      vigencia_final: c.vigencia_final,
      quant_func_estipulado: c.quant_func_estipulado,
      quant_func_exec: c.quant_func_exec,
      quant_func_exec_real: c.quant_func_exec_real,
      valor_mensal_contratado: c.valor_mensal_contratado,
      valor_executado_mensal: c.valor_executado_mensal,
      valor_mensal_ano_anterior: c.valor_mensal_ano_anterior,
      valor_garantia_contratual: c.valor_garantia_contratual,
      custo_anual_insumos: c.custo_anual_insumos,
      status_solicitacao: c.status_solicitacao,
    });
    setFiscal(fiscalParaForm(c));
    setModalOpen(true);
  }

  async function handleSalvar() {
    // Até 24/09/2026 a única conferência era a empresa — os "*" do formulário
    // eram decorativos, e contrato sem vigência, sem valor e sem quantidade
    // de funcionários entrava. Agora o card de obrigatórios diz o que falta e
    // o botão espera; a lista das pendências está em conferirContrato().
    const pendentes = conferirContrato(form).filter(i => !i.ok);
    if (pendentes.length) {
      toast({
        title: "Faltam informações obrigatórias",
        description: pendentes.map(p => p.campo).join(", "),
        variant: "destructive",
      });
      return;
    }
    const errosQuadro = errosDoQuadro(quadro);
    if (errosQuadro.length) {
      toast({ title: "Quadro de postos incompleto", description: errosQuadro[0], variant: "destructive" });
      return;
    }

    // Quantas vagas a gravação vai abrir. Perguntar ANTES é deliberado: são
    // 30 solicitações caindo na fila do analista de uma vez, e "criei e
    // avisei depois" transformaria um erro de digitação (300 em vez de 30)
    // em 300 vagas para cancelar uma a uma.
    const vagasAAbrir = vagasPendentes;
    if (vagasAAbrir > 0 && !confirm(
      `Salvar o contrato e abrir ${vagasAAbrir} solicitaç${vagasAAbrir === 1 ? "ão" : "ões"} de vaga no Recrutamento?\n\n` +
      `As vagas nascem em "Pendente Analista" e seguem o fluxo normal — o analista aprova, o Recrutamento toca.`,
    )) return;

    const pctToNum = (v: string) => (v.trim() ? Number(v) / 100 : 0);
    const contratoId = await upsert.mutateAsync({
      ...form,
      issqn_pct: pctToNum(fiscal.issqn_pct),
      ir_pct: pctToNum(fiscal.ir_pct),
      cofins_pct: pctToNum(fiscal.cofins_pct),
      pis_pct: pctToNum(fiscal.pis_pct),
      csll_pct: pctToNum(fiscal.csll_pct),
      prazo_pagamento: fiscal.prazo_pagamento || null,
      codigo_servico_lc116: fiscal.codigo_servico_lc116 || null,
      codigo_servico_municipal_cnae: fiscal.codigo_servico_municipal_cnae || null,
      conta_pagamento: fiscal.conta_pagamento || null,
      email_envio_nf: fiscal.email_envio_nf || null,
      instrucoes_envio: fiscal.instrucoes_envio || null,
      id: editando?.id,
    });

    // O quadro é gravado DEPOIS do contrato, e não junto, porque o contrato
    // novo só ganha id aqui. Falhar no quadro não desfaz o contrato (não há
    // transação entre dois round-trips do PostgREST): o contrato fica salvo,
    // a tela continua aberta e o erro diz o que corrigir — melhor que perder
    // o cadastro inteiro por causa de uma linha de posto.
    if (quadro.length || quadroSalvo.length) {
      try {
        await salvarQuadro.mutateAsync({ contratoId, linhas: paraPayload(quadro) });
      } catch {
        toast({
          title: "Contrato salvo, mas o quadro de postos não",
          description: "Corrija o quadro e salve de novo — o contrato já está gravado.",
          variant: "destructive",
        });
        return;
      }

      if (vagasAAbrir > 0) {
        try {
          const r = await gerarVagas.mutateAsync({ contratoId });
          const criadas = somarCriadas(r);
          toast({
            title: criadas ? `${criadas} solicitaç${criadas === 1 ? "ão" : "ões"} de vaga aberta${criadas === 1 ? "" : "s"}` : "Nenhuma vaga nova",
            description: criadas
              ? r.filter(x => x.criadas > 0).map(x => `${x.posto_nome}: ${x.criadas}`).join(" · ")
              : "Os postos do quadro já tinham as vagas abertas.",
          });
        } catch {
          // O toast do erro já saiu no onError do hook. O contrato e o quadro
          // estão salvos — reabrir e clicar de novo gera só o que falta
          // (quadro_posto_id + quadro_indice tornam a geração repetível).
          return;
        }
      }
    }

    setModalOpen(false);
  }

  function field(label: string, key: keyof ContratoERPInput, opts?: { type?: string; required?: boolean }) {
    const val = form[key];
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{label}{opts?.required && <span className="text-destructive ml-0.5">*</span>}</Label>
        <Input
          type={opts?.type ?? "text"}
          value={val === null || val === undefined ? "" : String(val)}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = opts?.type === "number" ? (raw === "" ? null : Number(raw)) : (raw || null);
            setForm((f) => ({ ...f, [key]: parsed }));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Contratos"
        subtitle="Gestão dos contratos ativos da empresa."
        actions={
          <Button size="sm" onClick={abrirNovo}>
            <Plus className="h-4 w-4 mr-1" /> Novo Contrato
          </Button>
        }
      />

      {/* SIS-2026-0325 (dashboard): Dashboard convive com a Lista via aba no
          topo — os cards do Dashboard levam pra Lista com filtro aplicado
          via irParaLista(). */}
      <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as typeof viewTab)}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="lista">Lista</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="pt-4">
          <ContratosDashboardTab
            contratos={contratos}
            empresasGrupo={empresasGrupo}
            agregadosPorContrato={agregadosPorContrato}
            onVerLista={irParaLista}
          />
        </TabsContent>

        <TabsContent value="lista" className="flex flex-col gap-6 pt-4">

      {/* KPIs — SIS-2026-0325 (mockup 2): somados sobre a aba/filtro atual. */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard icon={<FileText />} label="Total de Contratos" value={String(filtered.length)} color="slate" />
        <KpiCard icon={<Building2 />} label="Valor Mensal Ano Atual" value={fmt(kpiValorMensalContratado)} color="blue" />
        <KpiCard icon={<TrendingUp />} label="Valor Executado Ano Atual" value={fmt(kpiValorExecutadoAnoAtual)} color="emerald" />
        <KpiCard icon={<CalendarDays />} label="Lucro Mensal" value={fmt(kpiLucroMensal)} color="amber" />
        <KpiCard icon={<Archive />} label="Lucro e Custo Mensal" value={fmt(kpiLucroECustoMensal)} color="slate" />
      </div>

      {/* Abas */}
      <Tabs value={aba} onValueChange={(v) => setAba(v as typeof aba)}>
        <TabsList>
          <TabsTrigger value="execucao_real">Execução Real</TabsTrigger>
          <TabsTrigger value="em_vigencia">Em Vigência</TabsTrigger>
          <TabsTrigger value="a_vencer">A Vencer</TabsTrigger>
          <TabsTrigger value="finalizados">Finalizados</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Buscar por nome ou cliente..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-72 h-8 text-sm"
        />
        {(["todos", "ativo", "suspenso", "encerrado"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFiltroStatus(s)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              filtroStatus === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {s === "todos" ? "Todos" : STATUS_LABEL[s]}
          </button>
        ))}
        <Select value={filtroEmpresaId} onValueChange={setFiltroEmpresaId}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresasGrupo.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <Building2 className="h-10 w-10 opacity-20" />
          <p className="text-sm">Nenhum contrato encontrado.</p>
          <Button size="sm" variant="outline" onClick={abrirNovo}>Cadastrar primeiro contrato</Button>
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[78vh] rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-left text-xs text-muted-foreground whitespace-nowrap">
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Contrato</th>
                <th className="px-4 py-3 font-medium">Cidade</th>
                <th className="px-4 py-3 font-medium">Data Início</th>
                <th className="px-4 py-3 font-medium">Data Fim Vigência</th>
                <th className="px-4 py-3 font-medium">Aviso de Vigência</th>
                <th className="px-4 py-3 font-medium">Vigência Inicial</th>
                <th className="px-4 py-3 font-medium">Vigência Final</th>
                <th className="px-4 py-3 font-medium text-right">Meses de Execução</th>
                <th className="px-4 py-3 font-medium text-right">Dias p/ Finalizar</th>
                <th className="px-4 py-3 font-medium text-right">Vlr. Garantia Contratual</th>
                <th className="px-4 py-3 font-medium">Nº Edital</th>
                <th className="px-4 py-3 font-medium text-right">Qtd. Func. Estip.</th>
                <th className="px-4 py-3 font-medium text-right">Vlr. Mensal Ano Atual Contratado</th>
                <th className="px-4 py-3 font-medium text-right">Vlr. Executado Ano Atual</th>
                <th className="px-4 py-3 font-medium text-right">Custo Indireto Mensal</th>
                <th className="px-4 py-3 font-medium text-right">Custo Indireto Global</th>
                <th className="px-4 py-3 font-medium text-right">Lucro Mensal</th>
                <th className="px-4 py-3 font-medium text-right">Lucro Global</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Status Solicitação</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="sticky right-0 z-[15] w-20 bg-muted/50 px-3 py-3 font-medium shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => {
                const ag = agregadosPorContrato.get(c.id);
                const vi = vigenciaInfo(c);
                return (
                <tr
                  key={c.id}
                  className={cn(
                    "transition-colors whitespace-nowrap hover:brightness-95 dark:hover:brightness-125",
                    corEmpresaFundo(c.empresa_id),
                    c.status === "encerrado" && "opacity-50"
                  )}
                >
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", corEmpresa(c.empresa_id))}>
                      {empresasGrupo.find((e) => e.id === c.empresa_id)?.nome ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{c.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.cidade ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtData(c.data_inicio)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtData(c.data_fim_vigencia)}</td>
                  <td className="px-4 py-3">
                    {vi.avisoVigencia ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                        <span className={cn("h-2 w-2 rounded-full", AVISO_VIGENCIA_COLOR[vi.avisoVigencia])} />
                        {AVISO_VIGENCIA_LABEL[vi.avisoVigencia]}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtData(c.vigencia_inicial)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtData(c.vigencia_final)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{vi.mesesExecucao}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{vi.diasParaFinalizar ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(c.valor_garantia_contratual)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.numero_edital ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{c.quant_func_estipulado ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(c.valor_mensal_contratado)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(c.valor_executado_mensal)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(ag?.custoIndiretoMensal ?? null)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt((ag?.custoIndiretoMensal ?? 0) * 12)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(ag?.lucroMensal ?? null)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt((ag?.lucroMensal ?? 0) * 12)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.cliente}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate" title={c.status_solicitacao ?? undefined}>{c.status_solicitacao ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLOR[c.status])}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  {/* Coluna de ações fixa na direita — com 23 colunas na
                      tabela, deixar solta no fim exigia rolar até lá pra
                      editar/excluir, e os ícones (text-muted-foreground,
                      3.5) ficavam quase invisíveis em cima do fundo colorido
                      por empresa (corEmpresaFundo). */}
                  <td className="sticky right-0 z-[5] bg-background px-3 py-3 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">
                    <div className="flex gap-1.5">
                      {/* Fundo sólido + ícone branco de propósito (não um
                          tom pastel com ícone na mesma cor) — um ícone
                          escuro sobre fundo claro da mesma família de cor
                          estava sumindo em telas/capturas pequenas por
                          baixo contraste. Branco sobre cor sólida é o
                          contraste máximo possível aqui. */}
                      <button
                        onClick={() => abrirEditar(c)}
                        className="flex items-center justify-center rounded-md bg-blue-600/60 p-1.5 text-white hover:bg-blue-600/90"
                        title="Editar contrato"
                      >
                        <Pencil className="h-4 w-4 shrink-0 text-white" strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        className="flex items-center justify-center rounded-md bg-red-600/60 p-1.5 text-white hover:bg-red-600/90"
                        title="Excluir contrato"
                      >
                        <Trash2 className="h-4 w-4 shrink-0 text-white" strokeWidth={2.5} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
            {/* SIS-2026-0325 (mockup 2): linha de total geral + 1 por
                empresa, somando o mesmo conjunto filtrado da tabela. O
                detalhe por empresa vem recolhido por padrão — com várias
                empresas ele sozinho já empurra o rodapé pra fora da tela,
                então só o TOTAL GERAL fica sempre visível. */}
            <tfoot className="sticky bottom-0 z-10 divide-y divide-border border-t-2 border-border bg-background text-xs font-semibold">
              <tr
                className="whitespace-nowrap cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setMostrarSubtotalPorEmpresa((v) => !v)}
                title={mostrarSubtotalPorEmpresa ? "Ocultar detalhe por empresa" : "Ver detalhe por empresa"}
              >
                <td className="px-4 py-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 hover:border-primary/50 hover:text-primary">
                    {mostrarSubtotalPorEmpresa ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    TOTAL GERAL
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {subtotaisPorEmpresa.length} {subtotaisPorEmpresa.length === 1 ? "empresa" : "empresas"}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5 text-right">{totalGeral.mesesExecucao}</td>
                <td className="px-4 py-1.5 text-right">{totalGeral.diasParaFinalizar}</td>
                <td className="px-4 py-1.5 text-right font-mono">{fmt(totalGeral.valorGarantia)}</td>
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5 text-right">{totalGeral.quantFuncEstip}</td>
                <td className="px-4 py-1.5 text-right font-mono">{fmt(totalGeral.valorMensalContratado)}</td>
                <td className="px-4 py-1.5 text-right font-mono">{fmt(totalGeral.valorExecutadoAnoAtual)}</td>
                <td className="px-4 py-1.5" colSpan={7} />
                <td className="sticky right-0 z-[5] bg-background px-3 py-1.5 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]" />
              </tr>
              {mostrarSubtotalPorEmpresa && subtotaisPorEmpresa.map((s) => (
                <tr key={s.empresa.id} className="whitespace-nowrap text-muted-foreground font-normal">
                  <td className="px-4 py-1.5" colSpan={2}>{s.empresa.nome}</td>
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5 text-right">{s.mesesExecucao}</td>
                  <td className="px-4 py-1.5 text-right">{s.diasParaFinalizar}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{fmt(s.valorGarantia)}</td>
                  <td className="px-4 py-1.5" />
                  <td className="px-4 py-1.5 text-right">{s.quantFuncEstip}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{fmt(s.valorMensalContratado)}</td>
                  <td className="px-4 py-1.5 text-right font-mono">{fmt(s.valorExecutadoAnoAtual)}</td>
                  <td className="px-4 py-1.5" colSpan={7} />
                  <td className="sticky right-0 z-[5] bg-background px-3 py-1.5 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]" />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
        </TabsContent>
      </Tabs>

      {/* Modal "Novo Contrato" — SIS-2026-0325: reorganizado nas 6 seções
          numeradas do mockup do Iury (não é mais o dialog simples de
          antes). Dados Fiscais e Documentos seguem depois, como seções
          extras — são funcionalidade real (Emissão de NF) que não estava
          no mockup, mas precisa continuar existindo em algum lugar. */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Contrato" : "Novo Contrato"}</DialogTitle>
          </DialogHeader>

          {/* Duas colunas: o que FALTA à esquerda, fixo, e o formulário à
              direita. O modal é longo (sete seções mais os Dados Fiscais) e o
              botão "Salvar" fica lá embaixo — com o card só no topo, ele já
              tinha rolado para fora da tela justamente na hora de salvar.

              O `sticky` funciona porque quem rola é o DialogContent: a coluna
              gruda no topo da área visível dele. `items-start` é o que dá à
              <aside> a altura do próprio conteúdo — sem isso ela estica até o
              fim do flex e o sticky não tem folga para deslizar. */}
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <aside className="md:sticky md:top-0 md:w-60 md:shrink-0 lg:w-64">
              <CardObrigatorios
                itens={itensObrigatorios}
                errosQuadro={errosQuadro}
                avisoQuadro={conferenciaQuadro.aviso}
              />
            </aside>

            {/* min-w-0: sem isso o conteúdo da direita (tabelas, inputs
                largos) impede o flex de encolher e a coluna da esquerda some
                empurrada para fora. */}
            <div className="min-w-0 flex-1 space-y-3">
          <SectionHeader n={1} title="Dados do Contrato" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* SIS-2026-0309: empresa passa a ser campo explícito na
                criação/edição — deixou de ser herdada do seletor "empresa
                ativa" (era exatamente esse padrão que causou o contrato
                CEITEC nascer na empresa errada). */}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Empresa *</Label>
              <Select value={form.empresa_id} onValueChange={(v) => setForm((f) => ({ ...f, empresa_id: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a empresa..." /></SelectTrigger>
                <SelectContent>
                  {empresasGrupo.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {field("Contrato", "nome", { required: true })}
            {field("Nº Edital", "numero_edital", { required: true })}
            {field("Cidade", "cidade", { required: true })}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Status da Solicitação *</Label>
              <Input
                className="h-9"
                placeholder="Ex: OK - EMITIDO, AGUARDANDO EMPENHO..."
                value={form.status_solicitacao ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, status_solicitacao: e.target.value || null }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Status</Label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ContratoERP["status"] }))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="ativo">Ativo</option>
                <option value="suspenso">Suspenso</option>
                <option value="encerrado">Encerrado</option>
              </select>
            </div>
            {/* Não está no mockup — mas `cliente` é obrigatório no banco e
                usado na Emissão de NF (decisão confirmada com o usuário:
                manter mesmo fora da grade de 5 colunas do Iury). */}
            <div className="col-span-2 md:col-span-3">{field("Cliente (Órgão)", "cliente", { required: true })}</div>
            <div className="col-span-2 md:col-span-3">{field("CNPJ do Cliente", "cnpj_cliente")}</div>
          </div>

          <SectionHeader n={2} title="Vigência e Prazos" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field("Data Início", "data_inicio", { type: "date", required: true })}
            {field("Data Fim Vigência", "data_fim_vigencia", { type: "date", required: true })}
            {field("Vigência Inicial", "vigencia_inicial", { type: "date", required: true })}
            {field("Vigência Final", "vigencia_final", { type: "date", required: true })}
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
            <CalculoField label="Meses de Execução" value={String(mesesExecucao)} hint="Calculado pela diferença entre vigência inicial e final" />
            <CalculoField label="Dias para Finalizar Contrato" value={String(diasParaFinalizar)} hint="Calculado em relação à data atual" />
          </div>

          <SectionHeader n={3} title="Equipe e Execução" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field("Qtd. Func. Estip.", "quant_func_estipulado", { type: "number", required: true })}
            {field("Qtd. Func. Exec.", "quant_func_exec", { type: "number", required: true })}
            {field("Qtd. Func. Exec. Real", "quant_func_exec_real", { type: "number" })}
            {field("Valor da Garantia Contratual", "valor_garantia_contratual", { type: "number" })}
          </div>

          <SectionHeader n={4} title="Valores Mensais" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {field("Valor Mensal Contratado", "valor_mensal_contratado", { type: "number", required: true })}
            {field("Valor Executado Mensal", "valor_executado_mensal", { type: "number", required: true })}
            {field("Valor Mensal (Ano Anterior)", "valor_mensal_ano_anterior", { type: "number" })}
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
            <CalculoField label="Diferença Mensal" value={fmt(diferencaMensal)} hint="Valor mensal ano atual contratado - Valor mensal ano anterior" />
          </div>
          {/* Excluído do v1 por pedido explícito do usuário: "Diferença até
              apostilamento" e "Valor efetivo faturado". */}

          {/* SIS-2026-0325: banner "Campos calculados automaticamente" do
              mockup — custo indireto/lucro/valor executado (conferência)
              saem ao vivo da Planilha de Custo (agregadoEditando) e só
              existem depois que o contrato já tem linhas vinculadas (por
              isso ficam zerados em contrato novo, antes de salvar).
              `custo_anual_insumos` é exceção: continua manual (decisão já
              confirmada antes), só está posicionado aqui por ficar perto
              dos outros campos de custo no mockup. */}
          <SectionHeader n={5} title="Custos, Lucro e Indicadores" />
          <div className="rounded-lg bg-blue-50 text-blue-700 text-xs px-3 py-2">
            Campos calculados automaticamente — os valores abaixo são calculados com base nos dados informados
            (exceto "Custo anual de insumos", que é manual).
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <CalculoField label="Valor Mão de Obra / Valor Mensal" value={fmt(valorExecMensalCalc)} />
            {field("Custo Anual de Insumos", "custo_anual_insumos", { type: "number" })}
            <CalculoField label="Custo Ind. Mensal" value={fmt(custoIndiretoMensalCalc)} />
            <CalculoField label="Lucro Mensal" value={fmt(lucroMensalCalc)} />
            <CalculoField label="Total Lucro e Custo Mensal" value={fmt(totalLucroCustoMensal)} hint="Custo ind. mensal + Lucro mensal" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3">
            <CalculoField label="Valor por Colaborador" value={fmt(valorPorColaborador)} hint="Valor executado ano atual / Quant. Func. Exec." />
            <CalculoField label="Média Custo e Lucro por Funcionário" value={fmt(mediaCustoLucroPorFuncionario)} hint="Total lucro e custo mensal / Quant. Func. Estip." />
            <CalculoField label="Valor Lucro c/Cto Mensal" value={fmt(totalLucroCustoMensal)} />
          </div>

          <SectionHeader n={6} title="Totais Globais" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-lg bg-muted/40 p-3">
            <CalculoField label="Total Global" value={fmt(valorExecMensalCalc * 12)} />
            <CalculoField label="Custo Global" value={fmt(custoIndiretoMensalCalc * 12)} />
            <CalculoField label="Lucro Global" value={fmt(lucroMensalCalc * 12)} />
            <CalculoField label="Total Lucro e Custo Global" value={fmt(totalLucroCustoMensal * 12)} />
          </div>

          {/* ── Quadro de Postos (24/09/2026) ─────────────────────────────
              O que o contrato exige em pessoas, posto a posto — e de onde
              saem as solicitações de vaga do Recrutamento. Fica DEPOIS dos
              números do contrato de propósito: a quantidade estipulada da
              seção 3 é a referência contra a qual o quadro é conferido.

              Bloco com visibilidade própria: o menu fantasma
              `contrato_quadro_postos` (migration 20260930000238) decide quem
              vê e quem edita, no painel de Acesso por Usuário. */}
          <AcessoGate
            menu="contrato_quadro_postos"
            acao="visualizar"
            fallback={null}
          >
            <SectionHeader n={7} title="Quadro de Postos e Vagas" />
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Declare quantas pessoas o contrato exige, por <b>posto</b> e <b>função</b> — a mesma
              cascata do Catálogo de Materiais. Cada colaborador vira uma solicitação de vaga no
              Recrutamento (com salário, benefícios, escala e local já preenchidos, e vinculada à
              função, que é de onde sai o enxoval de uniforme e EPI) e segue o fluxo normal a
              partir de "Pendente Analista".
              {!editando && " As vagas são abertas quando você salvar o contrato."}
            </div>
            <QuadroPostosContrato
              contratoId={editando?.id ?? null}
              contratoNome={form.nome ?? ""}
              linhas={quadro}
              onChange={setQuadro}
              geradasPorId={geradasPorId}
              somenteLeitura={!podeEditarQuadro}
            />
          </AcessoGate>

          <div className="space-y-3 border-t border-border pt-4">
              <div>
                <h4 className="text-sm font-semibold">Dados Fiscais (Emissão de NF)</h4>
                <p className="text-xs text-muted-foreground">
                  Reaproveitados automaticamente em toda NF emitida para este contrato. INSS não entra
                  aqui — é definido por categoria de risco em cada item da NF (alíquota padrão fixa).
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">ISSQN %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.issqn_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, issqn_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">IR %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.ir_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, ir_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">COFINS %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.cofins_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, cofins_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">PIS %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.pis_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, pis_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">CSLL %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.csll_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, csll_pct: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Prazo de Pagamento</Label>
                  <Input className="h-9" placeholder="Ex: ATÉ 15 DIAS MÊS SUBSEQUENTE" value={fiscal.prazo_pagamento}
                    onChange={(e) => setFiscal((f) => ({ ...f, prazo_pagamento: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Conta para Pagamento</Label>
                  <Input className="h-9" placeholder="Ex: BANRISUL AG: 0949 / CC: 06.1421700-6" value={fiscal.conta_pagamento}
                    onChange={(e) => setFiscal((f) => ({ ...f, conta_pagamento: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Código do Serviço (LC 116)</Label>
                  <Input className="h-9" value={fiscal.codigo_servico_lc116}
                    onChange={(e) => setFiscal((f) => ({ ...f, codigo_servico_lc116: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Cód. Serviço Municipal / CNAE</Label>
                  <Input className="h-9" value={fiscal.codigo_servico_municipal_cnae}
                    onChange={(e) => setFiscal((f) => ({ ...f, codigo_servico_municipal_cnae: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">E-mail de Envio da NF</Label>
                  <Input type="email" className="h-9" value={fiscal.email_envio_nf}
                    onChange={(e) => setFiscal((f) => ({ ...f, email_envio_nf: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Instruções de Envio</Label>
                <Textarea
                  rows={2}
                  placeholder="Instruções gerais sobre a emissão desta NF. Nunca inclua login ou senha de portais externos aqui."
                  value={fiscal.instrucoes_envio}
                  onChange={(e) => setFiscal((f) => ({ ...f, instrucoes_envio: e.target.value }))}
                />
              </div>
            </div>

          {editando && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold">Documentos Exigidos</h4>
                  <p className="text-xs text-muted-foreground">
                    Somente consulta — a configuração é feita em Documentos.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/app/documentos?contrato=${editando.id}`)}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Gerenciar documentos
                </Button>
              </div>

              {docsContrato.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground italic py-2">
                  <FileText className="h-3.5 w-3.5" /> Nenhum documento configurado ainda.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {docsContrato.map((d) => {
                    const label = periodLabel(d);
                    return (
                      <div key={d.id} className="flex items-center gap-2 flex-wrap text-xs rounded-md border border-border px-3 py-1.5">
                        <span className="font-medium">{d.doc_tipos?.nome ?? "—"}</span>
                        {d.posto && (
                          <span className="text-[10px] text-muted-foreground">· {d.posto}</span>
                        )}
                        {label && (
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", DOC_BADGE[d.periodicidade!] ?? "bg-muted text-muted-foreground")}>
                            {label}
                          </span>
                        )}
                        {!d.obrigatorio && <span className="text-[10px] text-muted-foreground italic">opcional</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSalvar}
              // Mesma conferência da coluna da esquerda — ver `podeSalvar`.
              disabled={!podeSalvar || upsert.isPending || salvarQuadro.isPending || gerarVagas.isPending}
            >
              {upsert.isPending || salvarQuadro.isPending ? "Salvando…"
                : gerarVagas.isPending ? "Abrindo vagas…"
                  : vagasPendentes > 0 ? `Salvar e abrir ${vagasPendentes} vaga${vagasPendentes === 1 ? "" : "s"}`
                    : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.nome}" será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                await del.mutateAsync(deleteTarget!.id);
                setDeleteTarget(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-500",
    blue: "text-blue-500",
    amber: "text-amber-500",
    slate: "text-slate-400",
  };
  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 flex flex-col min-h-[90px]">
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 opacity-100"
        style={{
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className={cn("[&>svg]:h-24 [&>svg]:w-24", colors[color])}>{icon}</span>
      </div>
      <p className="relative z-10 text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
      <p className="relative z-10 text-2xl font-bold text-slate-900 leading-none">{value}</p>
    </div>
  );
}

// Cabeçalho numerado das 6 seções do modal "Novo Contrato" — mesma
// estrutura do mockup do Iury (SIS-2026-0325).
function SectionHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
        {n}
      </span>
      <h4 className="text-sm font-semibold">{title}</h4>
    </div>
  );
}

// Campo somente-leitura calculado ao vivo da Planilha de Custo — usado no
// modal de edição pra mostrar valor executado/custo indireto/lucro sem
// permitir edição direta (a fonte é planilha_custo, não `contratos`).
function CalculoField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium">{value}</span>
      {hint && <span className="text-[10px] italic text-muted-foreground">{hint}</span>}
    </div>
  );
}
