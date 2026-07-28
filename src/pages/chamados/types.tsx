// =====================================================================
// CHAMADOS DE SISTEMAS — tipos, enums/labels e componentes compartilhados
// entre as telas (abrir, meus chamados, painel de distribuição,
// coordenação, painel do dev, execução).
// =====================================================================
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

// ---- Opções (options de select / checkbox) --------------------------
export const CATEGORIAS = [
  { value: "power_bi", label: "Power BI" },
  { value: "relatorios_dashboards", label: "Relatórios / Dashboards" },
  { value: "ajuste_tela_cadastro", label: "Ajuste em Tela / Cadastro" },
  { value: "correcao_erro", label: "Correção de Erro" },
  { value: "integracoes", label: "Integrações" },
  { value: "dados_informacao", label: "Dados / Informação" },
  { value: "acesso_permissao", label: "Acesso / Permissão" },
  { value: "outros", label: "Outros" },
] as const;

export const TIPOS = [
  { value: "ajuste", label: "Ajuste" },
  { value: "correcao", label: "Correção" },
  { value: "melhoria", label: "Melhoria" },
  { value: "duvida", label: "Dúvida / Orientação" },
  { value: "outro", label: "Outro" },
] as const;

export const IMPACTOS = [
  { value: "impede", label: "Impede de trabalhar" },
  { value: "atraso_significativo", label: "Atraso significativo" },
  { value: "atraso_leve", label: "Atraso leve" },
  { value: "nao_impacta", label: "Não impacta" },
] as const;

export const URGENCIAS = [
  { value: "ate_1h", label: "Até 1 hora" },
  { value: "ate_1d", label: "Até 1 dia útil" },
  { value: "ate_3d", label: "Até 3 dias úteis" },
  { value: "ate_5d", label: "Até 5 dias úteis" },
  { value: "mais_5d", label: "Mais de 5 dias úteis" },
] as const;

// "Módulo / Sistema" = qual ferramenta é o problema (distinto do setor de quem abre).
export const MODULOS_ERP = [
  { value: "power_bi", label: "Power BI" },
  { value: "bi", label: "BI & Analytics" },
  { value: "licitacoes", label: "Licitações" },
  { value: "controladoria", label: "Controladoria & Orçamento" },
  { value: "suprimentos", label: "Suprimentos" },
  { value: "financeiro", label: "Financeiro" },
  { value: "fiscal", label: "Fiscal & Tributário" },
  { value: "contabil", label: "Contábil" },
  { value: "rh", label: "Recursos Humanos" },
  { value: "recrutamento", label: "Recrutamento e Seleção" },
  { value: "juridico", label: "Jurídico" },
  { value: "sst", label: "SST" },
  { value: "encarregados", label: "Encarregados" },
  { value: "central_servicos", label: "Central de Serviços" },
  { value: "sistemas", label: "Sistemas" },
  { value: "plano_acoes", label: "Plano de Ações" },
  { value: "integracao", label: "Integração & Migração" },
  { value: "malote", label: "Malote" },
  { value: "outro", label: "Outro" },
] as const;

export const AMBIENTES = [
  { value: "producao", label: "Produção" },
  { value: "homologacao", label: "Homologação" },
  { value: "teste", label: "Teste" },
] as const;

// ---- Prioridade / status (label + cores Tailwind) -------------------
export const PRIORIDADES: Record<string, { label: string; cls: string; dot: string }> = {
  alta:  { label: "Alta",  cls: "border-destructive/30 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  media: { label: "Média", cls: "border-warning/30 bg-warning/10 text-warning",             dot: "bg-warning" },
  baixa: { label: "Baixa", cls: "border-info/30 bg-info/10 text-info",                       dot: "bg-info" },
};

export const STATUS_CHAMADO: Record<string, { label: string; cls: string }> = {
  aberto:             { label: "Aberto",             cls: "border-warning/30 bg-warning/10 text-warning" },
  em_andamento:       { label: "Em andamento",       cls: "border-info/30 bg-info/10 text-info" },
  aguardando_retorno: { label: "Aguardando retorno", cls: "border-primary/30 bg-primary/10 text-primary" },
  concluido:          { label: "Concluído",          cls: "border-success/30 bg-success/10 text-success" },
  reprovado:          { label: "Reprovado",          cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};

export const labelDe = (opts: readonly { value: string; label: string }[], v?: string | null) =>
  opts.find((o) => o.value === v)?.label ?? (v ?? "—");

// ---- Interfaces -----------------------------------------------------
export interface Chamado {
  id: string;
  numero: string;
  assunto: string;
  categorias: string[];
  tipo_solicitacao: string | null;
  prioridade: string;
  descricao: string | null;
  impacto_trabalho: string | null;
  urgencia: string | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  ambiente: string;
  afeta_usuarios: number | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  setor: string | null;
  status: string;
  responsavel_id: string | null;
  prazo_previsto: string | null;
  observacao_gerente: string | null;
  comentario_gerente: string | null;
  motivo_reprovacao: string | null;
  concluido_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface Anexo {
  id: string;
  chamado_id: string;
  storage_path: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  campo: string;
  autor_id: string;
  created_at: string;
}

export interface Evento {
  id: string;
  chamado_id: string;
  autor_id: string;
  tipo: string;
  texto: string | null;
  meta: Record<string, any> | null;
  created_at: string;
}

export const BUCKET_CHAMADOS = "chamados-sistemas";

// ---- Helpers de data ------------------------------------------------
export const fmtData = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleDateString("pt-BR");
};
export const fmtDataHora = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
export const iniciais = (nome?: string | null) =>
  (nome ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

/** Label do módulo/sistema (usa o texto livre quando "outro"). */
export const moduloLabel = (c: Pick<Chamado, "modulo_sistema" | "modulo_sistema_outro">) =>
  c.modulo_sistema === "outro"
    ? (c.modulo_sistema_outro || "Outro")
    : labelDe(MODULOS_ERP, c.modulo_sistema);

// ---- Componentes visuais compartilhados -----------------------------
export function StatCard({
  icon: Icon, label, value, hint, tone = "primary",
}: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones[tone] ?? tones.primary}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{label}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground/70">{hint}</p>}
      </div>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CHAMADO[status] ?? { label: status, cls: "" };
  return <Badge variant="outline" className={`text-[10px] font-semibold ${s.cls}`}>{s.label}</Badge>;
}

export function PrioridadeBadge({ prioridade }: { prioridade: string }) {
  const p = PRIORIDADES[prioridade] ?? { label: prioridade, cls: "" };
  return <Badge variant="outline" className={`text-[10px] font-semibold ${p.cls}`}>{p.label}</Badge>;
}

