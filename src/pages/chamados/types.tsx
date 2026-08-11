// =====================================================================
// CHAMADOS DE SISTEMAS — tipos, enums/labels e componentes compartilhados
// entre as telas (abrir, meus chamados, painel de distribuição,
// coordenação, painel do dev, execução).
// =====================================================================
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Star, type LucideIcon } from "lucide-react";

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
  observacoes_solicitante: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  setor: string | null;
  status: string;
  responsavel_id: string | null;
  /** Posição na fila DO RESPONSÁVEL (1 = próximo a executar). NULL quando
   *  concluído/reprovado ou ainda sem responsável. */
  posicao_dev: number | null;
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
  /** Mensagem do chat a que o anexo pertence. NULL = anexo da abertura (ou
   *  anexo antigo, de antes do chat). */
  evento_id: string | null;
  storage_path: string;
  nome_arquivo: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  /** abertura | chat | interno | resposta (legado). */
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

export interface AvaliacaoChamado {
  id: string;
  chamado_id: string;
  solicitante_id: string;
  qualidade: number;
  prazo: number;
  comunicacao: number;
  clareza: number;
  facilidade: number;
  satisfacao: number;
  comentario: string | null;
  created_at: string;
}

// Critérios da avaliação multi-item (1..5 cada) com o PESO de cada um na nota
// final. A ordem aqui é a ordem do modal. Os pesos somam 1,00:
//   Qualidade 0,30 · Prazo 0,20 · Comunicação 0,15 · Clareza 0,10 ·
//   Facilidade 0,10 · Satisfação 0,15.
export const CRITERIOS_AVALIACAO = [
  { key: "qualidade",   titulo: "Qualidade",   peso: 0.30, descricao: "Avalie a qualidade da solução entregue." },
  { key: "prazo",       titulo: "Prazo",       peso: 0.20, descricao: "Avalie se o chamado foi resolvido dentro do prazo." },
  { key: "comunicacao", titulo: "Comunicação", peso: 0.15, descricao: "Avalie a cordialidade e a comunicação durante o atendimento." },
  { key: "clareza",     titulo: "Clareza",     peso: 0.10, descricao: "Avalie a clareza e objetividade das informações." },
  { key: "facilidade",  titulo: "Facilidade",  peso: 0.10, descricao: "Avalie o quão fácil foi resolver sua solicitação." },
  { key: "satisfacao",  titulo: "Satisfação",  peso: 0.15, descricao: "Avalie sua satisfação geral com o atendimento." },
] as const;

export type CriterioKey = (typeof CRITERIOS_AVALIACAO)[number]["key"];

/** Nota final (0..5) = média PONDERADA dos critérios pelos pesos acima. */
export const mediaAvaliacao = (a: Pick<AvaliacaoChamado, CriterioKey>) =>
  CRITERIOS_AVALIACAO.reduce((s, c) => s + (a[c.key] ?? 0) * c.peso, 0);

export const BUCKET_CHAMADOS = "chamados-sistemas";

/** Chamado ativo = ainda está na fila (não foi concluído nem reprovado). */
export const chamadoAtivo = (status: string) => status !== "concluido" && status !== "reprovado";

/**
 * Posição na fila GLOBAL (ordem de chegada): entre os chamados ativos, o mais
 * antigo é o nº 1. Concluídos/reprovados ficam de fora (não têm posição).
 */
export function posicoesFilaGlobal(chamados: Chamado[]): Record<string, number> {
  const m: Record<string, number> = {};
  chamados
    .filter((c) => chamadoAtivo(c.status))
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    .forEach((c, i) => { m[c.id] = i + 1; });
  return m;
}

/**
 * Posição na fila DE CADA RESPONSÁVEL (1..n por dev), lida de posicao_dev.
 * Ex.: o chamado nº 3 da fila global pode ser o nº 1 do Pablo, quando é a
 * única solicitação pendente dele.
 */
export function posicoesFilaDev(chamados: Chamado[]): Record<string, number> {
  const porDev: Record<string, Chamado[]> = {};
  chamados
    .filter((c) => chamadoAtivo(c.status) && c.responsavel_id)
    .forEach((c) => { (porDev[c.responsavel_id!] ??= []).push(c); });

  const m: Record<string, number> = {};
  Object.values(porDev).forEach((lista) => {
    lista
      .sort((a, b) =>
        (a.posicao_dev ?? Number.MAX_SAFE_INTEGER) - (b.posicao_dev ?? Number.MAX_SAFE_INTEGER)
        || +new Date(a.created_at) - +new Date(b.created_at))
      .forEach((c, i) => { m[c.id] = i + 1; });
  });
  return m;
}

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

/** Estrelas somente-leitura (1..5), aceita valor fracionário (ex.: média 4,2). */
export function Estrelas({ valor, size = 16 }: { valor: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const preenchido = Math.min(1, Math.max(0, valor - (n - 1))); // 0..1 desta estrela
        return (
          <span key={n} className="relative inline-block" style={{ width: size, height: size }}>
            <Star style={{ width: size, height: size }} className="absolute inset-0 text-muted-foreground/30" />
            {preenchido > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${preenchido * 100}%` }}>
                <Star style={{ width: size, height: size }} className="fill-warning text-warning" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

