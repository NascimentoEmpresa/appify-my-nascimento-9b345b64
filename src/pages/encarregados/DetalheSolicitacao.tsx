import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { AVISO_REFAZER, diasRestantesParaRefazer, podeRefazerFerias } from "@/lib/solicitacoes/feriasRefazer";
import { ConversaSolicitacao, type ModuloConversa } from "@/components/solicitacoes/ConversaSolicitacao";
import { AnexosSolicitacao } from "@/components/solicitacoes/AnexosSolicitacao";
import { tempoDeEmpresa } from "@/lib/rh/colaboradoresUtils";
import { AvisoCancelada } from "@/components/demissao/CancelarDemissao";

// `integrations/supabase/types.ts` é gerado e não conhece as tabelas de
// solicitações. O resto do ERP resolve isso com um cast solto em cada
// chamada; aqui a exceção fica num lugar só, documentada — mesmo arranjo do
// módulo do Comitê de Ética (comite-etica/db.ts).
const db = supabase as unknown as SupabaseClient;

// =====================================================================
// ENCARREGADOS — detalhes e conversa de uma solicitação
//
// O encarregado abria a vaga, as férias ou a advertência e depois só via um
// selo de status. Não tinha como reler o que pediu, nem perguntar em que pé
// está — a conversa acontecia por fora do sistema, e quem tratava do outro
// lado respondia no vazio.
//
// A CONVERSA É A MESMA DOS DOIS LADOS, e é o ponto todo desta tela. Cada
// tipo já tem (ou passa a ter) um fio, e é nele que se entra:
//
//   Vaga        → WA_MENSAGENS_RECRUTAMENTO, o mesmo fio que o Operacional e
//                 o Recrutamento leem na Gestão de Recrutamento.
//   Férias      → SISTEMA_COMENTARIOS (modulo 'ferias'), o mesmo que o RH já
//                 usa na tela de Férias.
//   Advertência → SISTEMA_COMENTARIOS (modulo 'advertencia'). Este fio nasce
//                 aqui; o Jurídico passa a ler o mesmo.
//   Demissão    → SISTEMA_COMENTARIOS (modulo 'demissao'). Idem, do lado do
//                 Operacional e do RH.
//
// Um fio novo e separado para o encarregado seria pior que nada: os dois
// lados escreveriam sem nunca se ver.
// =====================================================================

export type TipoSolicitacao = "Vaga" | "Férias" | "Advertência" | "Demissão" | "Mudança de Função";

export interface Mensagem {
  id: number | string;
  texto: string;
  autor: string;
  quando: string;
  /** Do próprio encarregado (alinha a bolha à direita). */
  minha: boolean;
}

/** De onde sai e para onde vai a conversa de cada tipo. */
const FIO = {
  "Vaga": { tabela: "WA_MENSAGENS_RECRUTAMENTO", modulo: null },
  "Férias": { tabela: "SISTEMA_COMENTARIOS", modulo: "ferias" },
  "Advertência": { tabela: "SISTEMA_COMENTARIOS", modulo: "advertencia" },
  "Demissão": { tabela: "SISTEMA_COMENTARIOS", modulo: "demissao" },
  "Mudança de Função": { tabela: "SISTEMA_COMENTARIOS", modulo: "troca_funcao" },
} as const;

const fmt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const fmtData = (s?: string | null) => {
  if (!s) return "—";
  const t = String(s);
  const d = new Date(t.length <= 10 ? `${t}T12:00:00` : t);
  return isNaN(+d) ? t : d.toLocaleDateString("pt-BR");
};

/** Rótulo legível para cada coluna que a ficha mostra. */
const ROTULO: Record<string, string> = {
  cargo: "Cargo", contrato: "Contrato", cidade: "Cidade", estado: "Estado",
  quantidade_vagas: "Quantidade de vagas", motivo_vaga: "Motivo da vaga",
  nome_substituido: "Substituindo", data_inicio_prevista: "Início previsto",
  grau_urgencia: "Urgência", escala: "Escala", horario: "Horário",
  salario: "Salário", beneficios: "Benefícios", local_exato: "Local exato",
  insalubridade_recebe: "Insalubridade", req_obrigatorios: "Requisitos obrigatórios",
  req_desejaveis: "Requisitos desejáveis", exp_minima: "Experiência mínima",
  alta_rotatividade: "Alta rotatividade", observacao_importante: "Observação",
  analista_nome: "Analista", motivo_reprovacao: "Motivo da reprovação",
  colaborador_nome: "Colaborador", colaborador_cpf: "CPF", tipo_advertencia: "Tipo de advertência",
  colaborador_cargo: "Cargo do colaborador", colaborador_posto: "Posto",
  colaborador_filial: "Filial / contrato", colaborador_admissao: "Admissão", colaborador_escala: "Escala",
  tempo_de_empresa: "Tempo de empresa",
  colaborador_telefone: "Telefone", colaborador_email: "E-mail do colaborador",
  motivo_solicitacao: "Motivo da solicitação", motivo_pedido: "Motivo do pedido",
  relato: "Relato", termino_experiencia: "Término de experiência",
  data_aviso: "Data do aviso", modelo_aviso: "Modelo de aviso",
  operacional_motivo: "Retorno do Operacional", rh_observacao: "Observação do RH",
  // Mudança de função. `e_escritorio` fica fora de propósito: quem lê a ficha
  // não pensa em "escritório x contrato", pensa em quem está com o pedido —
  // e isso o status já diz.
  cargo_atual: "Cargo atual", cargo_novo: "Cargo novo", local: "Local / contrato",
  horario_atual: "Horário atual", horario_novo: "Horário novo", tipo: "Tipo",
  posto: "Posto", filial: "Filial", data_pretendida: "A partir de", setor: "Setor",
  sst_aso_dispensado: "ASO dispensado",
  aprovador_nome: "Aprovado por", aprovador_em: "Aprovado em",
  aprovador_motivo: "Retorno de quem aprovou",
  refeita_em: "Refeita em", data_saida: "Data de saída", data_retorno: "Retorno previsto",
  dias_ferias: "Dias de férias", dias_vendidos: "Abono (dias vendidos)", observacoes: "Observações",
  sst_por: "SST", sst_em: "SST em", sst_aso_data: "Data do ASO",
  sst_observacao: "Observação do SST",
  // Demissão: o ASO demissional, com os mesmos nomes de coluna do ASO de
  // admissão. É a informação que o encarregado repassa ao colaborador —
  // onde e quando comparecer.
  sst_data_exame: "Data do ASO demissional", sst_hora_exame: "Horário do ASO",
  sst_local_exame: "Local do ASO", sst_maps_url: "Local no Google Maps",
  data_solicitacao: "Data da solicitação",
  descricao: "Descrição", motivo: "Motivo", data_ocorrido: "Data do ocorrido",
  periodo_inicio: "Início do período", periodo_fim: "Fim do período",
  dias: "Dias", observacao: "Observação", excecao: "Exceção",
  justificativa_excecao: "Justificativa da exceção",
  // Advertência (17/09/2026): as colunas que saíam com o nome cru.
  descricao_ocorrido: "Descrição do ocorrido", ja_advertencia_anterior: "Já teve advertência anterior",
  detalhe_anterior: "Detalhe da anterior", advertencia_verbal_dada: "Advertência verbal já dada",
  data_advertencia_verbal: "Data da advertência verbal", aprovado_por_nome: "Aprovado por",
  parecer_juridico: "Parecer do Jurídico", resultado: "Resultado", concluido_por_nome: "Concluído por",
  devolvido_por: "Devolvido por", devolvido_em: "Devolvido em", devolvido_motivo: "Motivo da devolução",
  sem_vaga_motivo: "Exceção — sem vaga de substituição",
  cancelado_por: "Cancelado por", cancelado_em: "Cancelado em", cancelado_motivo: "Motivo do cancelamento",
  rh_ultima_data_trabalhada: "Última data trabalhada (RH)",
};

/** Colunas que não interessam a quem solicitou. */
const OCULTAS = new Set([
  // Salário é do Operacional e do Recrutamento, que aprovam — o encarregado
  // nem digita (na criação o campo vem do cadastro e aparece mascarado, ver
  // SALARIO_MASCARA em vagaRegras). Aqui ele estava saindo em claro.
  "salario",
  "id", "created_at", "criado_em", "updated_at", "status", "status_changed_at",
  "solicitante_email", "solicitante_cpf", "solicitante_nome", "data_inicio_alteracoes",
  // Férias refeita: contagem interna; a ficha mostra "Refeita em".
  "refeita_vezes",
  // Mudança de função: roteamento interno, não informação para quem pediu.
  "e_escritorio", "atualizado_em",
  "administrativa", "cnh_obrigatoria",
  // Demissao: ids e carimbos de quem tratou nao dizem nada a quem solicitou.
  "colaborador_id", "colaborador_cpf", "contrato_id", "atualizado_em",
  "operacional_por", "operacional_em", "rh_por", "rh_em",
]);

/**
 * A linha crua das duas tabelas de conversa.
 *
 * Elas não têm as mesmas colunas — `texto` x `mensagem` — mas o resto é
 * igual, e é isso que este tipo captura. Antes as duas eram lidas como
 * `Record<string, unknown>`, o que fazia CADA campo chegar como `unknown` e
 * a Mensagem montada não casar com o próprio tipo dela.
 */
interface LinhaMensagem {
  id: number | string;
  texto?: string | null;
  mensagem?: string | null;
  autor_nome?: string | null;
  autor_cpf?: string | null;
  created_at: string;
}

/** O texto vem de fora porque é a única coisa que muda entre as duas. */
function paraMensagem(m: LinhaMensagem, texto: string | null | undefined, email?: string | null): Mensagem {
  return {
    id: m.id,
    texto: texto ?? "",
    autor: m.autor_nome || "—",
    quando: m.created_at,
    minha: !!email && m.autor_cpf === email,
  };
}

export function DetalheSolicitacao({ tipo, id, titulo, status, onFechar, onRefazer }: {
  tipo: TipoSolicitacao;
  /**
   * `number | string` porque as duas coisas chegam: as solicitações antigas
   * têm id bigint, e Chamado e Materiais têm uuid (ver `SolItem` em
   * MinhasSolicitacoes). Declarar só `number` não impedia o uuid de chegar —
   * apenas fazia o chamador ter de mentir com um cast. Aqui dentro o id só é
   * usado em `.eq(...)` e `String(id)`, que aceitam os dois.
   */
  id: number | string;
  titulo: string;
  status: string;
  onFechar: () => void;
  /**
   * Férias (16/09/2026): o encarregado refaz a solicitação daqui. Recebe a
   * ficha carregada; quem abre o formulário é a tela de Minhas Solicitações.
   * Só aparece quando a regra deixa (podeRefazerFerias).
   */
  onRefazer?: (ficha: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const [ficha, setFicha] = useState<Record<string, unknown> | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const fimRef = useRef<HTMLDivElement | null>(null);

  // Vai gravado na mensagem — ver useMeuNome.
  const nome = useMeuNome() || "Encarregado";

  const tabelaFicha =
    tipo === "Vaga" ? "SISTEMA_RECRUTAMENTO"
    : tipo === "Férias" ? "SISTEMA_SOLICITACOES_FERIAS"
    : tipo === "Demissão" ? "SISTEMA_SOLICITACOES_DEMISSAO"
    : tipo === "Mudança de Função" ? "SISTEMA_SOLICITACOES_TROCA_FUNCAO"
    : "SISTEMA_SOLICITACOES_ADVERTENCIA";

  const carregarMsgs = useCallback(async () => {
    const fio = FIO[tipo];
    // Consultas separadas por tipo: as duas tabelas não têm as mesmas colunas
    // (`texto` x `mensagem`, `entidade_id` x `solicitacao_id`), e um select
    // genérico esconderia isso.
    // Os módulos do SISTEMA_COMENTARIOS são lidos pela ConversaSolicitacao
    // (17/09/2026) — aqui só a Vaga, que tem fio próprio.
    if (fio.modulo) { setMsgs([]); return; }
    const { data } = await db.from("WA_MENSAGENS_RECRUTAMENTO")
      .select("id, mensagem, autor_nome, autor_cpf, created_at")
      .eq("solicitacao_id", id).order("created_at");
    setMsgs((data ?? []).map((m: LinhaMensagem) => paraMensagem(m, m.mensagem, user?.email)));
  }, [tipo, id, user?.email]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await db.from(tabelaFicha).select("*").eq("id", id).maybeSingle();
      if (vivo) setFicha(data ?? null);
    })();
    carregarMsgs();
    // O outro lado responde enquanto a tela está aberta; sem isto a resposta
    // só apareceria no próximo F5.
    const t = setInterval(carregarMsgs, 8000);
    return () => { vivo = false; clearInterval(t); };
  }, [tabelaFicha, id, carregarMsgs]);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setErro("");
    const fio = FIO[tipo];
    const { error } = fio.modulo
      ? await db.from("SISTEMA_COMENTARIOS").insert({
          modulo: fio.modulo, entidade_id: String(id), texto: t,
          autor_nome: nome, autor_cpf: user?.email ?? "",
        })
      : await db.from("WA_MENSAGENS_RECRUTAMENTO").insert({
          solicitacao_id: id, mensagem: t,
          autor_nome: nome, autor_cpf: user?.email ?? "",
        });
    setEnviando(false);
    if (error) { setErro(error.message); return; }
    setTexto("");
    carregarMsgs();
  };

  // Advertência (17/09/2026): o CPF do advertido aparece (é a identificação
  // dele no documento) e o tempo de empresa entra como linha calculada logo
  // depois da admissão.
  const fichaExibida: Record<string, unknown> | null = ficha && (() => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ficha)) {
      out[k] = v;
      if (k === "colaborador_admissao" && v) out.tempo_de_empresa = tempoDeEmpresa(v) || undefined;
    }
    return out;
  })();
  const ocultas = tipo === "Advertência" ? new Set([...OCULTAS].filter(k => k !== "colaborador_cpf")) : OCULTAS;

  // As colunas preenchidas, na ordem em que o formulário as pede — em três
  // caixas contornadas (17/09/2026, pedido do Pablo): quem é o colaborador,
  // o que foi pedido e o que já foi decidido.
  const linhas = Object.entries(fichaExibida ?? {})
    .filter(([k, v]) => !ocultas.has(k) && v !== null && v !== "" && v !== undefined && !Array.isArray(v))
    // "Filial / contrato" repete "Contrato" quando os dois estão preenchidos.
    .filter(([k]) => !(k === "colaborador_filial" && fichaExibida?.contrato))
    .map(([k, v]) => [k, ROTULO[k] ?? k.replace(/_/g, " "), typeof v === "boolean" ? (v ? "Sim" : "Não")
      : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fmtData(String(v)) : String(v)] as [string, string, string]);
  const ehColaborador = (k: string) => k.startsWith("colaborador_") || k === "tempo_de_empresa" || k === "contrato" || k === "nome_substituido"
    || ["cargo_atual", "cargo_novo", "local", "posto", "filial", "horario_atual", "horario_novo"].includes(k);
  const ehDecisao = (k: string) => /^(aprovado_|aprovador_|operacional_|rh_|sst_|devolvido_|concluido_|analista_|cancelado_)/.test(k)
    || ["motivo_reprovacao", "parecer_juridico", "resultado", "sem_vaga_motivo", "refeita_em"].includes(k);
  const grupos: { titulo: string; icone: string; itens: [string, string, string][] }[] = [
    { titulo: "Colaborador", icone: "👤", itens: linhas.filter(([k]) => ehColaborador(k)) },
    { titulo: "Solicitação", icone: "📝", itens: linhas.filter(([k]) => !ehColaborador(k) && !ehDecisao(k)) },
    { titulo: "Decisões", icone: "✅", itens: linhas.filter(([k]) => ehDecisao(k)) },
  ].filter(g => g.itens.length > 0);

  return (
    <div className="ini-modal-bg" onClick={onFechar}>
      <div className="ini-modal" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 980, width: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <button onClick={onFechar} aria-label="Fechar"
                style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>

        <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, color: "#64748b", fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase" }}>
            {tipo} · #{id}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{titulo}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="ini-badge">{status}</span>
            {tipo === "Férias" && !!ficha?.refeita_em && (
              <span title={`Refeita em ${fmt(String(ficha.refeita_em))}`} style={{ fontSize: 13.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#ede9fe", color: "#6d28d9" }}>🔁 Refeita</span>
            )}
          </div>
        </div>

        {/* Demissão cancelada (17/09/2026): o motivo em vermelho, antes de tudo. */}
        {tipo === "Demissão" && ficha?.status === "Cancelada" && (
          <div style={{ marginBottom: 14 }}><AvisoCancelada solicitacao={ficha as { status: string; cancelado_por?: string | null; cancelado_em?: string | null; cancelado_motivo?: string | null }} /></div>
        )}

        {/* ── Refazer (Férias) ── */}
        {tipo === "Férias" && onRefazer && ficha && (() => {
          const regra = podeRefazerFerias({ criado_em: ficha.criado_em as string | null, status: ficha.status as string | null });
          const dias = diasRestantesParaRefazer(ficha.criado_em as string | null);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14, padding: "10px 14px", borderRadius: 12, border: `1px solid ${regra.ok ? "#c7d2fe" : "#e2e8f0"}`, background: regra.ok ? "#eef2ff" : "#f8fafc" }}>
              <div style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: regra.ok ? "#3730a3" : "#64748b", lineHeight: 1.5 }}>
                {regra.ok
                  ? <><b>Precisa corrigir algo?</b> {AVISO_REFAZER} {dias > 0 && <>Prazo: <b>{dias} dia{dias === 1 ? "" : "s"}</b>.</>}</>
                  : <><b>Refazer indisponível.</b> {regra.motivo}</>}
              </div>
              <button onClick={() => onRefazer(ficha)} disabled={!regra.ok}
                style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: regra.ok ? "#4f46e5" : "#cbd5e1", color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: regra.ok ? "pointer" : "not-allowed", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                🔁 Refazer solicitação
              </button>
            </div>
          );
        })()}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, flex: 1, minHeight: 0 }}>
          {/* ── Detalhes ── */}
          <div style={{ overflowY: "auto", paddingRight: 4 }}>
            <h4 style={{ fontSize: 13.5, fontWeight: 800, color: "#475569", margin: "0 0 10px" }}>Detalhes da solicitação</h4>
            {!ficha ? (
              <p style={{ fontSize: 13.5, color: "#64748b" }}>Carregando…</p>
            ) : linhas.length === 0 ? (
              <p style={{ fontSize: 13.5, color: "#64748b" }}>Sem informações adicionais.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {grupos.map(g => (
                  <section key={g.titulo} style={{ border: "2px solid #0f172a", borderRadius: 14, padding: "12px 14px 10px", background: "#fff" }}>
                    <h5 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900, color: "#0f172a", textTransform: "uppercase", letterSpacing: ".5px" }}>{g.icone} {g.titulo}</h5>
                    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px 16px" }}>
                      {g.itens.map(([k, rot, val]) => (
                        <div key={k} style={val.length > 80 ? { gridColumn: "1 / -1" } : undefined}>
                          <dt style={{ fontSize: 12, color: "#475569", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" }}>{rot}</dt>
                          <dd style={{ margin: 0, fontSize: 14, color: "#0f172a", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontWeight: 600 }}>{val}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            )}
            {/* Anexos da advertência (17/09/2026): quem pediu anexa quando quiser — opcional. */}
            {tipo === "Advertência" && <AnexosSolicitacao modulo="advertencia" entidadeId={id} podeAnexar titulo="Anexos da solicitação" />}
          </div>

          {/* ── Conversa ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid #e2e8f0", paddingLeft: 18 }}>
            {/* Férias, Advertência, Demissão e Mudança de Função usam o MESMO
                componente que o outro lado (17/09/2026): é ele que tem
                anexos, foto colada com Ctrl+V e cópia com Ctrl+C. Só a Vaga
                continua com o fio próprio (WA_MENSAGENS_RECRUTAMENTO). */}
            {FIO[tipo].modulo ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <ConversaSolicitacao modulo={FIO[tipo].modulo as ModuloConversa} entidadeId={id} preencher
                  aviso={tipo === "Férias"
                    ? "A mesma conversa que o RH lê na tela de Férias."
                    : tipo === "Demissão"
                      ? "A mesma conversa que o Operacional e o RH leem na tela de Demissões."
                      : tipo === "Mudança de Função"
                        ? "A mesma conversa que quem aprova, o SST e o RH leem na tela de Mudança de Função."
                        : "A mesma conversa que o Jurídico lê na tela de Advertências. Dá pra mandar foto e anexo, inclusive colando com Ctrl+V."} />
              </div>
            ) : (<>
            <h4 style={{ fontSize: 13.5, fontWeight: 800, color: "#475569", margin: "0 0 4px" }}>Conversa</h4>
            <p style={{ fontSize: 13.5, color: "#64748b", margin: "0 0 10px" }}>
              A mesma conversa que o Operacional e o Recrutamento leem.
            </p>

            <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, minHeight: 180 }}>
              {msgs.length === 0 ? (
                <p style={{ fontSize: 13.5, color: "#64748b", textAlign: "center", padding: "24px 0" }}>
                  Nenhuma mensagem ainda. Escreva abaixo para falar com quem está tratando.
                </p>
              ) : msgs.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.minha ? "flex-end" : "flex-start", marginBottom: 8 }}>
                  <div style={{
                    maxWidth: "85%", borderRadius: 12, padding: "7px 10px", fontSize: 13.5,
                    background: m.minha ? "#0f3171" : "#fff",
                    color: m.minha ? "#fff" : "#0f172a",
                    border: m.minha ? "none" : "1px solid #e2e8f0",
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, opacity: .75, marginBottom: 2 }}>
                      {m.autor} · {fmt(m.quando)}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.texto}</div>
                  </div>
                </div>
              ))}
              <div ref={fimRef} />
            </div>

            {erro && <p style={{ fontSize: 13.5, color: "#dc2626", marginTop: 6 }}>{erro}</p>}

            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <input
                value={texto} onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Escreva uma mensagem…"
                style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 11px", fontSize: 13.5, outline: "none", fontFamily: "inherit" }}
              />
              <button onClick={enviar} disabled={enviando || !texto.trim()}
                style={{ padding: "8px 15px", borderRadius: 10, border: "none", background: texto.trim() ? "#0f3171" : "#cbd5e1", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit" }}>
                {enviando ? "…" : "Enviar"}
              </button>
            </div>
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
