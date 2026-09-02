import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";

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
  colaborador_nome: "Colaborador", tipo_advertencia: "Tipo de advertência",
  colaborador_cargo: "Cargo do colaborador", colaborador_posto: "Posto",
  colaborador_filial: "Filial", colaborador_admissao: "Admissão",
  colaborador_telefone: "Telefone", colaborador_email: "E-mail do colaborador",
  motivo_solicitacao: "Motivo da solicitação", motivo_pedido: "Motivo do pedido",
  relato: "Relato", termino_experiencia: "Término de experiência",
  data_aviso: "Data do aviso", modelo_aviso: "Modelo de aviso",
  operacional_motivo: "Retorno do Operacional", rh_observacao: "Observação do RH",
  // Mudança de função. `e_escritorio` fica fora de propósito: quem lê a ficha
  // não pensa em "escritório x contrato", pensa em quem está com o pedido —
  // e isso o status já diz.
  cargo_atual: "Cargo atual", cargo_novo: "Cargo novo", local: "Local / contrato",
  posto: "Posto", filial: "Filial", data_pretendida: "A partir de", setor: "Setor",
  sst_aso_dispensado: "ASO dispensado",
  aprovador_nome: "Aprovado por", aprovador_em: "Aprovado em",
  aprovador_motivo: "Retorno de quem aprovou",
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
};

/** Colunas que não interessam a quem solicitou. */
const OCULTAS = new Set([
  // Salário é do Operacional e do Recrutamento, que aprovam — o encarregado
  // nem digita (na criação o campo vem do cadastro e aparece mascarado, ver
  // SALARIO_MASCARA em vagaRegras). Aqui ele estava saindo em claro.
  "salario",
  "id", "created_at", "criado_em", "updated_at", "status", "status_changed_at",
  "solicitante_email", "solicitante_cpf", "solicitante_nome", "data_inicio_alteracoes",
  // Mudança de função: roteamento interno, não informação para quem pediu.
  "e_escritorio", "atualizado_em",
  "administrativa", "cnh_obrigatoria",
  // Demissao: ids e carimbos de quem tratou nao dizem nada a quem solicitou.
  "colaborador_id", "colaborador_cpf", "contrato_id", "atualizado_em",
  "operacional_por", "operacional_em", "rh_por", "rh_em",
]);

export function DetalheSolicitacao({ tipo, id, titulo, status, onFechar }: {
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
    if (fio.modulo) {
      const { data } = await db.from("SISTEMA_COMENTARIOS")
        .select("id, texto, autor_nome, autor_cpf, created_at")
        .eq("modulo", fio.modulo).eq("entidade_id", String(id))
        .order("created_at");
      setMsgs((data ?? []).map((m: Record<string, unknown>) => ({
        id: m.id, texto: m.texto, autor: m.autor_nome || "—", quando: m.created_at,
        minha: !!user?.email && m.autor_cpf === user.email,
      })));
      return;
    }
    const { data } = await db.from("WA_MENSAGENS_RECRUTAMENTO")
      .select("id, mensagem, autor_nome, autor_cpf, created_at")
      .eq("solicitacao_id", id).order("created_at");
    setMsgs((data ?? []).map((m: Record<string, unknown>) => ({
      id: m.id, texto: m.mensagem, autor: m.autor_nome || "—", quando: m.created_at,
      minha: !!user?.email && m.autor_cpf === user.email,
    })));
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

  // As colunas preenchidas, na ordem em que o formulário as pede.
  const linhas = Object.entries(ficha ?? {})
    .filter(([k, v]) => !OCULTAS.has(k) && v !== null && v !== "" && v !== undefined && !Array.isArray(v))
    .map(([k, v]) => [ROTULO[k] ?? k.replace(/_/g, " "), typeof v === "boolean" ? (v ? "Sim" : "Não")
      : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fmtData(String(v)) : String(v)] as [string, string]);

  return (
    <div className="ini-modal-bg" onClick={onFechar}>
      <div className="ini-modal" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 860, width: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <button onClick={onFechar} aria-label="Fechar"
                style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>

        <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase" }}>
            {tipo} · #{id}
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{titulo}</div>
          <div style={{ marginTop: 6 }}>
            <span className="ini-badge">{status}</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, flex: 1, minHeight: 0 }}>
          {/* ── Detalhes ── */}
          <div style={{ overflowY: "auto", paddingRight: 4 }}>
            <h4 style={{ fontSize: 12, fontWeight: 800, color: "#475569", margin: "0 0 10px" }}>Detalhes da solicitação</h4>
            {!ficha ? (
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Carregando…</p>
            ) : linhas.length === 0 ? (
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Sem informações adicionais.</p>
            ) : (
              <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                {linhas.map(([rot, val]) => (
                  <div key={rot}>
                    <dt style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>{rot}</dt>
                    <dd style={{ margin: 0, fontSize: 12.5, color: "#0f172a", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{val}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* ── Conversa ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid #e2e8f0", paddingLeft: 18 }}>
            <h4 style={{ fontSize: 12, fontWeight: 800, color: "#475569", margin: "0 0 4px" }}>Conversa</h4>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 10px" }}>
              {tipo === "Vaga"
                ? "A mesma conversa que o Operacional e o Recrutamento leem."
                : tipo === "Férias"
                  ? "A mesma conversa que o RH lê na tela de Férias."
                  : tipo === "Demissão"
                    ? "A mesma conversa que o Operacional e o RH leem na tela de Demissões."
                    : tipo === "Mudança de Função"
                      ? "A mesma conversa que quem aprova, o SST e o RH leem na tela de Mudança de Função."
                      : "A mesma conversa que o Jurídico lê na tela de Advertências."}
            </p>

            <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, minHeight: 180 }}>
              {msgs.length === 0 ? (
                <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "24px 0" }}>
                  Nenhuma mensagem ainda. Escreva abaixo para falar com quem está tratando.
                </p>
              ) : msgs.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.minha ? "flex-end" : "flex-start", marginBottom: 8 }}>
                  <div style={{
                    maxWidth: "85%", borderRadius: 12, padding: "7px 10px", fontSize: 12.5,
                    background: m.minha ? "#0f3171" : "#fff",
                    color: m.minha ? "#fff" : "#0f172a",
                    border: m.minha ? "none" : "1px solid #e2e8f0",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, opacity: .75, marginBottom: 2 }}>
                      {m.autor} · {fmt(m.quando)}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.texto}</div>
                  </div>
                </div>
              ))}
              <div ref={fimRef} />
            </div>

            {erro && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 6 }}>{erro}</p>}

            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <input
                value={texto} onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Escreva uma mensagem…"
                style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 11px", fontSize: 12.5, outline: "none", fontFamily: "inherit" }}
              />
              <button onClick={enviar} disabled={enviando || !texto.trim()}
                style={{ padding: "8px 15px", borderRadius: 10, border: "none", background: texto.trim() ? "#0f3171" : "#cbd5e1", color: "#fff", fontSize: 12, fontWeight: 700, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit" }}>
                {enviando ? "…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
