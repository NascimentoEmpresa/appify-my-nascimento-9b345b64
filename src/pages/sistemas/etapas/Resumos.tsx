import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  APROVACOES_TESTES_INTERNOS, BENEFICIOS_ESPERADOS_OPCOES, CLASSIFICACAO_DEMANDA_OPCOES,
  COMPLEXIDADE_LABEL, CRITERIO_TRIAGEM_LABEL, DOCUMENTOS_APOIO_OPCOES, ETAPAS,
  GRAU_URGENCIA_LABEL, IMPACTO_TIPO_OPCOES, STATUS_DESENVOLVIMENTO_LABEL,
  TIPO_COMENTARIO_BORDA, TIPO_COMENTARIO_LABEL, TRIAGEM_CLASSIFICACAO_LABEL, TRIAGEM_DECISAO_LABEL,
  fmtData, nomeUsuario, sdNumero, TIPO_SOLICITACAO_LABEL,
  type Anexo, type Comentario, type Convidado, type Solicitacao, type Usuario,
} from "./types";
import { DfdDocumento } from "./DfdDocumento";
import { PtvDocumento } from "./PtvDocumento";
import { AapDocumento } from "./AapDocumento";

const ETAPA_LABEL: Record<string, string> = Object.fromEntries(ETAPAS.map((e) => [e.key, e.label]));

interface ResumoProps {
  card: Solicitacao;
  anexos: Anexo[];
  comentarios: Comentario[];
  usuarios: Usuario[];
  onDownloadAnexo: (path: string) => void;
}

export function temDadoResumo(
  etapaKey: string,
  card: Solicitacao,
  anexos: Anexo[],
  comentarios: Comentario[],
  convidados: Convidado[],
): boolean {
  switch (etapaKey) {
    case "triagem_inicial":
      return !!card.criterio_triagem;
    case "analise_necessidade":
      return !!card.analise_necessidade_texto || !!card.analise_necessidade_prazo || anexos.some((a) => a.campo === "analise_necessidade");
    case "levantamento_funcional":
      return !!card.levantamento_funcional_texto || !!card.levantamento_funcional_prazo || anexos.some((a) => a.campo === "levantamento_funcional");
    case "documentacao_funcional":
      return !!card.documentacao_tecnica_texto || !!card.documentacao_tecnica_prazo || anexos.some((a) => a.campo === "documentacao_tecnica");
    case "analise_tecnica":
      return !!card.analise_tecnica_texto || !!card.analise_tecnica_prazo || anexos.some((a) => a.campo === "analise_tecnica");
    case "aprovacao_priorizacao":
      return !!card.prioridade || !!card.responsavel_user_id || !!card.complexidade || anexos.some((a) => a.campo === "aprovacao_priorizacao");
    case "desenvolvimento":
      return (
        card.progresso_pct > 0 || !!card.data_fim || !!card.status_desenvolvimento ||
        comentarios.some((c) => c.tipo === "interromper_desenvolvimento" || c.tipo === "erro_documental")
      );
    case "testes_internos":
      return (
        card.testes_interno_aprov_1 || card.testes_interno_aprov_2 || card.testes_interno_aprov_3 ||
        comentarios.some((c) => c.tipo === "justificativa_retorno") ||
        anexos.some((a) => a.campo === "testes_internos")
      );
    case "homologacao_area_solicitante":
      return (
        comentarios.some((c) => c.tipo === "aprovado_ressalva" || c.tipo === "reprovado") ||
        anexos.some((a) => a.campo === "homologacao_area_solicitante")
      );
    case "treinamento":
      return (
        !!card.treinamento_data ||
        anexos.some((a) => a.campo === "treinamento") ||
        comentarios.some((c) => c.tipo === "faltou_funcoes" || c.tipo === "encontrado_bug")
      );
    case "implantacao":
      return (
        !!card.implantacao_status ||
        comentarios.some((c) => c.tipo === "implantacao_comentario") ||
        anexos.some((a) => a.campo === "implantacao")
      );
    case "acompanhamento_assistido":
      return anexos.some((a) => a.campo === "acompanhamento");
    default:
      return false;
  }
}

function LvItem({ label, valor }: { label: string; valor: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="text-xs whitespace-pre-wrap">{valor || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function listLabels(valores: string[] | null | undefined, opcoes: { value: string; label: string }[]): string {
  if (!valores || valores.length === 0) return "—";
  return valores.map((v) => opcoes.find((o) => o.value === v)?.label ?? v).join(", ");
}

function Bloco({ etapaKey, children }: { etapaKey: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3 opacity-90">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {ETAPA_LABEL[etapaKey]} <span className="font-normal">— concluído</span>
      </p>
      {children}
    </div>
  );
}

export function ListaAnexos({ anexos, campo, onDownloadAnexo }: { anexos: Anexo[]; campo: string; onDownloadAnexo: (path: string) => void }) {
  const lista = anexos.filter((a) => a.campo === campo);
  if (lista.length === 0) return null;
  return (
    <div className="space-y-1">
      {lista.map((a) => (
        <div key={a.id} className="flex justify-between rounded border border-border px-2 py-1 text-[11px] leading-4">
          <span className="break-all">{a.nome_arquivo}</span>
          <button type="button" onClick={() => onDownloadAnexo(a.storage_path)} className="text-primary hover:underline shrink-0 ml-2">abrir</button>
        </div>
      ))}
    </div>
  );
}

export function ComentariosTipados({ comentarios, tipos, usuarios }: { comentarios: Comentario[]; tipos: string[]; usuarios: Usuario[] }) {
  const lista = comentarios.filter((c) => c.tipo && tipos.includes(c.tipo));
  if (lista.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {lista.map((c) => (
        <div key={c.id} className={cn("rounded border-l-2 bg-muted/30 px-2 py-1.5 text-[11px]", TIPO_COMENTARIO_BORDA[c.tipo!])}>
          <p className="font-medium">{TIPO_COMENTARIO_LABEL[c.tipo!] ?? c.tipo}</p>
          <p className="text-muted-foreground">
            {nomeUsuario(usuarios, c.autor_id) ?? "Usuário"} — {new Date(c.created_at).toLocaleString("pt-BR")}
          </p>
          <p className="mt-0.5">{c.texto}</p>
        </div>
      ))}
    </div>
  );
}

function CampoTexto({ titulo, texto, prazo }: { titulo: string; texto: string | null; prazo: string | null }) {
  if (!texto && !prazo) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium">{titulo}</p>
      {texto && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{texto}</p>}
      {prazo && <p className="text-[11px] text-muted-foreground">Prazo: {fmtData(prazo)}</p>}
    </div>
  );
}

function ResumoSolicitacaoDemanda({ card }: ResumoProps) {
  const temParteA = !!(card.area_solicitante || card.responsavel_solicitacao || (card.classificacao_demanda && card.classificacao_demanda.length > 0) || card.descricao_necessidade);
  return (
    <Bloco etapaKey="solicitacao_demanda">
      {!temParteA ? (
        <div className="space-y-2">
          {card.objetivo_solicitacao && <LvItem label="Objetivo" valor={card.objetivo_solicitacao} />}
          {card.problema_atual && <LvItem label="Problema atual" valor={card.problema_atual} />}
          {card.justificativa && <LvItem label="Justificativa" valor={card.justificativa} />}
          {card.beneficio_esperado && <LvItem label="Benefício esperado" valor={card.beneficio_esperado} />}
          {card.impacto_operacional && <LvItem label="Impacto operacional" valor={card.impacto_operacional} />}
          {card.grau_urgencia && <LvItem label="Grau de urgência" valor={GRAU_URGENCIA_LABEL[card.grau_urgencia] ?? card.grau_urgencia} />}
        </div>
      ) : (
        <div className="space-y-2">
          {card.area_solicitante && <LvItem label="Área Solicitante" valor={card.area_solicitante} />}
          {card.responsavel_solicitacao && <LvItem label="Responsável" valor={card.responsavel_solicitacao} />}
          {card.cargo_solicitante && <LvItem label="Cargo" valor={card.cargo_solicitante} />}
          {card.email_solicitante && <LvItem label="E-mail" valor={card.email_solicitante} />}
          {card.telefone_solicitante && <LvItem label="Telefone" valor={card.telefone_solicitante} />}
          {card.classificacao_demanda && card.classificacao_demanda.length > 0 && (
            <LvItem label="Classificação da Demanda" valor={listLabels(card.classificacao_demanda, CLASSIFICACAO_DEMANDA_OPCOES)} />
          )}
          {card.descricao_necessidade && <LvItem label="Descrição da Necessidade" valor={card.descricao_necessidade} />}
          {card.problema_atual && <LvItem label="Situação Atual" valor={card.problema_atual} />}
          {card.situacao_desejada && <LvItem label="Situação Desejada" valor={card.situacao_desejada} />}
          {card.justificativa && <LvItem label="Justificativa" valor={card.justificativa} />}
          {card.beneficios_esperados_lista && card.beneficios_esperados_lista.length > 0 && (
            <LvItem label="Benefícios Esperados" valor={listLabels(card.beneficios_esperados_lista, BENEFICIOS_ESPERADOS_OPCOES)} />
          )}
          {card.impacto_tipo && (
            <LvItem label="Impacto" valor={IMPACTO_TIPO_OPCOES.find((o) => o.value === card.impacto_tipo)?.label ?? card.impacto_tipo} />
          )}
          {card.areas_impactadas && <LvItem label="Áreas Impactadas" valor={card.areas_impactadas} />}
          {card.grau_urgencia && <LvItem label="Grau de Urgência" valor={GRAU_URGENCIA_LABEL[card.grau_urgencia] ?? card.grau_urgencia} />}
          {card.justificativa_urgencia && <LvItem label="Justificativa da Urgência" valor={card.justificativa_urgencia} />}
          {card.existe_processo_documentado != null && (
            <LvItem label="Processo Documentado" valor={card.existe_processo_documentado ? "Sim" : "Não"} />
          )}
          {card.codigo_processo && <LvItem label="Código do Processo" valor={card.codigo_processo} />}
          {card.tipos_documentos_apoio && card.tipos_documentos_apoio.length > 0 && (
            <LvItem label="Documentos de Apoio" valor={listLabels(card.tipos_documentos_apoio, DOCUMENTOS_APOIO_OPCOES)} />
          )}
          {card.observacoes_abertura && <LvItem label="Observações" valor={card.observacoes_abertura} />}
        </div>
      )}
    </Bloco>
  );
}

function ResumoTriagemInicial({ card }: ResumoProps) {
  return (
    <Bloco etapaKey="triagem_inicial">
      <p className="text-xs">
        <span className="font-medium">Critério:</span>{" "}
        {card.criterio_triagem ? CRITERIO_TRIAGEM_LABEL[card.criterio_triagem] ?? card.criterio_triagem : "—"}
      </p>
    </Bloco>
  );
}

function ResumoAnaliseNecessidade({ card, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="analise_necessidade">
      <CampoTexto titulo="Análise da Necessidade" texto={card.analise_necessidade_texto} prazo={card.analise_necessidade_prazo} />
      <ListaAnexos anexos={anexos} campo="analise_necessidade" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoLevantamentoFuncional({ card, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="levantamento_funcional">
      <CampoTexto titulo="Levantamento Funcional" texto={card.levantamento_funcional_texto} prazo={card.levantamento_funcional_prazo} />
      <ListaAnexos anexos={anexos} campo="levantamento_funcional" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoDocumentacaoFuncional({ card, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="documentacao_funcional">
      <CampoTexto titulo="Documentação Funcional" texto={card.documentacao_tecnica_texto} prazo={card.documentacao_tecnica_prazo} />
      <ListaAnexos anexos={anexos} campo="documentacao_tecnica" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoAnaliseTecnica({ card, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="analise_tecnica">
      <CampoTexto titulo="Análise Técnica" texto={card.analise_tecnica_texto} prazo={card.analise_tecnica_prazo} />
      <ListaAnexos anexos={anexos} campo="analise_tecnica" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoAprovacaoPriorizacao({ card, usuarios, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="aprovacao_priorizacao">
      {card.prioridade != null && <p className="text-xs"><span className="font-medium">Prioridade:</span> {card.prioridade}</p>}
      <p className="text-xs">
        <span className="font-medium">Responsável:</span>{" "}
        {nomeUsuario(usuarios, card.responsavel_user_id) ?? "—"}
      </p>
      <p className="text-xs">
        <span className="font-medium">Complexidade:</span>{" "}
        {card.complexidade ? COMPLEXIDADE_LABEL[card.complexidade] ?? card.complexidade : "—"}
      </p>
      <ListaAnexos anexos={anexos} campo="aprovacao_priorizacao" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoDesenvolvimento({ card, comentarios, usuarios }: ResumoProps) {
  return (
    <Bloco etapaKey="desenvolvimento">
      <Progress value={card.progresso_pct} className="h-2" />
      <p className="text-[11px] text-muted-foreground">{card.progresso_pct}% concluído</p>
      {card.data_fim && <p className="text-[11px] text-muted-foreground">Prazo: {fmtData(card.data_fim)}</p>}
      {card.status_desenvolvimento && (
        <p className="text-xs">
          <span className="font-medium">Status de Desenvolvimento:</span>{" "}
          {STATUS_DESENVOLVIMENTO_LABEL[card.status_desenvolvimento] ?? card.status_desenvolvimento}
        </p>
      )}
      <ComentariosTipados comentarios={comentarios} tipos={["interromper_desenvolvimento", "erro_documental"]} usuarios={usuarios} />
    </Bloco>
  );
}

const APROVACOES = Object.entries(APROVACOES_TESTES_INTERNOS).map(([campo, nome]) => ({
  campo: campo as keyof typeof APROVACOES_TESTES_INTERNOS,
  nome,
}));

function ResumoTestesInternos({ card, comentarios, usuarios, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="testes_internos">
      <div className="space-y-1">
        {APROVACOES.map((a) => (
          <label key={a.campo} className="flex items-center gap-2 text-xs">
            <Checkbox checked={card[a.campo]} disabled />
            {a.nome}
          </label>
        ))}
      </div>
      <ComentariosTipados comentarios={comentarios} tipos={["justificativa_retorno"]} usuarios={usuarios} />
      <ListaAnexos anexos={anexos} campo="testes_internos" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoHomologacaoAreaSolicitante({ comentarios, usuarios, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="homologacao_area_solicitante">
      <ComentariosTipados comentarios={comentarios} tipos={["aprovado_ressalva", "reprovado"]} usuarios={usuarios} />
      <ListaAnexos anexos={anexos} campo="homologacao_area_solicitante" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoTreinamento({ card, anexos, comentarios, usuarios, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="treinamento">
      {card.treinamento_data && <p className="text-xs">Data do treinamento: {fmtData(card.treinamento_data)}</p>}
      <ListaAnexos anexos={anexos} campo="treinamento" onDownloadAnexo={onDownloadAnexo} />
      <ComentariosTipados comentarios={comentarios} tipos={["faltou_funcoes", "encontrado_bug"]} usuarios={usuarios} />
    </Bloco>
  );
}

const IMPLANTACAO_LABEL: Record<string, string> = { sim: "Sim", nao: "Não", em_implantacao: "Em Implantação" };

function ResumoImplantacao({ card, comentarios, usuarios, anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="implantacao">
      <p className="text-xs">
        <span className="font-medium">Implantado corretamente:</span>{" "}
        {card.implantacao_status ? IMPLANTACAO_LABEL[card.implantacao_status] ?? card.implantacao_status : "—"}
      </p>
      <ComentariosTipados comentarios={comentarios} tipos={["implantacao_comentario"]} usuarios={usuarios} />
      <ListaAnexos anexos={anexos} campo="implantacao" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

function ResumoAcompanhamentoAssistido({ anexos, onDownloadAnexo }: ResumoProps) {
  return (
    <Bloco etapaKey="acompanhamento_assistido">
      <ListaAnexos anexos={anexos} campo="acompanhamento" onDownloadAnexo={onDownloadAnexo} />
    </Bloco>
  );
}

export const RESUMOS: Record<string, (props: ResumoProps) => JSX.Element> = {
  solicitacao_demanda: ResumoSolicitacaoDemanda,
  triagem_inicial: ResumoTriagemInicial,
  analise_necessidade: ResumoAnaliseNecessidade,
  levantamento_funcional: ResumoLevantamentoFuncional,
  documentacao_funcional: ResumoDocumentacaoFuncional,
  analise_tecnica: ResumoAnaliseTecnica,
  aprovacao_priorizacao: ResumoAprovacaoPriorizacao,
  desenvolvimento: ResumoDesenvolvimento,
  testes_internos: ResumoTestesInternos,
  homologacao_area_solicitante: ResumoHomologacaoAreaSolicitante,
  treinamento: ResumoTreinamento,
  implantacao: ResumoImplantacao,
  acompanhamento_assistido: ResumoAcompanhamentoAssistido,
};

// ── helpers exclusivos do AnexoIFSDCompleto ──────────────────────────────────

function FsdChk({ checked, label }: { checked: boolean; label: string }) {
  // Usa ☑/☐ Unicode: são texto puro, sem CSS background/border separado,
  // então html2canvas não tem offset entre fundo e conteúdo.
  return (
    <span style={{ display: "inline-block", fontSize: "11px", whiteSpace: "nowrap", verticalAlign: "top" }}>
      <span style={{
        display: "inline-block",
        fontSize: "13px",
        lineHeight: "1",
        color: checked ? "#153169" : "#9ca3af",
        marginRight: "3px",
        verticalAlign: "middle",
      }}>
        {checked ? "☑" : "☐"}
      </span>
      <span style={{ verticalAlign: "middle" }}>{label}</span>
    </span>
  );
}

function FsdCaixa({ valor }: { valor: string | null | undefined }) {
  return (
    <div className="min-h-[36px] whitespace-pre-wrap rounded border border-border px-2 py-1.5 text-[11px]">
      {valor || <span className="italic text-muted-foreground/50">—</span>}
    </div>
  );
}

function FsdSecao({ num, title }: { num: number; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", borderBottom: "1px solid #e5e7eb", paddingBottom: "2px", marginBottom: "6px" }}>
      {/* position:absolute no número — evita desalinhamento de fundo vs texto no html2canvas */}
      <span style={{
        position: "relative",
        display: "inline-block",
        width: "16px",
        height: "16px",
        borderRadius: "50%",
        backgroundColor: "#153169",
        flexShrink: 0,
      }}>
        <span style={{
          position: "absolute",
          top: "2px",
          left: "0",
          right: "0",
          textAlign: "center",
          color: "white",
          fontSize: "8px",
          fontWeight: "bold",
          lineHeight: "1",
        }}>
          {num}
        </span>
      </span>
      <p style={{ margin: 0, fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "#153169", lineHeight: "16px" }}>{title}</p>
    </div>
  );
}

// ── componente principal ─────────────────────────────────────────────────────

export function AnexoIFSDCompleto({
  card,
  anexos,
}: {
  card: Solicitacao;
  anexos: Anexo[];
  usuarios: Usuario[];
}) {
  const classifDemanda = card.classificacao_demanda ?? [];
  const beneficios = card.beneficios_esperados_lista ?? [];
  const docsApoio = card.tipos_documentos_apoio ?? [];
  const anexosGerais = anexos.filter((a) => !a.campo);

  return (
    <div className="space-y-0 text-[11px]">
      {/* ── PARTE A ── */}
      <div className="mb-3 bg-[#153169] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-white">
        PARTE A – SOLICITANTE
      </div>

      <div className="space-y-4 px-1">
        {/* 1. Identificação */}
        <div>
          <FsdSecao num={1} title="Identificação da Demanda" />
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              <tr>
                <td className="w-[28%] border border-border px-2 py-1.5 font-semibold">Data da Solicitação:</td>
                <td className="w-[22%] border border-border px-2 py-1.5">{fmtData(card.created_at?.slice(0, 10)) ?? "—"}</td>
                <td className="w-[22%] border border-border px-2 py-1.5 font-semibold">Área Solicitante:</td>
                <td className="w-[28%] border border-border px-2 py-1.5">{card.area_solicitante ?? "—"}</td>
              </tr>
              <tr>
                <td className="border border-border px-2 py-1.5 font-semibold">Responsável pela Solicitação:</td>
                <td className="border border-border px-2 py-1.5">{card.responsavel_solicitacao ?? "—"}</td>
                <td className="border border-border px-2 py-1.5 font-semibold">Cargo:</td>
                <td className="border border-border px-2 py-1.5">{card.cargo_solicitante ?? "—"}</td>
              </tr>
              <tr>
                <td className="border border-border px-2 py-1.5 font-semibold">E-mail:</td>
                <td className="border border-border px-2 py-1.5">{card.email_solicitante ?? "—"}</td>
                <td className="border border-border px-2 py-1.5 font-semibold">Telefone:</td>
                <td className="border border-border px-2 py-1.5">{card.telefone_solicitante ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 2. Classificação da Demanda — largura total, 3 colunas */}
        <div>
          <FsdSecao num={2} title="Classificação da Demanda" />
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 rounded border border-border px-3 py-2.5">
            {CLASSIFICACAO_DEMANDA_OPCOES.map((op) => (
              <FsdChk key={op.value} checked={classifDemanda.includes(op.value)} label={op.label} />
            ))}
          </div>
        </div>

        {/* 3–4 lado a lado */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FsdSecao num={3} title="Descrição da Necessidade" />
            <FsdCaixa valor={card.descricao_necessidade} />
          </div>
          <div>
            <FsdSecao num={4} title="Situação Atual" />
            <FsdCaixa valor={card.problema_atual} />
          </div>
        </div>

        {/* 5–6 lado a lado */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FsdSecao num={5} title="Situação Desejada" />
            <FsdCaixa valor={card.situacao_desejada} />
          </div>
          <div>
            <FsdSecao num={6} title="Justificativa" />
            <FsdCaixa valor={card.justificativa} />
          </div>
        </div>

        {/* 7. Benefícios Esperados — largura total, 3 colunas (evita quebra de texto) */}
        <div>
          <FsdSecao num={7} title="Benefícios Esperados" />
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 rounded border border-border px-3 py-2.5">
            {BENEFICIOS_ESPERADOS_OPCOES.map((op) => (
              <FsdChk key={op.value} checked={beneficios.includes(op.value)} label={op.label} />
            ))}
          </div>
        </div>

        {/* 8. Impacto da Demanda — largura total */}
        <div>
          <FsdSecao num={8} title="Impacto da Demanda" />
          <div className="rounded border border-border px-3 py-2.5">
            <div className="flex gap-8">
              {IMPACTO_TIPO_OPCOES.map((op) => (
                <FsdChk key={op.value} checked={card.impacto_tipo === op.value} label={op.label} />
              ))}
            </div>
            {card.areas_impactadas && (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground">Quais áreas impactadas:</p>
                <p className="mt-0.5">{card.areas_impactadas}</p>
              </div>
            )}
          </div>
        </div>

        {/* 9–10 lado a lado */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FsdSecao num={9} title="Grau de Urgência" />
            <div className="rounded border border-border px-3 py-2.5">
              <div className="flex gap-6">
                {(["baixa", "media", "alta"] as const).map((v) => (
                  <FsdChk key={v} checked={card.grau_urgencia === v} label={GRAU_URGENCIA_LABEL[v]} />
                ))}
              </div>
              {card.justificativa_urgencia && (
                <div className="mt-2">
                  <p className="text-[10px] text-muted-foreground">Justificativa da urgência:</p>
                  <p className="mt-0.5">{card.justificativa_urgencia}</p>
                </div>
              )}
            </div>
          </div>
          <div>
            <FsdSecao num={10} title="Processo Documentado" />
            <div className="rounded border border-border px-3 py-2.5">
              <div className="flex gap-6">
                <FsdChk checked={card.existe_processo_documentado === true} label="Sim" />
                <FsdChk checked={card.existe_processo_documentado === false} label="Não" />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Código/referência:</p>
              <p className="mt-0.5">{card.codigo_processo ?? "—"}</p>
            </div>
          </div>
        </div>

        {/* 11. Documentos de Apoio — largura total, 3 colunas */}
        <div>
          <FsdSecao num={11} title="Documentos de Apoio" />
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 rounded border border-border px-3 py-2.5">
            {DOCUMENTOS_APOIO_OPCOES.map((op) => (
              <FsdChk key={op.value} checked={docsApoio.includes(op.value)} label={op.label} />
            ))}
          </div>
        </div>

        {/* 12. Observações — largura total */}
        <div>
          <FsdSecao num={12} title="Observações" />
          <FsdCaixa valor={card.observacoes_abertura} />
        </div>
      </div>

      {/* ── PARTE B ── */}
      <div className="mb-3 mt-5 bg-[#E67E22] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-white">
        PARTE B – TRIAGEM INICIAL (CONTROLADORIA)
      </div>

      <div className="space-y-4 px-1">
        {/* 13–14 lado a lado */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FsdSecao num={13} title="Recebido por" />
            <FsdCaixa valor={card.triagem_recebido_por} />
          </div>
          <div>
            <FsdSecao num={14} title="Triagem Concluída em" />
            <FsdCaixa valor={card.triagem_concluida_em ? fmtData(card.triagem_concluida_em.slice(0, 10)) : null} />
          </div>
        </div>

        {/* 15. Classificação — largura total, 3 colunas */}
        <div>
          <FsdSecao num={15} title="Classificação da Demanda" />
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 rounded border border-border px-3 py-2.5">
            {Object.entries(TRIAGEM_CLASSIFICACAO_LABEL).map(([value, label]) => (
              <FsdChk key={value} checked={card.triagem_classificacao === value} label={label} />
            ))}
          </div>
        </div>

        {/* 16. Parecer — largura total */}
        <div>
          <FsdSecao num={16} title="Parecer da Controladoria" />
          <FsdCaixa valor={card.triagem_parecer} />
        </div>

        {/* 17 */}
        <div>
          <FsdSecao num={17} title="Encaminhar para" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-0.5 text-[10px] text-muted-foreground">Encaminhar para:</p>
              <FsdCaixa valor={card.triagem_encaminhamento_para} />
            </div>
            <div>
              <p className="mb-0.5 text-[10px] text-muted-foreground">Responsável:</p>
              <FsdCaixa valor={card.triagem_encaminhamento_responsavel} />
            </div>
          </div>
        </div>

        {/* 18–19 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FsdSecao num={18} title="Decisão da Triagem" />
            <FsdCaixa
              valor={card.triagem_decisao ? (TRIAGEM_DECISAO_LABEL[card.triagem_decisao] ?? card.triagem_decisao) : null}
            />
          </div>
          <div>
            <FsdSecao num={19} title="Data da Decisão" />
            <FsdCaixa valor={card.triagem_data_decisao ? fmtData(card.triagem_data_decisao.slice(0, 10)) : null} />
          </div>
        </div>

        {/* Anexos Gerais */}
        {anexosGerais.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Anexos Gerais</p>
            <div className="space-y-1">
              {anexosGerais.map((a) => (
                <div key={a.id} className="rounded border border-border px-2 py-1 text-[11px] leading-4">
                  <span className="break-all">{a.nome_arquivo}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Anexo II – DFD ───────────────────────────────────────────────────────────

interface DfdAnexoProps {
  card: Solicitacao;
  anexos: Anexo[];
  usuarios: Usuario[];
}

export function AnexoIIDFDCompleto({ card }: DfdAnexoProps) {
  return <DfdDocumento dados={card.dfd_dados ?? {}} card={card} isReadOnly={true} />;
}




// ── Anexo III – PTV ──────────────────────────────────────────────────────────

interface PtvAnexoProps {
  card: Solicitacao;
  anexos: Anexo[];
  usuarios: Usuario[];
}

export function AnexoIIIPTVCompleto({ card }: PtvAnexoProps) {
  return <PtvDocumento dados={card.ptv_dados ?? {}} card={card} isReadOnly={true} />;
}

export function AnexoIVAAPCompleto({ card }: { card: Solicitacao }) {
  return <AapDocumento dados={card.aap_dados ?? {}} card={card} isReadOnly={true} />;
}
