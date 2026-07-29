import { createContext, useContext, useEffect, useState } from "react";
import type { AapDados, Solicitacao } from "./types";
import { calcPrioridade, calcComplexidade, calcPrazo } from "./PtvDocumento";
import { CLASSIFICACAO_DEMANDA_OPCOES, TIPO_SOLICITACAO_LABEL, fmtData, sdNumero } from "./types";

// ── Critério principal de prioridade ──────────────────────────────────────────

const GRUPO1 = ["obrigatoriedade_legal_prazo","risco_paralisacao","impossibilidade_faturamento","falha_critica_funcionamento","risco_juridico_trabalhista","determinacao_presidencia"];
const GRUPO2 = ["correcao_bug_escopo","alto_impacto_operacional","alto_usuarios_impactados","reducao_retrabalho","automacao_processo_critico","integracao_rotina_relevante","impacto_cliente_contrato"];
const GRUPO3 = ["projeto_planejamento_estrategico","projeto_aprovado_presidencia","novo_modulo_corporativo","implantacao_indicadores","projeto_multi_diretoria"];
const GRUPO4 = ["ganho_operacional_relevante","melhoria_processo_existente","reducao_controles_manuais","melhor_rastreabilidade","melhoria_indicadores","melhoria_comunicacao_areas"];

const CRITERIO_LABEL: Record<string, string> = {
  obrigatoriedade_legal_prazo: "Obrigatoriedade legal com prazo",
  risco_paralisacao: "Risco de paralisação da operação",
  impossibilidade_faturamento: "Impossibilidade de faturamento",
  falha_critica_funcionamento: "Falha crítica de funcionamento",
  risco_juridico_trabalhista: "Risco jurídico ou trabalhista",
  determinacao_presidencia: "Determinação da Presidência",
  correcao_bug_escopo: "Correção de bug crítico",
  alto_impacto_operacional: "Impacto Operacional Relevante",
  alto_usuarios_impactados: "Alto número de usuários impactados",
  reducao_retrabalho: "Redução de retrabalho",
  automacao_processo_critico: "Automação de processo crítico",
  integracao_rotina_relevante: "Integração a rotina relevante",
  impacto_cliente_contrato: "Impacto em cliente ou contrato",
  projeto_planejamento_estrategico: "Projeto de planejamento estratégico",
  projeto_aprovado_presidencia: "Projeto aprovado pela Presidência",
  novo_modulo_corporativo: "Novo módulo corporativo",
  implantacao_indicadores: "Implantação de indicadores",
  projeto_multi_diretoria: "Projeto multi-diretoria",
  ganho_operacional_relevante: "Ganho operacional relevante",
  melhoria_processo_existente: "Melhoria de processo existente",
  reducao_controles_manuais: "Redução de controles manuais",
  melhor_rastreabilidade: "Melhoria de rastreabilidade",
  melhoria_indicadores: "Melhoria de indicadores",
  melhoria_comunicacao_areas: "Melhoria de comunicação entre áreas",
};

function principalCriterio(criterios: string[]): string {
  const todos = [...GRUPO1, ...GRUPO2, ...GRUPO3, ...GRUPO4];
  const primeiro = todos.find((k) => criterios.includes(k));
  return primeiro ? (CRITERIO_LABEL[primeiro] ?? primeiro) : "—";
}

// ── Constantes de opções ──────────────────────────────────────────────────────

const MOTIVOS_NAO_APTA = [
  { k: "anexo1_incompleto", l: "Anexo I incompleto" },
  { k: "pendencia_tecnica", l: "Pendência técnica" },
  { k: "anexo2_incompleto", l: "Anexo II incompleto" },
  { k: "pendencia_responsavel", l: "Pendência de definição de responsável" },
  { k: "anexo3_incompleto", l: "Anexo III incompleto" },
  { k: "desenvolvimento_backlog", l: "Desenvolvimento em backlog" },
  { k: "parecer_inconclusivo", l: "Parecer técnico inconclusivo" },
  { k: "pendencia_aprovacao_superior", l: "Pendência de aprovação superior" },
  { k: "pendencia_funcional", l: "Pendência funcional" },
  { k: "outro", l: "Outro:" },
];

const DECISAO_COL1 = [
  { k: "aprovada_desenvolvimento", l: "Aprovada para desenvolvimento" },
  { k: "aprovada_ressalvas", l: "Aprovada com ressalvas" },
  { k: "aprovada_fases", l: "Aprovada para desenvolvimento em fases" },
  { k: "retornar_fsd", l: "Retornar para ajuste do Anexo I — FSD" },
  { k: "retornar_dfd", l: "Retornar para ajuste do Anexo II — DFD" },
  { k: "retornar_ptv", l: "Retornar para ajuste do Anexo III — PTV" },
];
const DECISAO_COL2 = [
  { k: "encaminhar_presidencia", l: "Encaminhar para decisão da Presidência" },
  { k: "suspender", l: "Suspender temporariamente" },
  { k: "reprovar", l: "Reprovar" },
  { k: "cancelar", l: "Cancelar" },
  { k: "backlog", l: "Manter em backlog" },
  { k: "outro", l: "Outro:" },
];
const MOTIVOS_DECISAO = [
  { k: "atende_criterios_prioridade", l: "A demanda atende aos critérios de prioridade" },
  { k: "melhora_processo_fluxo", l: "A demanda melhora processo ou fluxo interno" },
  { k: "possui_viabilidade_tecnica", l: "A demanda possui viabilidade técnica" },
  { k: "corrige_falha", l: "A demanda corrige falha relevante" },
  { k: "impacto_institucional", l: "A demanda possui impacto institucional relevante" },
  { k: "exige_complementacao", l: "A demanda exige complementação antes de seguir" },
  { k: "impacto_operacional", l: "A demanda possui impacto operacional relevante" },
  { k: "sem_viabilidade_momento", l: "A demanda não possui viabilidade no momento" },
  { k: "exigencia_legal", l: "A demanda possui exigência legal, contratual ou regulatória" },
  { k: "reduz_risco", l: "A demanda reduz risco para a empresa" },
  { k: "outro", l: "Outro:" },
];
const CLASSIFICACAO_EXECUCAO = [
  { k: "atendimento_imediato", l: "Atendimento imediato" },
  { k: "proximo_ciclo", l: "Próximo ciclo de desenvolvimento" },
  { k: "desenvolvimento_programado", l: "Desenvolvimento programado" },
  { k: "desenvolvimento_fases", l: "Desenvolvimento em fases" },
  { k: "backlog", l: "Manter em backlog" },
  { k: "suspender", l: "Suspender temporariamente" },
  { k: "outro", l: "Outro:" },
];
const MOTIVOS_PRAZO_DIFERENTE = [
  { k: "decisao_estrategica", l: "Decisão estratégica" },
  { k: "dependencia_fornecedor_externo", l: "Dependência de fornecedor externo" },
  { k: "reorganizacao_fila", l: "Reorganização da fila de desenvolvimento" },
  { k: "necessidade_faseamento", l: "Necessidade de faseamento" },
  { k: "disponibilidade_equipe", l: "Disponibilidade da equipe técnica" },
  { k: "urgencia_institucional", l: "Urgência institucional" },
  { k: "dependencia_outra_demanda", l: "Dependência de outra demanda" },
  { k: "outro", l: "Outro:" },
];

// ── Estilos ───────────────────────────────────────────────────────────────────

const S = {
  secao: "bg-[#153169] text-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide",
  sub: "flex items-center gap-1 bg-[#153169]/10 border-l-[3px] border-[#153169] pl-2 pr-1 py-0.5 text-[10px] font-bold text-[#153169] uppercase tracking-wide mb-1.5 rounded-r-sm",
  th: "border border-gray-300 bg-[#153169]/5 px-1.5 py-1 text-[10px] font-semibold text-[#153169]",
  td: "border border-gray-300 px-1.5 py-1 text-[10px] align-middle",
};

// ── Contexto ──────────────────────────────────────────────────────────────────

interface AapCtxValue {
  ro: boolean;
  d: AapDados;
  patch: (p: Partial<AapDados>) => void;
  hasArr: (field: keyof AapDados, key: string) => boolean;
  toggleArr: (field: keyof AapDados, key: string, checked: boolean) => void;
}
const AapCtx = createContext<AapCtxValue>(null!);

// ── Primitivos (módulo-level → identidade estável → mantém foco) ──────────────

function Chk({ field, k, label }: { field: keyof AapDados; k: string; label: string }) {
  const { ro, hasArr, toggleArr } = useContext(AapCtx);
  const checked = hasArr(field, k);
  if (ro) return (
    <span className={`flex items-start gap-1 text-[11px] leading-tight px-0.5 py-px rounded ${checked ? "bg-[#153169]/10 text-[#153169] font-semibold" : "text-gray-500"}`}>
      <span className="flex-shrink-0 mt-px">{checked ? "☑" : "☐"}</span>
      <span>{label}</span>
    </span>
  );
  return (
    <label className={`flex items-start gap-1.5 text-[11px] leading-tight cursor-pointer select-none px-0.5 py-px rounded ${checked ? "bg-[#153169]/10 text-[#153169] font-semibold" : "hover:bg-gray-100"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => toggleArr(field, k, e.target.checked)} className="mt-px h-3 w-3 flex-shrink-0 accent-[#153169]" />
      <span>{label}</span>
    </label>
  );
}

function ChkGrp({ field, opcoes, cols = 1 }: { field: keyof AapDados; opcoes: { k: string; l: string }[]; cols?: number }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50/70 p-1.5">
      <div className="grid gap-x-2 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {opcoes.map(({ k, l }) => <Chk key={k} field={field} k={k} label={l} />)}
      </div>
    </div>
  );
}

function RadioItem({ field, k, label }: { field: keyof AapDados; k: string; label: string }) {
  const { ro, d, patch } = useContext(AapCtx);
  const checked = (d[field] as string | undefined) === k;
  if (ro) return (
    <span className={`flex items-center gap-1 text-[11px] px-1 py-px rounded ${checked ? "bg-[#153169]/10 text-[#153169] font-semibold" : "text-gray-500"}`}>
      <span>{checked ? "●" : "○"}</span> {label}
    </span>
  );
  return (
    <label className={`flex items-center gap-1.5 text-[11px] cursor-pointer select-none px-1 py-px rounded ${checked ? "bg-[#153169]/10 text-[#153169] font-semibold" : "hover:bg-gray-100"}`}>
      <input type="radio" checked={checked}
        onChange={() => patch({ [field]: (d[field] as string | undefined) === k ? undefined : k } as Partial<AapDados>)}
        className="h-3 w-3 flex-shrink-0 accent-[#153169]" />
      {label}
    </label>
  );
}

function TxtArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange?: (v: string) => void; placeholder?: string; rows?: number }) {
  const { ro } = useContext(AapCtx);
  if (ro) return <div className="text-[11px] min-h-[2rem] whitespace-pre-wrap break-words">{value || <span className="text-gray-400">—</span>}</div>;
  return (
    <textarea value={value} rows={rows} placeholder={placeholder}
      className="w-full rounded border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#153169] resize-none"
      onChange={(e) => onChange?.(e.target.value)} />
  );
}

function DateField({ field }: { field: keyof AapDados }) {
  const { ro, d, patch } = useContext(AapCtx);
  const val = (d[field] as string | undefined) ?? "";
  if (ro) return <span className="text-[11px]">{val ? (fmtData(val) ?? val) : "—"}</span>;
  return (
    <input type="date" value={val}
      onChange={(e) => patch({ [field]: e.target.value || undefined } as Partial<AapDados>)}
      className="w-full rounded border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#153169]" />
  );
}

function SituacaoOpcoes({ field, opts }: { field: keyof AapDados; opts: { k: string; l: string }[] }) {
  const { ro, d, patch } = useContext(AapCtx);
  const val = d[field] as string | undefined;
  if (ro) return <span className="text-[11px]">{opts.find(o => o.k === val)?.l ?? "—"}</span>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
      {opts.map(({ k, l }) => (
        <label key={k} className={`flex items-center gap-1.5 text-[11px] cursor-pointer select-none px-1 py-px rounded ${val === k ? "bg-[#153169]/10 text-[#153169] font-semibold" : "hover:bg-gray-100"}`}>
          <input type="radio" value={k} checked={val === k}
            onChange={() => patch({ [field]: val === k ? undefined : k } as Partial<AapDados>)}
            className="h-3 w-3 accent-[#153169]" />
          {l}
        </label>
      ))}
    </div>
  );
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface AapDocumentoProps {
  dados: AapDados;
  card: Solicitacao;
  isReadOnly: boolean;
  onPatch?: (dados: AapDados) => void;
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AapDocumento({ dados, card, isReadOnly: ro, onPatch }: AapDocumentoProps) {
  const [d, setD] = useState<AapDados>(dados);
  useEffect(() => { setD(dados); }, [dados]);

  function patch(p: Partial<AapDados>) {
    if (ro) return;
    const novo = { ...d, ...p };
    setD(novo);
    onPatch?.(novo);
  }
  function hasArr(field: keyof AapDados, key: string) {
    return ((d[field] as string[] | undefined) ?? []).includes(key);
  }
  function toggleArr(field: keyof AapDados, key: string, checked: boolean) {
    const cur = (d[field] as string[] | undefined) ?? [];
    patch({ [field]: checked ? [...cur, key] : cur.filter((k) => k !== key) } as Partial<AapDados>);
  }

  // ── Helpers de layout (display only — sem inputs) ─────────────────────────

  function Secao({ num, title }: { num: number | string; title: string }) {
    return <div className={S.secao}>{num}. {title}</div>;
  }
  function Sub({ title, badge }: { title: string; badge?: boolean }) {
    return (
      <div className={S.sub}>
        <span className="flex-1">{title}</span>
        {badge && <span className="ml-1 rounded bg-[#153169] px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">AUTO</span>}
      </div>
    );
  }
  function BadgeInline({ text, cls }: { text: string; cls: string }) {
    return <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${cls}`}>{text}</span>;
  }

  // ── Valores automáticos ───────────────────────────────────────────────────

  const criterios = card.an_criterios ?? [];
  const prioridadeAuto = calcPrioridade(criterios);
  const complexidadeAuto = calcComplexidade(card.ptv_dados?.complexidade_itens ?? []);
  const prazoAuto = calcPrazo(prioridadeAuto, complexidadeAuto);

  const tipoDemanda = card.classificacao_demanda?.length
    ? card.classificacao_demanda.map((v) => CLASSIFICACAO_DEMANDA_OPCOES.find((o) => o.value === v)?.label ?? v).join(", ")
    : (card.tipo_solicitacao ? (TIPO_SOLICITACAO_LABEL[card.tipo_solicitacao] ?? card.tipo_solicitacao) : "—");

  const ptv = card.ptv_dados;
  const dfd = card.dfd_dados;

  function prioridadeBadge(p: string) {
    const m: Record<string, string> = { "Crítica": "bg-red-700 text-white", "Alta": "bg-red-100 text-red-700", "Estratégica": "bg-purple-100 text-purple-700", "Média": "bg-yellow-100 text-yellow-700", "Baixa": "bg-green-100 text-green-700" };
    return m[p] ?? "bg-gray-100 text-gray-700";
  }
  function complexBadge(c: string) {
    const m: Record<string, string> = { "Crítica": "bg-red-700 text-white", "Alta": "bg-red-100 text-red-700", "Média": "bg-yellow-100 text-yellow-700", "Baixa": "bg-green-100 text-green-700" };
    return m[c] ?? "bg-gray-100 text-gray-700";
  }

  const viab = (() => {
    if (ptv?.tecnicamente_viavel === "sim") return { text: "VIÁVEL", cls: "bg-green-100 text-green-700" };
    if (ptv?.tecnicamente_viavel === "nao_viavel") return { text: "INVIÁVEL", cls: "bg-red-100 text-red-700" };
    if (ptv?.tecnicamente_viavel === "condicional") return { text: "CONDICIONAL", cls: "bg-yellow-100 text-yellow-700" };
    return { text: "—", cls: "bg-gray-100 text-gray-500" };
  })();
  const faseamento = (() => {
    if (ptv?.dividir_fases === "sim") return { text: "SIM", cls: "bg-blue-100 text-blue-700" };
    if (ptv?.dividir_fases === "nao") return { text: "NÃO", cls: "bg-gray-100 text-gray-600" };
    return { text: "—", cls: "bg-gray-100 text-gray-400" };
  })();
  const comite = (() => {
    if (ptv?.encaminhar_comite === "sim") return { text: "SIM", cls: "bg-blue-100 text-blue-700" };
    if (ptv?.encaminhar_comite === "nao") return { text: "NÃO", cls: "bg-gray-100 text-gray-600" };
    return { text: "—", cls: "bg-gray-100 text-gray-400" };
  })();

  // Seção 1 — 3 grupos de colunas INFORMAÇÃO/VALOR/ORIGEM
  type S1Row = { info: string; valor?: string; badge?: { text: string; cls: string }; origem: string };
  const s1g1: S1Row[] = [
    { info: "Número da demanda", valor: sdNumero(card), origem: "Criada no card Solicitação" },
    { info: "Área solicitante", valor: card.area_solicitante ?? "—", origem: "Pergunta 1 do card Solicitação" },
    { info: "Responsável pela solicitação", valor: card.responsavel_solicitacao ?? "—", origem: "Pergunta 1 do card Solicitação" },
    { info: "Tipo da demanda", valor: tipoDemanda, origem: "Pergunta 2 do card Solicitação" },
    { info: "Prioridade institucional", badge: { text: prioridadeAuto, cls: prioridadeBadge(prioridadeAuto) }, origem: "Pergunta 4.3 do card Análise Técnica" },
    { info: "Critério de prioridade aplicado", valor: principalCriterio(criterios), origem: "Pergunta 9 do card Solicitação" },
  ];
  const s1g2: S1Row[] = [
    { info: "Documento Funcional (DFD)", valor: "Anexo II — DFD", origem: "Anexo II — DFD (automático)" },
    { info: "Versão do DFD analisada", valor: dfd?.situacao ?? "—", origem: "Campo Situação do DFD" },
    { info: "Parecer Técnico vinculado (PTV)", valor: "Anexo III — PTV", origem: "Anexo III — PTV (automático)" },
    { info: "Viabilidade técnica", badge: viab, origem: "Pergunta 6 do card Análise Técnica" },
    { info: "Complexidade técnica", badge: { text: complexidadeAuto, cls: complexBadge(complexidadeAuto) }, origem: "Pergunta 4.5 do card Análise Técnica" },
  ];
  const s1g3: S1Row[] = [
    { info: "Prazo técnico estimado", valor: prazoAuto, origem: "Pergunta 4.8 do card Análise Técnica" },
    { info: "Necessidade de faseamento", badge: faseamento, origem: "Pergunta 5.3 do card Análise Técnica" },
    { info: "Encaminhamento ao Comitê", badge: comite, origem: "Pergunta 5.4 do card Análise Técnica" },
  ];

  const maxRows = Math.max(s1g1.length, s1g2.length, s1g3.length);
  const emptyRow: S1Row = { info: "", valor: "", origem: "" };
  const rows1 = Array.from({ length: maxRows }, (_, i) => [s1g1[i] ?? emptyRow, s1g2[i] ?? emptyRow, s1g3[i] ?? emptyRow] as const);

  function renderS1Cell(row: S1Row) {
    if (!row.info) return null;
    return row.badge
      ? <BadgeInline text={row.badge.text} cls={row.badge.cls} />
      : <span>{row.valor ?? "—"}</span>;
  }

  // Seção 2 — síntese automática
  const sinteseLinhas = [
    { info: "Objetivo da demanda", resp: card.descricao_necessidade, origem: "Pergunta 3 do card Solicitação" },
    { info: "Justificativa da demanda", resp: card.justificativa, origem: "Pergunta 6 do card Solicitação" },
    { info: "Benefício esperado", resp: card.beneficios_esperados_lista?.join(", "), origem: "Pergunta 7 do card Solicitação" },
    { info: "Escopo funcional", resp: dfd?.contemplar?.join(", "), origem: "Pergunta 1.3 do card Documentação Funcional (DFD)" },
    { info: "Processo impactado", resp: dfd?.modulos_impactados?.join(", "), origem: "Pergunta 1.2 do card Documentação Funcional (DFD)" },
    { info: "Principais requisitos funcionais", resp: dfd?.funcionalidades?.join(", "), origem: "Pergunta 5 do card Documentação Funcional (DFD)" },
    { info: "Integrações previstas", resp: dfd?.integracoes?.map(i => i.sistema).filter(Boolean).join(", "), origem: "Pergunta 8 do card Documentação Funcional (DFD)" },
    { info: "Indicadores previstos", resp: dfd?.indicadores?.map(i => i.indicador).filter(Boolean).join("; "), origem: "Pergunta 9.2 do card Documentação Funcional (DFD)" },
    { info: "Documentos gerados", resp: dfd?.documentos?.map(doc => doc.documento).filter(Boolean).join("; "), origem: "Pergunta 9.1 do card Documentação Funcional (DFD)" },
    { info: "Riscos técnicos", resp: dfd?.premissas?.filter(p => p.tipos?.includes("risco")).map(p => p.tratamento).filter(Boolean).join("; "), origem: "Pergunta 10 do card Documentação Funcional (DFD) – riscos" },
    { info: "Dependências técnicas", resp: dfd?.premissas?.filter(p => p.tipos?.includes("dependencia")).map(p => p.tratamento).filter(Boolean).join("; "), origem: "Pergunta 10 do card Documentação Funcional (DFD) – dependências" },
    { info: "Parecer técnico final", resp: ptv?.observacoes_justificativas, origem: "Pergunta 6 do card Análise Técnica" },
  ];

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <AapCtx.Provider value={{ ro, d, patch, hasArr, toggleArr }}>
    <div className="text-[11px] font-[Arial,sans-serif] border border-gray-300 rounded">

      {/* CABEÇALHO */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300 bg-white">
        <div className="flex items-start gap-3">
          <div style={{ width: 0, height: 0, borderLeft: "13px solid transparent", borderRight: "13px solid transparent", borderBottom: "21px solid #E55B00", flexShrink: 0, marginTop: 3 }} />
          <div>
            <p className="font-bold text-[13px] uppercase tracking-wide text-gray-900">ATA DE APROVAÇÃO E PRIORIZAÇÃO (AAP)</p>
            <p className="text-[10px] text-gray-500">Registro da deliberação, aprovação e priorização da demanda</p>
          </div>
        </div>
        <div className="text-right border border-gray-400 px-2 py-0.5 min-w-[130px]">
          <p className="text-[9px] font-semibold uppercase text-gray-500">Nº DA DEMANDA</p>
          <p className="text-[13px] font-bold text-[#153169]">{sdNumero(card)}</p>
        </div>
      </div>

      {/* SEÇÃO 1 — IDENTIFICAÇÃO DA DEMANDA */}
      <Secao num={1} title="IDENTIFICAÇÃO DA DEMANDA" />
      <div className="text-[9px] italic text-gray-400 px-3 py-0.5 bg-gray-50 border-b border-gray-200">
        Informações importadas automaticamente dos anexos anteriores
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 780 }}>
          <thead>
            <tr>
              <th className={`${S.th} w-[13%]`}>INFORMAÇÃO</th>
              <th className={`${S.th} w-[9%]`}>VALOR</th>
              <th className={`${S.th} w-[11%]`}>ORIGEM (DE ONDE VEM)</th>
              <th className={`${S.th} w-[13%]`}>INFORMAÇÃO</th>
              <th className={`${S.th} w-[9%]`}>VALOR</th>
              <th className={`${S.th} w-[11%]`}>ORIGEM (DE ONDE VEM)</th>
              <th className={`${S.th} w-[13%]`}>INFORMAÇÃO</th>
              <th className={`${S.th} w-[9%]`}>VALOR</th>
              <th className={`${S.th} w-[12%]`}>ORIGEM (DE ONDE VEM)</th>
            </tr>
          </thead>
          <tbody>
            {rows1.map(([a, b, c], i) => (
              <tr key={i}>
                <td className={`${S.td} font-semibold text-[#153169]`}>{a.info}</td>
                <td className={S.td}>{renderS1Cell(a)}</td>
                <td className={`${S.td} text-gray-500 italic`}>{a.origem}</td>
                <td className={`${S.td} font-semibold text-[#153169]`}>{b.info}</td>
                <td className={S.td}>{renderS1Cell(b)}</td>
                <td className={`${S.td} text-gray-500 italic`}>{b.origem}</td>
                <td className={`${S.td} font-semibold text-[#153169]`}>{c.info}</td>
                <td className={S.td}>{renderS1Cell(c)}</td>
                <td className={`${S.td} text-gray-500 italic`}>{c.origem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SEÇÃO 2 — SÍNTESE AUTOMÁTICA */}
      <Secao num={2} title="SÍNTESE AUTOMÁTICA PARA DELIBERAÇÃO" />
      <div className="text-[9px] italic text-gray-400 px-3 py-0.5 bg-gray-50 border-b border-gray-200">
        Informações importadas automaticamente dos anexos anteriores
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${S.th} w-[18%]`}>INFORMAÇÃO</th>
              <th className={`${S.th} w-[52%]`}>RESPOSTA</th>
              <th className={`${S.th} w-[30%]`}>ORIGEM (DE ONDE VEM)</th>
            </tr>
          </thead>
          <tbody>
            {sinteseLinhas.map(({ info, resp, origem }) => (
              <tr key={info}>
                <td className={`${S.td} font-semibold text-[#153169]`}>{info}</td>
                <td className={S.td}>{resp || "—"}</td>
                <td className={`${S.td} text-gray-500 italic`}>{origem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SEÇÃO 3 — CONDIÇÃO DA DEMANDA */}
      <Secao num={3} title="CONDIÇÃO DA DEMANDA PARA DELIBERAÇÃO" />
      <div className="p-3 space-y-3">
        <div>
          <Sub title="A demanda está apta para deliberação?" />
          <div className="flex flex-wrap gap-4">
            <RadioItem field="demanda_apta" k="sim" label="Sim" />
            <RadioItem field="demanda_apta" k="sim_ressalvas" label="Sim, com ressalvas" />
            <RadioItem field="demanda_apta" k="nao" label="Não" />
          </div>
        </div>

        <div>
          <Sub title="Situação dos anexos obrigatórios (preenchimento manual)" />
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${S.th} w-[20%]`}>DOCUMENTO</th>
                <th className={`${S.th} w-[60%]`}>SITUAÇÃO (selecione uma opção)</th>
                <th className={`${S.th} w-[20%]`}>ORIGEM</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${S.td} font-semibold`}>Anexo I — FSD</td>
                <td className={S.td}>
                  <SituacaoOpcoes field="situacao_fsd" opts={[
                    { k: "aprovado", l: "Aprovado" },
                    { k: "pendente", l: "Pendente" },
                    { k: "retornado", l: "Retornado - Automático" },
                  ]} />
                </td>
                <td className={`${S.td} text-gray-500 italic`}>Card Solicitação</td>
              </tr>
              <tr>
                <td className={`${S.td} font-semibold`}>Anexo II — DFD</td>
                <td className={S.td}>
                  <SituacaoOpcoes field="situacao_dfd" opts={[
                    { k: "aprovado", l: "Aprovado" },
                    { k: "aprovado_ressalvas", l: "Aprovado com ressalvas" },
                    { k: "retornado", l: "Retornado - Automático" },
                  ]} />
                </td>
                <td className={`${S.td} text-gray-500 italic`}>Card DFD</td>
              </tr>
              <tr>
                <td className={`${S.td} font-semibold`}>Anexo III — PTV</td>
                <td className={S.td}>
                  <SituacaoOpcoes field="situacao_ptv" opts={[
                    { k: "viavel", l: "Viável" },
                    { k: "viavel_ressalvas", l: "Viável com ressalvas" },
                    { k: "inviavel", l: "Inviável" },
                    { k: "pendente", l: "Pendente - Automático" },
                  ]} />
                </td>
                <td className={`${S.td} text-gray-500 italic`}>Card PTV</td>
              </tr>
            </tbody>
          </table>
        </div>

        {(d.demanda_apta === "nao" || d.demanda_apta === "sim_ressalvas" || (ro && (d.motivos_nao_apta?.length ?? 0) > 0)) && (
          <div>
            <Sub title="Caso a demanda NÃO esteja apta, indicar motivo:" />
            <ChkGrp field="motivos_nao_apta" opcoes={MOTIVOS_NAO_APTA} cols={2} />
          </div>
        )}
      </div>

      {/* SEÇÃO 4 — DELIBERAÇÃO DA DEMANDA */}
      <Secao num={4} title="DELIBERAÇÃO DA DEMANDA" />
      <div className="p-3 space-y-3">
        <div>
          <Sub title="Decisão da instância competente: (selecione uma opção)" />
          <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="space-y-0.5">
              {DECISAO_COL1.map(({ k, l }) => <RadioItem key={k} field="decisao_instancia" k={k} label={l} />)}
            </div>
            <div className="space-y-0.5">
              {DECISAO_COL2.map(({ k, l }) => <RadioItem key={k} field="decisao_instancia" k={k} label={l} />)}
            </div>
          </div>
        </div>

        <div>
          <Sub title="Motivo da decisão: (marque uma ou mais opções)" />
          <ChkGrp field="motivos_decisao" opcoes={MOTIVOS_DECISAO} cols={2} />
        </div>

        <div>
          <Sub title="Observação objetiva da deliberação:" />
          <TxtArea
            value={d.observacao_deliberacao ?? ""}
            onChange={(v) => patch({ observacao_deliberacao: v || undefined })}
            placeholder="Descreva a observação objetiva da deliberação..."
            rows={3}
          />
        </div>
      </div>

      {/* SEÇÃO 5 — PRIORIZAÇÃO APROVADA */}
      <Secao num={5} title="PRIORIZAÇÃO APROVADA" />
      <div className="p-3">
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr)" }}>

          {/* Bloco esquerdo — dados importados (auto) */}
          <div>
            <Sub title="Dados importados (automático)" badge />
            <div className="space-y-2 rounded border border-gray-200 bg-gray-50/70 p-2">
              <div>
                <p className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide mb-0.5">Prioridade institucional</p>
                <BadgeInline text={prioridadeAuto} cls={prioridadeBadge(prioridadeAuto)} />
                <p className="text-[9px] text-gray-400 mt-0.5">Origem: Pergunta 4.3 do card Análise Técnica</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide mb-0.5">Complexidade técnica</p>
                <BadgeInline text={complexidadeAuto} cls={complexBadge(complexidadeAuto)} />
                <p className="text-[9px] text-gray-400 mt-0.5">Origem: Pergunta 4.5 do card Análise Técnica</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide mb-0.5">Prazo técnico estimado</p>
                <span className="text-[11px] font-semibold text-[#153169]">{prazoAuto}</span>
                <p className="text-[9px] text-gray-400 mt-0.5">Origem: Pergunta 4.8 do card Análise Técnica</p>
              </div>
            </div>
          </div>

          {/* Bloco central — classificação de execução */}
          <div>
            <Sub title="Classificação de execução aprovada (preenchimento manual)" />
            <div className="space-y-0.5">
              {CLASSIFICACAO_EXECUCAO.map(({ k, l }) => <RadioItem key={k} field="classificacao_execucao" k={k} label={l} />)}
            </div>
          </div>

          {/* Bloco direito — datas + prazo diferente */}
          <div className="space-y-3">
            <div>
              <Sub title="Data aprovada para início previsto" />
              <DateField field="data_inicio_previsto" />
            </div>
            <div>
              <Sub title="Data aprovada para conclusão prevista" />
              <DateField field="data_conclusao_prevista" />
            </div>
            <div>
              <Sub title="O prazo aprovado será diferente do prazo técnico estimado no Anexo III?" />
              <div className="flex gap-4 mb-1.5">
                <RadioItem field="prazo_diferente" k="sim" label="Sim" />
                <RadioItem field="prazo_diferente" k="nao" label="Não" />
              </div>
              {(d.prazo_diferente === "sim" || (ro && (d.motivos_prazo_diferente?.length ?? 0) > 0)) && (
                <>
                  <p className="text-[9px] text-gray-500 mb-1">Se SIM, motivo do ajuste: (marque uma ou mais opções)</p>
                  <ChkGrp field="motivos_prazo_diferente" opcoes={MOTIVOS_PRAZO_DIFERENTE} cols={2} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
    </AapCtx.Provider>
  );
}
