// Arquivo: src/components/recrutamento/ModalNovaVaga.tsx
//
// O formulário de abrir vaga — o MESMO, em toda tela que abre vaga do
// escritório: Gestão de Recrutamento e Central de Serviços › Solicitar Vaga.
//
// Nasceu dentro de rh/Recrutamento.tsx e saiu de lá em 03/09/2026, quando a
// Central de Serviços passou a pedir vaga também. Copiar o wizard pela
// terceira vez era garantir que as três versões divergissem: já tinham
// divergido duas (a do encarregado ficou sem o vínculo com o catálogo de
// Suprimentos e com um select de contratos que renderizava "[object Object]").
//
// O que este modal tem e o do encarregado (pages/MinhasSolicitacoes.tsx) NÃO
// tem, de propósito:
//   • o botão "✍️ Preencher manualmente" na etapa 1 — vaga do escritório, em
//     que cargo/contrato/escala/salário são digitados em vez de copiados do
//     cadastro de um colaborador (era um menu de três pontinhos até 04/09/2026;
//     virou botão à vista porque ninguém procura o que não aparece);
//   • o vínculo com o catálogo de Suprimentos (contrato → posto → função),
//     que é o que define uniformes e EPIs da admissão.
//
// Quem libera o preenchimento à mão é `recrutamento_vaga_administrativa`, a
// capacidade que JÁ existe em Administração › Acesso por Usuário e que também
// governa o checkbox "Vaga é administrativa?". Nenhuma chave de acesso nova
// foi criada para isto.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { semCodigoFilial } from "@/lib/rh/colaboradoresUtils";
import { buscarCustoDoPosto, insalubridadeDoCusto, beneficiosDoCusto, notaDoCusto, AVISO_SEM_POSTO, type CustoPosto } from "@/lib/recrutamento/custoPosto";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { usePermissoes } from "@/context/PermissoesContext";
import { QuadroBeneficiosDoPosto } from "@/components/licitacoes/convencoes/QuadroBeneficios";
import { useReferenciaDoPosto } from "@/hooks/useConvencoes";
import { herancaDaConvencao, urlEditarConvencao } from "@/lib/licitacoes/convencoes";
import { Link } from "react-router-dom";
import { VinculoCatalogoVaga, type ListasCatalogo } from "@/components/recrutamento/VinculoCatalogoVaga";
import { useFuncoesDoContrato } from "@/hooks/useSupCatalogo";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import {
  MOTIVOS_VAGA, MOTIVO_SUBSTITUICAO, ehSubstituicao, maximoDeVagas, quantidadeValida, avaliarPrazo, dataMinimaVaga,
  erroDaRecomendacao, recomendacaoParaBanco, cpfValido, soDigitos, maskCpf,
  cargoExigeCnh, aplicarReqCnh, REQ_CNH_TEXTO,
  rotuloReferencia, ajudaReferencia, mostraNomeReferencia, contratoDoEmpregado, rotuloContrato,
  faltamCamposManuais, podeVagaAdministrativa, statusInicialVaga, contratoEhAdministrativo, setorDoCatalogo,
  substituidosComVagaViva, avisoSubstituidoPreso, filtroEmpregadoDaVaga,
  bloqueioSubstituicao, quantitativoAcima, textoQuantitativo,
  ehAdmissao, STATUS_VAGA_GERENTE_OPERACOES, FILTRO_EMPREGADO_VAGA,
  ENDERECO_TRABALHO_AJUDA, erroEnderecoTrabalho,
  type SituacaoSubstituido, type QuantitativoContrato, type DecisaoQuantitativo,
  cargoForaDasFuncoes, escalaDiferenteDoCadastro,
} from "@/lib/recrutamento/vagaRegras";
import { maskFone } from "@/lib/telefone";
import { PerguntaLoginErp, loginErpDoBanco, loginErpParaBanco } from "./PerguntaLoginErp";
import { AlertTriangle, CheckCircle2, Undo2, PenLine, Ban, Link2, Car, Info } from "lucide-react";

// EMPREGADOS, CONTRATOS, CARGOS e SISTEMA_* não estão no types.ts gerado;
// mesmo padrão de comite-etica/db.ts — a exceção fica num lugar só.
const db = supabase as unknown as SupabaseClient;

/** Colunas de EMPREGADOS que o wizard lê do colaborador de referência. */
type EmpregadoRef = {
  ID: number;
  Nome: string;
  Empresa?: number | string | null;
  Filial?: string | null;
  "Nome Filial"?: string | null;
  "Título do Cargo"?: string | null;
  "Valor Salário"?: number | string | null;
  "% Insalubridade"?: number | string | null;
  Escala?: string | null;
  Setor_ERP?: string | null;
};

const VAGA_RESET = {
  motivo_vaga: "", administrativa: false, setor: "", nome_substituido: "", contrato: "", cargo: "",
  contrato_id: "", posto_id: "", funcao_id: "",
  estado: "", cidade: "", quantidade_vagas: "1", data_inicio_prevista: "",
  escala: "", salario: "", insalubridade_recebe: "Não", reserva_tecnica: "Não",
  vaga_encarregado: "Não", precisa_login_erp: "Não",
  insalubridade_quanto: "", beneficios: "", local_exato: "",
  tem_recomendacao: "Não", recomendacao_nome: "", recomendacao_cpf: "", recomendacao_whatsapp: "",
  grau_urgencia: "", alta_rotatividade: "Não", req_obrigatorios: "",
  req_desejaveis: "", exp_minima: "Não", exp_minima_qual: "",
  motivos_saida: "", recomendacao: "", observacao_importante: "",
  // #0845: contrato acima do cotado → motivo e quem autorizou.
  quantitativo_justificativa: "",
  // #0849: endereço físico onde a pessoa vai trabalhar (obrigatório na etapa 1).
  endereco_trabalho: "",
};

/** Explica o prazo da data escolhida: o que falta ou qual grau saiu dela. */
function PrazoAviso({ prazo }: { prazo: ReturnType<typeof avaliarPrazo> }) {
  const cor = !prazo.ok ? { bg: "#fef2f2", bd: "#fecaca", tx: "#b91c1c" }
    : prazo.grau === "Alta — Urgente" ? { bg: "#fff7ed", bd: "#fed7aa", tx: "#c2410c" }
      : prazo.grau === "Média" ? { bg: "#fefce8", bd: "#fde68a", tx: "#a16207" }
        : { bg: "#f0fdf4", bd: "#bbf7d0", tx: "#15803d" };
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, background: cor.bg, border: `1px solid ${cor.bd}`, color: cor.tx, borderRadius: 9, padding: "8px 11px", marginBottom: 12, fontWeight: 600 }}>
      {!prazo.ok
        ? <><AlertTriangle size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />{prazo.erro}</>
        : <><CheckCircle2 size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} /><b>{prazo.dias} dias úteis</b> de antecedência → urgência <b>{prazo.grau}</b>. <span style={{ fontWeight: 500 }}>O grau sai do prazo: até 13 dias úteis é urgente, de 14 a 20 é média, 21 ou mais é baixa.</span></>}
    </div>
  );
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** Chamado depois de gravar, com o nº da solicitação — para a tela recarregar a lista dela. */
  onCriada?: (id?: number) => void;
  /**
   * Aviso de sucesso/erro na tela de quem chamou. Sem isto o modal mostra os
   * próprios toasts — é o caso da Central de Serviços, que não tem nenhum.
   */
  onToast?: (msg: string, tipo?: string) => void;
  /**
   * A solicitação a EDITAR. Com ela o modal abre preenchido e grava por UPDATE
   * em vez de INSERT.
   *
   * É o mesmo formulário de propósito: "editar qualquer informação" quer dizer
   * os mesmos campos, as mesmas listas e as mesmas regras de quem cria. Um
   * segundo formulário só para corrigir vaga nasceria desatualizado no dia em
   * que alguém acrescentasse um campo aqui.
   *
   * Quem decide se este caminho existe é o painel de acesso, na capacidade
   * "Editar solicitação de vaga" — ver a migration 20260930000077.
   */
  solicitacao?: ({ id: number } & object) | null;
  /**
   * A DEMISSÃO que está abrindo esta vaga (11/09/2026). Vem da tela de
   * Solicitar Demissão, logo depois de gravar: o modal abre já em
   * Substituição, com a pessoa escolhida e travada, e grava `demissao_id`.
   *
   * Sem isto, uma vaga de Substituição procura sozinha a demissão de quem
   * foi escolhido; não achando, manda solicitar a demissão primeiro — o
   * banco recusa vaga de Substituição sem demissão (trigger
   * rec_vaga_exige_demissao), então a tela avisa antes.
   */
  vinculoDemissao?: { demissaoId: number; substituidoId: number; nome: string } | null;
}

export function ModalNovaVaga({ aberto, onFechar, onCriada, onToast, solicitacao = null, vinculoDemissao = null }: Props) {
  /** Edição existe quando veio uma solicitação com id. */
  const editando = !!solicitacao?.id;
  const { user } = useAuth();
  const { can } = usePermissoes();
  // Vaga do escritório: só quem enxerga esse tipo pode marcar uma como tal —
  // e é a mesma capacidade que libera preencher à mão.
  const podeAdministrativa = podeVagaAdministrativa(can);

  const [vaga, setVaga] = useState({ ...VAGA_RESET });
  // Contrato do escritório (ADM E ESTAGIÁRIOS) → administrativa sozinha e
  // travada (18/09/2026); fora dele, só quem tem a capacidade marca à mão.
  const contratoAdm = contratoEhAdministrativo(vaga.contrato);
  const ehAdministrativa = contratoAdm || (podeAdministrativa && !!vaga.administrativa);
  const [vagaStep, setVagaStep] = useState(1);
  // Vaga do escritório preenchida à mão, sem colaborador de referência.
  const [vagaManual, setVagaManual] = useState(false);
  const [contratosFull, setContratosFull] = useState<Record<string, unknown>[]>([]);
  // Cargos do cadastro (tabela "CARGOS"): sugestão para o modo manual, nunca
  // uma lista fechada — ver o datalist do campo Cargo.
  const [cargosFull, setCargosFull] = useState<Record<string, unknown>[]>([]);
  // Empregado -> nº da vaga de substituição que já o segura (regra do banco).
  const [presos, setPresos] = useState<Map<number, number>>(new Map());
  const [empregados, setEmpregados] = useState<EmpregadoRef[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [loadingEmps, setLoadingEmps] = useState(false);
  // Cargo/contrato vêm do cadastro do escolhido (o id prova que a pessoa foi
  // escolhida na lista, não só digitada).
  const [substituidoId, setSubstituidoId] = useState<number | null>(null);
  // A demissão que a vaga de Substituição repõe — quando existe. Desde o
  // chamado #0845 (11/11/2026) ela não é mais obrigatória: afastamento e
  // atestado vigente também liberam a substituição (ver `checagem`).
  const [demissaoId, setDemissaoId] = useState<number | null>(null);
  // #0845 — as duas validações da Substituição, respondidas pelo banco
  // (rec_vaga_substituicao_checar, mig 20261111235000): a situação de quem
  // sai e o quantitativo do contrato. `erro` = a consulta falhou; a tela
  // não barra por isso e o gatilho do banco continua sendo o piso.
  const [checagem, setChecagem] = useState<{
    estado: "ocioso" | "buscando" | "pronto" | "erro";
    situacao: SituacaoSubstituido | null;
    quantitativo: QuantitativoContrato | null;
  }>({ estado: "ocioso", situacao: null, quantitativo: null });
  // Contrato acima do cotado: "Deseja prosseguir com a contratação?"
  const [decisaoQuant, setDecisaoQuant] = useState<DecisaoQuantitativo>("");
  // O contrato que veio do cadastro do escolhido. Se a vaga trocar de
  // contrato (RT pode alterar), o quantitativo passa a ser o do novo.
  const [contratoDoEscolhido, setContratoDoEscolhido] = useState("");
  const [salvando, setSalvando] = useState(false);

  const empDebounce = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce busca colaborador
  const empTermo = useRef("");  // último termo buscado (descarta respostas obsoletas)


  // Toast próprio, usado só quando a tela de quem chamou não tem um.
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const toastId = useRef(0);
  const toast = (msg: string, type = "info") => {
    if (onToast) { onToast(msg, type); return; }
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  // ── CSS injetado ────────────────────────────────────────────────
  // Prefixo próprio (`nvg-`): o modal roda em telas que não injetam o CSS do
  // Recrutamento (`rec-`), e depender do CSS da tela hospedeira era o tipo de
  // acoplamento que quebra calado quando o modal vai para a terceira tela.
  useEffect(() => {
    if (document.getElementById("nvg-styles")) return;
    const style = document.createElement("style");
    style.id = "nvg-styles";
    style.textContent = `
      .nvg-modal-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.42);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
      /* Legibilidade (17/09/2026): mesmo ajuste dos modais de Minhas Solicitações — maior, rótulo escuro, campo com borda visível. */
      /* Cabeçalho e rodapé fixos, só o corpo rola (03/11/2026): no MacBook da
         Fernanda (1440×900 com zoom) o modal era mais alto que a tela e o
         "Próximo" ficava longe. dvh desconta a barra do navegador; vh é o
         fallback de navegador antigo. */
      .nvg-modal{background:#fff;border:1px solid #cbd5e1;border-radius:18px;width:100%;max-width:760px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;position:relative;box-shadow:0 20px 50px rgba(15,23,42,.22);color:#0f172a}
      .nvg-cabeca{flex:none;padding:24px 30px 0}
      .nvg-corpo{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 30px 4px}
      .nvg-rodape{flex:none;padding:12px 30px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px}
      .nvg-2col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      @media (max-width:640px){.nvg-2col{grid-template-columns:minmax(0,1fr);gap:0}.nvg-cabeca{padding:20px 18px 0}.nvg-corpo{padding:0 18px 4px}.nvg-rodape{padding:12px 18px 16px}}
      .nvg-fi{width:100%;background:#fff;border:1.5px solid #94a3b8;border-radius:12px;color:#0f172a;font-size:14.5px;padding:11px 13px;outline:none;font-family:inherit;transition:.15s}
      .nvg-fi::placeholder{color:#64748b}
      .nvg-fi[readonly]{background:#f1f5f9;color:#334155}
      .nvg-fi:focus{border-color:#0f3171;box-shadow:0 0 0 4px rgba(15,49,113,.14)}
      .nvg-fg{margin-bottom:16px}
      .nvg-fg label{display:block;font-size:13px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
    `;
    document.head.appendChild(style);
  }, []);

  // Abrir é sempre do zero: solicitação nova não herda o que sobrou da anterior.
  useEffect(() => {
    if (!aberto) return;
    // Editar abre com o que está gravado; solicitar abre do zero. Só os campos
    // do formulário são copiados (as chaves de VAGA_RESET): status, histórico
    // e solicitante são da solicitação, não deste formulário, e passar a linha
    // inteira para cá os traria de volta no update.
    if (solicitacao?.id) {
      // Uma linha do banco, lida por nome de coluna. O cast mora aqui, num
      // lugar só: a prop é tipada como "objeto com id" para aceitar a
      // `Solicitacao` de quem chama sem obrigar a tela a converter.
      const dados = solicitacao as unknown as Record<string, unknown>;
      const preenchido: Record<string, unknown> = { ...VAGA_RESET };
      for (const campo of Object.keys(VAGA_RESET)) {
        const v = dados[campo];
        if (v === null || v === undefined) continue;
        preenchido[campo] = typeof VAGA_RESET[campo as keyof typeof VAGA_RESET] === "boolean" ? !!v : String(v);
      }
      preenchido.administrativa = !!dados.administrativa;
      // O banco guarda boolean; este formulario fala "Sim"/"Não" porque o
      // campo é um <select>, igual ao da insalubridade logo acima.
      preenchido.reserva_tecnica = dados.reserva_tecnica ? "Sim" : "Não";
      preenchido.tem_recomendacao = dados.tem_recomendacao ? "Sim" : "Não";
      Object.assign(preenchido, loginErpDoBanco(dados));
      setVaga(preenchido as unknown as typeof VAGA_RESET);
      // Vaga já gravada sem vínculo com o catálogo continua sem ele: exigir o
      // posto agora travaria a correção de uma vaga que foi criada à mão.
      setVagaManual(!dados.posto_id);
      setSubstituidoId((dados.substituido_id as number | null) ?? null);
      setEmpSearch((dados.nome_substituido as string | null) ?? "");
      setDemissaoId((dados.demissao_id as number | null) ?? null);
    } else if (vinculoDemissao) {
      // Veio da demissão: Substituição, pessoa escolhida, tudo travado.
      setVaga({ ...VAGA_RESET, motivo_vaga: MOTIVO_SUBSTITUICAO });
      setVagaManual(false);
      setDemissaoId(vinculoDemissao.demissaoId);
      setSubstituidoId(null);
      setEmpSearch(vinculoDemissao.nome);
      (async () => {
        // O contrato da vaga sai do casamento EMPREGADOS × CONTRATOS; na
        // primeira abertura a lista de contratos ainda está carregando, e
        // escolher antes dela deixaria o contrato (travado) em branco.
        let cts = contratosFull;
        if (!cts.length) {
          const { data } = await db
            .from("CONTRATOS").select('"NOME CONTRATO", Filial, Empresa').eq("ATIVO", "SIM").order('"NOME CONTRATO"');
          cts = data ?? [];
          setContratosFull(cts);
        }
        const { data } = await db
          .from("EMPREGADOS")
          .select('"ID", "Nome", "Empresa", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Escala", "Setor_ERP"')
          .eq("ID", vinculoDemissao.substituidoId)
          .maybeSingle();
        if (data) selecionarEmpregado(data, MOTIVO_SUBSTITUICAO, cts);
        else toast("Não achei o cadastro de " + vinculoDemissao.nome + " — escolha na lista.", "err");
      })();
    } else {
      setVaga({ ...VAGA_RESET });
      setSubstituidoId(null);
      setEmpSearch("");
      setVagaManual(false);
      setDemissaoId(null);
    }
    setVagaStep(1);
    setShowEmpDrop(false);
    setEmpregados([]);
    if (!contratosFull.length) {
      (async () => {
        const { data } = await db
          .from("CONTRATOS")
          .select('"NOME CONTRATO", Filial, Empresa')
          .eq("ATIVO", "SIM")
          .order('"NOME CONTRATO"');
        if (data) setContratosFull(data);
      })();
    }
    // Cargos do cadastro oficial, para as sugestões do modo manual. São ~200
    // linhas de texto puro; carregar junto evita o combo vazio no primeiro
    // clique de quem liga o preenchimento à mão.
    if (!cargosFull.length) {
      (async () => {
        const { data } = await db
          .from("CARGOS")
          .select('"Nome do Cargo"')
          .order('"Nome do Cargo"');
        if (data) setCargosFull(data);
      })();
    }
    // contratosFull/cargosFull ficam fora das deps de propósito: as listas são
    // carregadas uma vez por sessão e recarregá-las a cada abertura não muda
    // nada na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, solicitacao?.id, vinculoDemissao?.demissaoId]);

  const buscarEmpregados = async (term: string) => {
    empTermo.current = term;
    setLoadingEmps(true);
    const { data, error } = await db
      .from("EMPREGADOS")
      .select('"ID", "Nome", "Empresa", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Escala"')
      .or(filtroEmpregadoDaVaga(vaga.motivo_vaga))
      .ilike("Nome", `%${term}%`)
      .order('"Nome"')
      .limit(50);
    if (empTermo.current !== term) return; // resposta de uma busca antiga — descarta
    setLoadingEmps(false);
    if (error) { toast("EMPREGADOS: " + error.message + " (" + (error.code ?? "?") + ")", "err"); return; }
    const lista: EmpregadoRef[] = data ?? [];
    setEmpregados(lista);
    // Só a substituição trava: nos outros motivos a pessoa é molde e pode
    // servir de molde quantas vezes for.
    setPresos(ehSubstituicao(vaga.motivo_vaga)
      ? await substituidosComVagaViva(supabase, lista.map(e => Number(e.ID)))
      : new Map());
  };

  // `motivo` pode vir por parâmetro: quando a demissão abre o modal, o
  // motivo acabou de ser setado e o estado ainda não fechou o ciclo.
  // Insalubridade e benefícios vêm da Planilha de Custo do contrato
  // (14/09/2026) — ver custoPosto.ts. Com colaborador escolhido os campos
  // ficam só leitura; no modo manual (escritório) continuam editáveis.
  const [custoPosto, setCustoPosto] = useState<CustoPosto | null>(null);
  const [custoNota, setCustoNota] = useState("");
  const [custoBuscando, setCustoBuscando] = useState(false);
  // O que o catálogo oferece pro contrato da vaga (postos/funções) e o
  // colaborador escolhido nesta sessão (pro fallback do cadastro).
  const [catListas, setCatListas] = useState<ListasCatalogo>({ postos: [], funcoes: [] });
  // Catálogo de setores do ERP (o mesmo do Acesso por Usuário e da troca de função).
  const [setoresCatalogo, setSetoresCatalogo] = useState<string[]>([]);
  useEffect(() => {
    db.from("setor_catalogo").select("nome").order("nome")
      .then(({ data }: { data: { nome: string }[] | null }) => setSetoresCatalogo((data ?? []).map(r => r.nome).filter(Boolean)));
  }, []);
  // Setor sugerido pro escritório: o de quem está pedindo (cadastro), quando
  // a vaga ainda não tem setor — o substituído, se houver, entra em selecionarEmpregado.
  const { empregado: euEmpregado } = useVinculoEmpregado();
  const setorSugerido = setorDoCatalogo(setoresCatalogo, euEmpregado?.setor);
  useEffect(() => {
    if (ehAdministrativa && !vaga.setor && setorSugerido) setVaga(v => ({ ...v, setor: setorSugerido }));
    if (!ehAdministrativa && vaga.setor) setVaga(v => ({ ...v, setor: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehAdministrativa, setorSugerido]);
  const [empEscolhido, setEmpEscolhido] = useState<EmpregadoRef | null>(null);

  // Planilha de Custo pelo POSTO do catálogo (15/09/2026). Antes a consulta
  // saía ao escolher o colaborador e a RPC adivinhava o posto por salário/
  // cargo/cidade — e errou (ASG com o V.A do supervisor). Agora só consulta
  // com posto escolhido; sem posto, V.A/V.T ficam em branco com aviso e a
  // insalubridade volta pro cadastro do colaborador.
  const postoNomeEscolhido = catListas.postos.find(p => p.id === vaga.posto_id)?.nome ?? "";
  useEffect(() => {
    if (vagaManual || !vaga.contrato) return;
    const emp = empEscolhido;
    if (!postoNomeEscolhido) {
      // Sem posto: só mexe se foi um colaborador escolhido nesta sessão —
      // vaga aberta pra edição fica com o que está gravado.
      if (!emp) return;
      const insal = insalubridadeDoCusto(null, emp["% Insalubridade"]);
      setVaga(v => ({ ...v, insalubridade_recebe: insal.recebe, insalubridade_quanto: insal.quanto, beneficios: "" }));
      setCustoPosto(null); setCustoNota(AVISO_SEM_POSTO); setCustoBuscando(false);
      return;
    }
    let vivo = true;
    setCustoBuscando(true);
    buscarCustoDoPosto(supabase, {
      contrato: vaga.contrato, posto: postoNomeEscolhido,
      cargo: emp?.["Título do Cargo"] ?? vaga.cargo, salario: emp?.["Valor Salário"] ?? vaga.salario, cidade: vaga.cidade || null,
      escala: vaga.escala || null,
    }).then(custo => {
      if (!vivo) return;
      const insal = insalubridadeDoCusto(custo, emp?.["% Insalubridade"], emp?.["Valor Salário"]);
      setVaga(v => ({ ...v, insalubridade_recebe: insal.recebe, insalubridade_quanto: insal.quanto, beneficios: beneficiosDoCusto(custo) }));
      setCustoPosto(custo); setCustoNota(notaDoCusto(custo, insal.origem, postoNomeEscolhido));
    }).finally(() => { if (vivo) setCustoBuscando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postoNomeEscolhido, vaga.contrato, empEscolhido, vagaManual, vaga.escala]);

  // Benefícios pela CONVENÇÃO COLETIVA (13/11/2026, mig 20261113100500):
  // posto escolhido → convenção do contrato (ou a do posto, na Planilha de
  // Custo) → TODOS os benefícios. Com convenção, ela manda sobre o V.A/V.T da
  // planilha e o campo fica só leitura — mudar é no cadastro da convenção.
  // Mesma consulta (e mesmo cache) do quadro "Benefícios e adicionais da vaga".
  const refConvencao = useReferenciaDoPosto(vaga.contrato_id || null, postoNomeEscolhido || null);
  const herancaVaga = postoNomeEscolhido && vaga.contrato_id ? herancaDaConvencao(refConvencao.data) : null;
  const convencaoDaVagaId = herancaVaga ? refConvencao.data?.principal_id ?? null : null;
  useEffect(() => {
    if (!herancaVaga || custoBuscando) return;
    if (vaga.beneficios !== herancaVaga.beneficios) setVaga(v => ({ ...v, beneficios: herancaVaga.beneficios }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [herancaVaga?.beneficios, custoBuscando, vaga.beneficios]);

  const selecionarEmpregado = (emp: EmpregadoRef, motivo: string = vaga.motivo_vaga, contratos: Record<string, unknown>[] = contratosFull) => {
    const jaTem = ehSubstituicao(motivo) ? presos.get(Number(emp.ID)) : undefined;
    if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return; }
    const contratoMatch = contratoDoEmpregado(contratos, emp);
    const insalCadastro = insalubridadeDoCusto(null, emp["% Insalubridade"]);
    const contratoRotulo = contratoMatch ? rotuloContrato(contratoMatch) : "";
    setSubstituidoId(emp.ID ?? null);
    setContratoDoEscolhido(contratoRotulo);
    setDecisaoQuant("");
    setVaga(v => ({
      ...v,
      // Nos outros motivos o escolhido é só o molde: o nome não entra na vaga.
      nome_substituido: mostraNomeReferencia(motivo) ? emp.Nome : "",
      cargo: emp["Título do Cargo"] ?? "",
      salario: emp["Valor Salário"] ? `R$ ${String(emp["Valor Salário"]).replace(".", ",")}` : "",
      insalubridade_recebe: insalCadastro.recebe,
      insalubridade_quanto: insalCadastro.quanto,
      beneficios: "",
      escala: emp["Escala"] ? String(emp["Escala"]) : v.escala,
      contrato: contratoRotulo || v.contrato,
      // Escritório: setor do substituído (cadastro), senão o meu; dá pra trocar.
      setor: contratoEhAdministrativo(contratoRotulo || v.contrato) ? (setorDoCatalogo(setoresCatalogo, emp["Setor_ERP"]) || setorDoCatalogo(setoresCatalogo, euEmpregado?.setor) || v.setor) : "",
      contrato_id: "", posto_id: "", funcao_id: "",
    }));
    setEmpSearch(mostraNomeReferencia(motivo) ? emp.Nome : "");
    setShowEmpDrop(false);
    // A planilha só é consultada quando o posto do catálogo for escolhido
    // (efeito acima) — até lá, aviso e V.A/V.T em branco.
    setEmpEscolhido(emp);
    setCustoPosto(null); setCustoNota(AVISO_SEM_POSTO); setCustoBuscando(false);
  };

  // Substituição (chamado #0845, 11/11/2026): escolhido quem sai, o banco
  // responde as DUAS validações — a situação dele (demissão, afastamento e
  // atestado vigente liberam; trabalhando barra) e o quantitativo do
  // contrato (ativos × cotado). Antes daqui a tela só procurava a demissão e,
  // sem ela, mandava solicitá-la primeiro; a falta de demissão não barra mais
  // sozinha. A demissão em aberto, quando existe, continua sendo vinculada.
  //
  // Editando, só checa se a pessoa mudou: a vaga antiga não é revalidada por
  // abrir o formulário para corrigir um campo.
  const substituidoGravado = (solicitacao as { substituido_id?: number | null } | null)?.substituido_id ?? null;
  const checarSubstituicao = aberto && ehSubstituicao(vaga.motivo_vaga) && !!substituidoId
    && (!editando || substituidoId !== substituidoGravado);
  // Contrato trocado à mão (RT) → quantitativo do contrato novo, pelo nome.
  const contratoTrocado = !!vaga.contrato && !!contratoDoEscolhido && vaga.contrato !== contratoDoEscolhido;
  const contratoConsulta = contratoTrocado ? vaga.contrato : "";
  // Admissão (#0848, 11/11/2026): sem colaborador; o quantitativo é do
  // contrato escolhido e é consultado assim que o cargo é escolhido.
  const admissao = ehAdmissao(vaga.motivo_vaga);
  const checarAdmissao = aberto && !editando && admissao && !!vaga.contrato.trim() && !!vaga.cargo.trim();
  // A tela consulta o quantitativo nos dois motivos; a situação de quem sai
  // só existe na Substituição.
  const checarVaga = checarSubstituicao || checarAdmissao;
  const consultaAdmissao = checarAdmissao ? vaga.contrato : "";
  useEffect(() => {
    if (checarAdmissao) {
      let vivo = true;
      setChecagem({ estado: "buscando", situacao: null, quantitativo: null });
      setDecisaoQuant("");
      const t = setTimeout(async () => {
        const { data, error } = await db.rpc("rec_vaga_substituicao_checar", { p_empregado_id: null, p_contrato: consultaAdmissao });
        if (!vivo) return;
        if (error || !data) { setChecagem({ estado: "erro", situacao: null, quantitativo: null }); return; }
        const r = data as { quantitativo: QuantitativoContrato | null };
        setChecagem({ estado: "pronto", situacao: null, quantitativo: r.quantitativo });
      }, vagaManual ? 500 : 0);  // contrato digitado à mão: espera parar de digitar
      return () => { vivo = false; clearTimeout(t); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checarAdmissao, consultaAdmissao]);
  useEffect(() => {
    if (checarAdmissao) return;
    if (!checarSubstituicao) {
      setChecagem({ estado: "ocioso", situacao: null, quantitativo: null });
      if (!editando && !vinculoDemissao) setDemissaoId(null);
      return;
    }
    let vivo = true;
    setChecagem(c => ({ ...c, estado: "buscando" }));
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc("rec_vaga_substituicao_checar", {
        p_empregado_id: substituidoId,
        p_contrato: contratoConsulta || null,
      });
      if (!vivo) return;
      if (error || !data) { setChecagem({ estado: "erro", situacao: null, quantitativo: null }); return; }
      const r = data as { situacao: SituacaoSubstituido | null; quantitativo: QuantitativoContrato | null };
      setChecagem({ estado: "pronto", situacao: r.situacao, quantitativo: r.quantitativo });
      if (!vinculoDemissao) setDemissaoId(r.situacao?.demissao_id ?? null);
    }, contratoConsulta ? 500 : 0);  // contrato digitado: espera parar de digitar
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checarSubstituicao, substituidoId, contratoConsulta]);

  // ── Cargos do contrato (Admissão, #0848) ─────────────────────────────
  // "Deve carregar somente os cargos que já estão definidos/vinculados ao
  // contrato selecionado." A fonte é o catálogo do contrato (Contratos ›
  // postos e funções — o mesmo de Suprimentos, que define uniforme/EPI e de
  // onde vêm V.A e V.T): escolher a função já preenche posto e função da
  // vaga. Contrato fora do catálogo ou sem função cadastrada: os cargos de
  // quem está ativo no contrato hoje, para a admissão não travar — com aviso.
  const admissaoPeloContrato = admissao && !vagaManual;
  const { data: funcoesDoContrato = [], isFetching: buscandoFuncoes } =
    useFuncoesDoContrato(admissaoPeloContrato && vaga.contrato_id ? vaga.contrato_id : null);
  const [cargosDoQuadro, setCargosDoQuadro] = useState<string[]>([]);
  const contratoEscolhido = contratosFull.find(c => rotuloContrato(c) === vaga.contrato) ?? null;
  const filialDoContrato = String(contratoEscolhido?.Filial ?? "").trim();
  const usarCargosDoQuadro = admissaoPeloContrato && !!vaga.contrato && !buscandoFuncoes && funcoesDoContrato.length === 0;
  useEffect(() => {
    if (!usarCargosDoQuadro || !filialDoContrato) { setCargosDoQuadro([]); return; }
    let vivo = true;
    db.from("EMPREGADOS").select('"Título do Cargo"').eq("Filial", filialDoContrato)
      .or(FILTRO_EMPREGADO_VAGA).limit(2000)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (!vivo) return;
        const nomes = [...new Set((data ?? []).map(r => String(r["Título do Cargo"] ?? "").trim()).filter(Boolean))].sort();
        setCargosDoQuadro(nomes);
      });
    return () => { vivo = false; };
  }, [usarCargosDoQuadro, filialDoContrato]);
  // Função com o mesmo nome em dois postos: o posto entra no rótulo.
  const nomesRepetidos = new Set(funcoesDoContrato.map(x => x.nome).filter((n, i, a) => a.indexOf(n) !== i));

  // Quem é o Gerente de Operações (vai no aviso da Admissão).
  const [gerentesOperacoes, setGerentesOperacoes] = useState<string[]>([]);
  useEffect(() => {
    if (!aberto) return;
    db.rpc("rec_gerente_operacoes_nomes").then(({ data }: { data: string[] | null }) => setGerentesOperacoes(data ?? []));
  }, [aberto]);

  // O que ainda prende a etapa 1 de uma Substituição (null = nada).
  const quantAcima = quantitativoAcima(checagem.quantitativo);
  const bloqueioSubst = checarVaga
    ? bloqueioSubstituicao({
        situacao: checagem.situacao, quantitativo: checagem.quantitativo,
        decisao: decisaoQuant, justificativa: vaga.quantitativo_justificativa,
      })
    : null;
  // "Avanço bloqueado pela situação do colaborador" — o botão fica cinza.
  const situacaoBarra = checarSubstituicao && checagem.estado === "pronto" && !!checagem.situacao && !checagem.situacao.permite;

  /**
   * Liga e desliga o preenchimento à mão, com a solicitação já aberta.
   *
   * Cargo, contrato, escala e salário passam a ser digitados em vez de virem
   * do cadastro de um colaborador. Só existe para quem tem a capacidade de
   * vaga administrativa — ver `podePreencherVagaManual` em
   * lib/recrutamento/vagaRegras.ts, que explica por que o escritório precisa
   * disso e por que a chave é a capacidade, não o setor.
   *
   * NÃO marca `administrativa` sozinho. O checkbox está no mesmo passo, à
   * vista, e é do dono da solicitação decidir: nem toda vaga preenchida à mão
   * é vaga que precisa sumir de quem não tem a capacidade. Marcar por conta
   * seria esconder a vaga sem ninguém ter pedido.
   *
   * Ao DESLIGAR, limpa o que foi digitado à mão: esses campos passam a
   * prometer que vieram do cadastro, e deixar o texto antigo faria a tela
   * mentir sobre a origem deles.
   */
  const alternarVagaManual = () => {
    setVagaManual(atual => {
      if (atual) {
        setSubstituidoId(null);
        setEmpSearch("");
        setVaga(v => ({
          ...v, nome_substituido: "", cargo: "", contrato: "", salario: "", escala: "",
        }));
      }
      return !atual;
    });
  };

  // Prazo/grau da data escolhida — o grau não é mais escolhido na mão.
  const prazo = avaliarPrazo(vaga.data_inicio_prevista);
  const cnhDoCargo = cargoExigeCnh(vaga.cargo);
  // Reserva Técnica (14/10/2026, Pablo): "se for RT tem que selecionar um
  // colaborador de exemplo do mesmo posto, mas pode ser possível alterar as
  // informações manualmente ainda". O exemplo é obrigatório (mesmo no modo
  // manual) e só serve de molde: contrato, cargo e insalubridade continuam
  // editáveis depois de escolhido.
  const ehRT = vaga.reserva_tecnica === "Sim";
  const camposEditaveis = vagaManual || ehRT;

  const vagaValidar = (step: number) => {
    if (step === 1) {
      if (!vaga.motivo_vaga) { toast("Selecione o motivo da vaga.", "err"); return false; }

      // No modo manual ninguém preenche por você: o que o cadastro daria vira
      // digitação, e o que era "escolha alguém" vira "informe o campo".
      if (ehRT && !substituidoId && !ehAdmissao(vaga.motivo_vaga)) {
        toast("Vaga de Reserva Técnica: escolha na lista um colaborador de exemplo do mesmo posto — depois dá para ajustar os dados.", "err");
        return false;
      }
      if (vagaManual) {
        const faltam = faltamCamposManuais(vaga);
        if (faltam.length) {
          toast(`Preenchendo à mão, ${faltam.join(" e ")} ${faltam.length > 1 ? "são obrigatórios" : "é obrigatório"}.`, "err");
          return false;
        }
        // Substituição é o único motivo que PRECISA dizer quem sai — é esse
        // vínculo que impede duas vagas repondo a mesma pessoa.
        if (ehSubstituicao(vaga.motivo_vaga) && !substituidoId) {
          toast("Em Substituição, escolha na lista quem será substituído — mesmo preenchendo o resto à mão.", "err");
          return false;
        }
      } else if (ehAdmissao(vaga.motivo_vaga)) {
        // Admissão (#0848): contrato e depois um cargo vinculado a ele.
        if (!vaga.contrato) { toast("Selecione o contrato da vaga.", "err"); return false; }
        if (!vaga.cargo.trim()) { toast("Selecione um dos cargos vinculados ao contrato.", "err"); return false; }
      } else if (!substituidoId) {
        toast(ehSubstituicao(vaga.motivo_vaga)
          ? "Escolha na lista o colaborador que será substituído — o cargo e o contrato vêm do cadastro dele."
          : "Escolha na lista alguém com o mesmo cargo da vaga — é de lá que vêm cargo, contrato, escala e salário.", "err");
        return false;
      }

      // Substituição (#0845): a situação de quem sai e o quantitativo do
      // contrato. Sem demissão não barra mais — afastamento e atestado
      // vigente liberam; só "trabalhando" barra. O gatilho do banco
      // (rec_vaga_exige_demissao, mig 20261111235000) cobra o mesmo.
      if (checarVaga) {
        if (checagem.estado === "buscando") { toast("Um instante — consultando a situação do colaborador e o quantitativo do contrato.", "err"); return false; }
        if (bloqueioSubst) { toast(bloqueioSubst, "err"); return false; }
      }
      const jaTem = ehSubstituicao(vaga.motivo_vaga) && substituidoId ? presos.get(substituidoId) : undefined;
      // Editando, a vaga que "prende" a pessoa costuma ser ESTA — recusar aí
      // seria impedir a correção por causa dela mesma.
      if (jaTem && jaTem !== solicitacao?.id) { toast(avisoSubstituidoPreso(jaTem), "err"); return false; }
      if (!vaga.contrato)    { toast("Selecione o contrato.", "err"); return false; }
      if (!vaga.cargo.trim()){ toast("Informe o cargo.", "err"); return false; }
      // Posto e função do catálogo (15/09/2026): obrigatórios quando o
      // contrato tem posto no catálogo — é do posto que vêm o V.A e o V.T.
      if (vaga.contrato_id && catListas.postos.length > 0 && !vaga.posto_id) { toast("Selecione o posto no catálogo de Suprimentos — é dele que vêm o V.A e o V.T da vaga.", "err"); return false; }
      if (vaga.posto_id && catListas.funcoes.length > 0 && !vaga.funcao_id) { toast("Selecione a função do posto no catálogo de Suprimentos.", "err"); return false; }
      // #0849: depois do posto, o endereço efetivo do local de trabalho.
      const erroEnd = erroEnderecoTrabalho(vaga.endereco_trabalho);
      if (erroEnd) { toast(erroEnd, "err"); return false; }
      // Estado e cidade obrigatórios (15/09/2026): é o local da vaga, e sem
      // ele o Recrutamento não sabe onde divulgar nem de onde é o candidato.
      if (!vaga.estado) { toast("Selecione o estado (UF) da vaga.", "err"); return false; }
      if (!vaga.cidade) { toast("Selecione a cidade da vaga.", "err"); return false; }
      // O vínculo com o catálogo de Suprimentos é OPCIONAL (15/09/2026): sem
      // posto no catálogo, o Compras monta uniformes/EPIs na admissão. O
      // contrato do vínculo é sempre o da vaga (VinculoCatalogoVaga).
    }
    if (step === 2) {
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
      // Local exato obrigatório (16/09/2026): o posto do catálogo não diz em
      // qual unidade/endereço a pessoa vai trabalhar, e sem isso a vaga
      // abria "errada" — o Recrutamento não sabia pra onde contratar.
      if (!vaga.local_exato.trim()) { toast("Descreva o local exato da vaga (unidade, endereço, ponto de referência).", "err"); return false; }
      if (!vaga.escala.trim()) { toast("Informe a escala/horário da vaga.", "err"); return false; }
    }
    if (step === 3) {
      // A indicação é do passo 3: se disse que tem, os três campos vêm
      // juntos. A regra é a mesma nas duas telas de vaga.
      const erroRec = erroDaRecomendacao(vaga);
      if (erroRec) { toast(erroRec, "err"); return false; }
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
    }
    return true;
  };

  const submitVaga = async () => {
    if (salvando) return;
    if (!vagaValidar(1) || !vagaValidar(2) || !vagaValidar(3)) return;
    setSalvando(true);
    const payload: Record<string, unknown> = {
      ...vaga,
      // A tela já trava o campo em 1 na substituição; aqui é o cinto de
      // segurança, porque trocar o motivo depois de digitar 3 deixaria o 3
      // no estado.
      quantidade_vagas: quantidadeValida(vaga.motivo_vaga, vaga.quantidade_vagas),
      ...recomendacaoParaBanco(vaga),
      reserva_tecnica: vaga.reserva_tecnica === "Sim",
      ...loginErpParaBanco(vaga),
      // Grau e CNH saem das regras (o trigger recalcula os dois no banco).
      grau_urgencia: prazo.grau ?? "",
      req_obrigatorios: aplicarReqCnh(vaga.req_obrigatorios, vaga.cargo),
      cnh_obrigatoria: !!cnhDoCargo,
      administrativa: ehAdministrativa,
      setor: vaga.setor || null,
      // Só a substituição grava o id: é ele que trava a pessoa numa vaga só.
      substituido_id: ehSubstituicao(vaga.motivo_vaga) ? substituidoId : null,
      demissao_id: ehSubstituicao(vaga.motivo_vaga) ? demissaoId : null,
      // #0845: o retrato do que a tela mostrou ao abrir a vaga.
      ...(checarVaga && checagem.estado === "pronto" ? {
        substituido_situacao: checagem.situacao?.situacao ?? null,
        substituido_situacao_texto: checagem.situacao?.texto ?? null,
        quantitativo_ativos: checagem.quantitativo?.ativos ?? null,
        quantitativo_cotado: checagem.quantitativo?.cotado ?? null,
      } : {}),
      quantitativo_justificativa: quantAcima && decisaoQuant === "sim" ? vaga.quantitativo_justificativa.trim() : (vaga.quantitativo_justificativa.trim() || null),
      // Catálogo (opcional desde 15/09/2026): as colunas são uuid, e "" não é
      // uuid — vazio tem que ir como NULL ("invalid input syntax for type uuid").
      contrato_id: vaga.contrato_id || null,
      posto_id: vaga.posto_id || null,
      funcao_id: vaga.funcao_id || null,
    };

    // Status, solicitante e data de abertura são da SOLICITAÇÃO, não deste
    // formulário: corrigir o cargo de um pedido não pode devolvê-lo para
    // "Pendente Analista" nem trocar o nome de quem pediu.
    if (!editando) {
      // Administrativa ou com setor → Diretoria (16/09/2026); o resto → analista.
      payload.status = statusInicialVaga(ehAdministrativa, vaga.setor || null);
      // #0848: toda Admissão nova espera o Gerente de Operações (o banco
      // repete a regra em trg_rec_vaga_admissao_gerente).
      if (ehAdmissao(vaga.motivo_vaga)) payload.status = STATUS_VAGA_GERENTE_OPERACOES;
      payload.solicitante_nome = user?.user_metadata?.nome ?? user?.email ?? "";
      payload.solicitante_cpf = user?.email ?? "";
    }

    const gravar = (corpo: Record<string, unknown>) =>
      editando
        ? db.from("SISTEMA_RECRUTAMENTO").update(corpo).eq("id", solicitacao!.id).select("id").single()
        : db.from("SISTEMA_RECRUTAMENTO").insert(corpo).select("id").single();

    let { error, data } = await gravar(payload);
    // Banco ainda sem as colunas novas: reenvia sem elas.
    if (error && /column|schema cache/i.test(error.message)) {
      const { cnh_obrigatoria, substituido_id, demissao_id, contrato_id, posto_id, funcao_id, reserva_tecnica, vaga_encarregado, precisa_login_erp, tem_recomendacao, recomendacao_nome, recomendacao_cpf, recomendacao_whatsapp,
        endereco_trabalho, substituido_situacao, substituido_situacao_texto, quantitativo_ativos, quantitativo_cotado, quantitativo_justificativa, ...semColunasNovas } = payload;
      ({ error, data } = await gravar(semColunasNovas));
    }
    setSalvando(false);
    if (error) { toast(`Erro ao ${editando ? "salvar" : "solicitar"} vaga: ` + error.message, "err"); return; }
    toast(
      editando
        ? `Solicitação #${solicitacao!.id} atualizada.`
        : ehAdmissao(vaga.motivo_vaga)
          ? `Solicitação #${data?.id} criada — aguardando aprovação do Gerente de Operações.`
          : `Solicitação #${data?.id} criada com sucesso!`,
      "ok",
    );
    onFechar();
    onCriada?.(editando ? solicitacao!.id : data?.id);
  };

  if (!aberto) return null;

  // Portal no <body>: o wrapper de rota (`sh-entra`, AppShell) anima com
  // `transform`, e transform num ancestral vira o containing block do
  // `position: fixed`. No Chrome do Mac o overlay ficava preso na área do
  // conteúdo (só o card da página escurecia) e o modal, centrado nela,
  // estourava para cima da tela — sem como rolar até o topo (03/11/2026).
  return createPortal(
    <div className="nvg-modal-ov">
      <div className="nvg-modal" onClick={e => e.stopPropagation()}>
        <div className="nvg-cabeca">
        <button onClick={onFechar} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>

        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
          {editando ? `Editar solicitação #${solicitacao!.id}` : "Solicitar Nova Vaga"}
        </div>
        <div style={{ fontSize: 13.5, color: "#64748b", marginBottom: 14 }}>
          {vagaStep === 1 ? "Etapa 1 de 3 — Identificação da Vaga" : vagaStep === 2 ? "Etapa 2 de 3 — Detalhes do Posto" : "Etapa 3 de 3 — Requisitos e Urgência"}
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < vagaStep ? "#16a34a" : i === vagaStep ? "#0f3171" : "#dbe4f0", transition: "background .2s" }}></div>
          ))}
        </div>
        </div>

        <div className="nvg-corpo">

        {/* Botão VISÍVEL, não mais escondido atrás de três pontinhos (04/09/2026).
            Ninguém procura uma opção que não se vê: quem abre vaga do escritório
            precisava saber de antemão que o menu existia. Fica só na etapa 1,
            que é onde o modo muda o formulário, e só para quem tem a capacidade
            `recrutamento_vaga_administrativa` — a mesma do checkbox lá embaixo. */}
        {podeAdministrativa && vagaStep === 1 && (
          <button
            type="button"
            aria-pressed={vagaManual}
            onClick={alternarVagaManual}
            style={{
              display: "flex", alignItems: "flex-start", gap: 9, width: "100%", marginBottom: 16,
              padding: "10px 13px", borderRadius: 11, cursor: "pointer", textAlign: "left",
              fontFamily: "inherit",
              background: vagaManual ? "#eef4ff" : "#fff",
              border: vagaManual ? "1.5px solid #0f3171" : "1px solid #e2e8f0",
              transition: "background .18s, border-color .18s",
            }}
            onMouseEnter={e => { if (!vagaManual) e.currentTarget.style.background = "#f8fafc"; }}
            onMouseLeave={e => { if (!vagaManual) e.currentTarget.style.background = "#fff"; }}
          >
            <span style={{ display: "inline-flex", lineHeight: 1.2 }}>{vagaManual ? <Undo2 size={15} aria-hidden /> : <PenLine size={15} aria-hidden />}</span>
            <span>
              <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: vagaManual ? "#0f3171" : "#0f172a" }}>
                {vagaManual ? "Voltar a puxar do cadastro" : "Preencher manualmente"}
              </span>
              <span style={{ display: "block", marginTop: 3, fontSize: 14, fontWeight: 500, color: "#64748b", lineHeight: 1.4 }}>
                {vagaManual
                  ? "Volta a escolher um colaborador; cargo, contrato, escala e salário vêm do cadastro dele."
                  : "Vaga do escritório: você digita cargo, contrato, escala e salário em vez de copiar de um colaborador."}
              </span>
            </span>
          </button>
        )}

        {/* Step 1 */}
        {vagaStep === 1 && (<>
          <div className="nvg-fg">
            <label>Motivo da Vaga *</label>
            <select className="nvg-fi" value={vaga.motivo_vaga} disabled={!!vinculoDemissao}
              style={vinculoDemissao ? { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" } : undefined}
              onChange={e => {
                const m = e.target.value;
                // Trocou de motivo: limpa tudo o que veio do cadastro do
                // escolhido anterior (senão sobra cargo/contrato/salário de
                // outro posto) e obriga a escolher de novo.
                setSubstituidoId(null); setEmpSearch(""); setEmpEscolhido(null); setDecisaoQuant("");
                setVaga(v => ({
                  ...v, motivo_vaga: m, nome_substituido: "", cargo: "", contrato: "",
                  contrato_id: "", posto_id: "", funcao_id: "",
                  salario: "", escala: "", insalubridade_recebe: "Não", insalubridade_quanto: "",
                }));
              }}>
              <option value="">— Selecione —</option>
              {MOTIVOS_VAGA.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          {/* RT subiu para a etapa 1 (14/10/2026): é ela que decide se o
              colaborador de exemplo é obrigatório e se os campos destravam. */}
          {!!vaga.motivo_vaga && (
            <div className="nvg-fg">
              <label>Essa é uma Vaga de Reserva Técnica (RT)?</label>
              <select className="nvg-fi" value={vaga.reserva_tecnica}
                onChange={e => setVaga(v => ({ ...v, reserva_tecnica: e.target.value }))}>
                <option>Não</option><option>Sim</option>
              </select>
              {/* #0845: em Substituição a RT não muda quem se escolhe — é
                  sempre quem será substituído, com RT Sim ou Não. O
                  "colaborador de exemplo do mesmo posto" ficou só para a RT
                  dos outros motivos. */}
              {ehSubstituicao(vaga.motivo_vaga) ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7fe", borderRadius: 8, padding: "6px 9px" }}>
                  Selecione abaixo o colaborador que será substituído. As informações dele virão prontas{ehRT ? " e você pode alterar o que precisar" : ""}.
                </div>
              ) : admissaoPeloContrato ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7fe", borderRadius: 8, padding: "6px 9px" }}>
                  Selecione o contrato da vaga. Depois, escolha um dos cargos vinculados a esse contrato.
                </div>
              ) : ehRT && !admissao && (
                <div style={{ marginTop: 6, fontSize: 13, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7fe", borderRadius: 8, padding: "6px 9px" }}>
                  Escolha abaixo um <b>colaborador de exemplo do mesmo posto</b>: os dados dele vêm prontos e você pode alterar o que precisar.
                </div>
              )}
            </div>
          )}
          {/* Aviso do modo manual: a pessoa precisa saber que trocou de
              regime, senão estranha os campos que antes vinham prontos. */}
          {vagaManual && (
            <div className="nvg-fg" style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7fe", borderRadius: 9, padding: "8px 11px" }}>
                <PenLine size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} /><b>Preenchendo à mão</b> — vaga do escritório. Cargo, contrato, escala e salário
                são digitados por você, e não copiados de um colaborador.
              </div>
            </div>
          )}
          {/* Em Substituição o colaborador continua obrigatório mesmo à
              mão: é o vínculo que impede duas vagas repondo a mesma pessoa. */}
          {/* Admissão (#0848) não tem colaborador de referência: parte do contrato. */}
          {!!vaga.motivo_vaga && !admissao && (!vagaManual || ehSubstituicao(vaga.motivo_vaga) || ehRT) && (
            <div className="nvg-fg" style={{ position: "relative" }}
              onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
              <label>{ehRT && !ehSubstituicao(vaga.motivo_vaga) ? "Colaborador de exemplo (mesmo posto)" : rotuloReferencia(vaga.motivo_vaga)} *</label>
              <input
                className="nvg-fi"
                placeholder="Buscar e escolher na lista..."
                value={empSearch}
                autoComplete="off"
                readOnly={!!vinculoDemissao}
                style={vinculoDemissao ? { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" } : undefined}
                onChange={e => {
                  const v = e.target.value;
                  setEmpSearch(v);
                  setSubstituidoId(null);
                  // Digitar não vale escolher: o que ficou do último
                  // escolhido sai daqui, e só volta quando clicarem na lista.
                  setVaga(prev => ({
                    ...prev, nome_substituido: "", cargo: "", contrato: "", salario: "", escala: "",
                    contrato_id: "", posto_id: "", funcao_id: "",
                  }));
                  if (empDebounce.current) clearTimeout(empDebounce.current);
                  if (v.trim().length >= 2) {
                    setShowEmpDrop(true);
                    setLoadingEmps(true);
                    empDebounce.current = setTimeout(() => buscarEmpregados(v.trim()), 350);
                  } else { setShowEmpDrop(false); setEmpregados([]); }
                }}
              />
              {showEmpDrop && empSearch.length >= 2 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                  {loadingEmps ? (
                    <div style={{ padding: "12px", fontSize: 13.5, color: "#64748b", textAlign: "center" }}>Buscando...</div>
                  ) : empregados.length === 0 ? (
                    <div style={{ padding: "12px", fontSize: 13.5, color: "#64748b", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                  ) : empregados.slice(0, 40).map((emp, i) => {
                    // Já tem vaga de substituição em pé: fica na lista
                    // para a pessoa entender por que não pode escolher.
                    const preso = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
                    return (
                      <div key={i} onMouseDown={() => selecionarEmpregado(emp)}
                        style={{ padding: "8px 12px", fontSize: 13, cursor: preso ? "not-allowed" : "pointer", borderBottom: "1px solid #f1f5f9", color: preso ? "#64748b" : "#0f172a", background: preso ? "#f8fafc" : "#fff" }}
                        onMouseEnter={e => { if (!preso) e.currentTarget.style.background = "#f0f4ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = preso ? "#f8fafc" : "#fff"; }}>
                        <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                        <div style={{ fontSize: 14, color: "#64748b" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                        {preso && <div style={{ fontSize: 13.5, fontWeight: 800, color: "#b91c1c", marginTop: 2 }}><Ban size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />já está na vaga de substituição #{preso}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              {!ehSubstituicao(vaga.motivo_vaga) && (
                <div style={{ marginTop: 6, fontSize: 13, color: "#64748b" }}>{ehRT ? "Reserva Técnica: escolha alguém do mesmo posto. Contrato, cargo, escala, salário e insalubridade vêm dele e podem ser alterados." : ajudaReferencia(vaga.motivo_vaga)}</div>
              )}
              {/* Sem nome: nos motivos que não são Substituição o escolhido
                  é só o molde da vaga, e é isso que a tela confirma. */}
              {!!substituidoId && !mostraNomeReferencia(vaga.motivo_vaga) && (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 9px" }}>
                  ✓ Colaborador escolhido — cargo, contrato, escala e salário já vieram do cadastro dele{ehRT ? "; altere o que precisar" : ""}.
                </div>
              )}
              {/* Situação de quem sai (#0845, 11/11/2026). Era "não existe
                  solicitação de demissão — solicite a demissão primeiro", com
                  botão obrigatório; agora demissão, afastamento (qualquer
                  motivo) e atestado vigente liberam, e só quem está
                  trabalhando barra. A frase vem pronta do banco. */}
              {checarSubstituicao && !vinculoDemissao && (
                checagem.estado === "buscando" ? (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Consultando a situação do colaborador…</div>
                ) : checagem.estado === "erro" ? (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px" }}>
                    Não foi possível consultar a situação do colaborador agora. Você pode seguir; ao enviar, o sistema confere de novo.
                  </div>
                ) : checagem.situacao?.permite ? (
                  <div style={{ marginTop: 8, display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13.5, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "9px 12px" }}>
                    <CheckCircle2 size={18} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{checagem.situacao.texto}</span>
                  </div>
                ) : checagem.situacao ? (
                  <div role="alert" style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px" }}>
                    <AlertTriangle size={20} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <b style={{ display: "block", fontSize: 14.5 }}>{checagem.situacao.texto.split(". ")[0]}.</b>
                      {checagem.situacao.texto.split(". ").slice(1).join(". ")}
                    </span>
                  </div>
                ) : null
              )}
              {!!vinculoDemissao && (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7f5", borderRadius: 8, padding: "6px 9px" }}>
                  <Link2 size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />Vaga aberta a partir da solicitação de demissão #{vinculoDemissao.demissaoId} — motivo e colaborador vêm de lá e não mudam aqui.
                </div>
              )}
            </div>
          )}
          {/* Contrato e cargo vêm do cadastro do escolhido e ficam travados
              — a vaga é do posto dele, não de outro.

              À mão os dois viram lista COM digitação livre (`datalist`): o que
              existe no cadastro aparece pronto para escolher, e o que não
              existe ainda — cargo novo, contrato que só o escritório usa —
              continua sendo aceito digitado. Uma lista fechada aqui obrigaria
              a cadastrar antes de pedir; um campo de texto puro devolveria
              "ANALISTA ADM" e "Analista Administrativo" como coisas
              diferentes. */}
          {admissaoPeloContrato ? (<>
            <div className="nvg-fg">
              <label>Contrato <span style={{ color: "#dc2626" }}>*</span></label>
              <select className="nvg-fi" value={vaga.contrato}
                onChange={e => {
                  const c = e.target.value;
                  // Trocou o contrato: o cargo era do anterior.
                  setVaga(v => ({ ...v, contrato: c, cargo: "", posto_id: "", funcao_id: "" }));
                  setDecisaoQuant("");
                }}>
                <option value="">— Selecione o contrato —</option>
                {vaga.contrato && !contratoEscolhido && <option value={vaga.contrato}>{vaga.contrato}</option>}
                {contratosFull.map((c, i) => <option key={i} value={rotuloContrato(c)}>{rotuloContrato(c)}</option>)}
              </select>
              <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>Ao selecionar o contrato, aparecem os cargos vinculados a ele.</div>
            </div>
            <div className="nvg-fg">
              <label>Cargo <span style={{ color: "#dc2626" }}>*</span></label>
              <select className="nvg-fi" disabled={!vaga.contrato}
                value={vaga.funcao_id || (vaga.cargo ? "q:" + vaga.cargo : "")}
                onChange={e => {
                  const v = e.target.value;
                  setDecisaoQuant("");
                  if (v.startsWith("q:")) { setVaga(x => ({ ...x, cargo: v.slice(2), posto_id: "", funcao_id: "" })); return; }
                  const fn = funcoesDoContrato.find(x => x.id === v);
                  setVaga(x => ({ ...x, cargo: fn?.nome ?? "", posto_id: fn?.posto_id ?? "", funcao_id: fn?.id ?? "" }));
                }}>
                <option value="">{!vaga.contrato ? "Selecione o contrato primeiro" : buscandoFuncoes ? "Carregando os cargos do contrato…" : "— Selecione o cargo —"}</option>
                {funcoesDoContrato.map(fn => (
                  <option key={fn.id} value={fn.id}>{fn.nome}{nomesRepetidos.has(fn.nome) ? ` — ${fn.posto_nome}` : ""}</option>
                ))}
                {usarCargosDoQuadro && cargosDoQuadro.map(c => <option key={c} value={"q:" + c}>{c}</option>)}
                {vaga.cargo && !vaga.funcao_id && !cargosDoQuadro.includes(vaga.cargo) && <option value={"q:" + vaga.cargo}>{vaga.cargo}</option>}
              </select>
              <div style={{ marginTop: 4, fontSize: 13, color: usarCargosDoQuadro ? "#92400e" : "#64748b" }}>
                {!vaga.contrato ? "Cargo carregado a partir da lista de cargos definidos para o contrato selecionado."
                  : usarCargosDoQuadro
                    ? (cargosDoQuadro.length
                        ? "Este contrato não tem cargos no catálogo de postos e funções — a lista mostra os cargos de quem trabalha nele hoje."
                        : "Este contrato não tem cargos cadastrados no catálogo de postos e funções nem colaboradores ativos. Peça o cadastro dos postos e funções do contrato.")
                    : "Cargo carregado a partir da lista de cargos definidos para o contrato selecionado."}
              </div>
              {cnhDoCargo && (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                  <Car size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />{cnhDoCargo}: CNH obrigatória — já entra sozinha nos requisitos e não pode ser tirada.
                </div>
              )}
            </div>
          </>) : (<>
          <div className="nvg-fg">
            <label>Contrato *{!vagaManual && <span style={{ color: "#64748b", fontWeight: 600 }}> — do colaborador escolhido{ehRT ? "; pode alterar" : ""}</span>}</label>
            <input className="nvg-fi"
              list={camposEditaveis ? "nvg-contratos" : undefined}
              placeholder={vagaManual ? "Escolha na lista ou digite" : "Escolha o colaborador acima"}
              value={vaga.contrato} readOnly={!camposEditaveis}
              onChange={e => setVaga(v => ({ ...v, contrato: e.target.value }))}
              style={camposEditaveis ? undefined : { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
            {camposEditaveis && (
              <>
                <datalist id="nvg-contratos">
                  {contratosFull.map((c, i) => (
                    <option key={i} value={rotuloContrato(c)} />
                  ))}
                </datalist>
                <div style={{ marginTop: 4, fontSize: 14, color: "#64748b" }}>
                  Escolha um contrato da lista ou digite outro. Escolher no catálogo de
                  Suprimentos, abaixo, também preenche este campo.
                </div>
              </>
            )}
          </div>
          <div className="nvg-fg">
            <label>Cargo *{!vagaManual && <span style={{ color: "#64748b", fontWeight: 600 }}> — do colaborador escolhido{ehRT ? "; pode alterar" : ""}</span>}</label>
            <input className="nvg-fi"
              list={camposEditaveis ? "nvg-cargos" : undefined}
              placeholder={vagaManual ? "Escolha na lista ou digite" : "Escolha o colaborador acima"}
              value={vaga.cargo} readOnly={!camposEditaveis}
              onChange={e => setVaga(v => ({ ...v, cargo: e.target.value }))}
              style={camposEditaveis ? undefined : { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
            {camposEditaveis && (
              <>
                <datalist id="nvg-cargos">
                  {cargosFull.map((c, i) => (
                    <option key={i} value={String(c["Nome do Cargo"] ?? "")} />
                  ))}
                </datalist>
                <div style={{ marginTop: 4, fontSize: 14, color: "#64748b" }}>
                  Escolha um cargo da lista ou digite outro, se o que você precisa ainda não existe.
                </div>
              </>
            )}
            {/* 19/10/2026 (vaga #1376): o cargo vem do cadastro do escolhido; se
                ele não é nenhuma das funções do posto do catálogo, o cadastro
                pode estar errado. Só avisa — nome de função e de cargo variam. */}
            {!vagaManual && !!vaga.posto_id && cargoForaDasFuncoes(vaga.cargo, catListas.funcoes.map(f => f.nome)) && (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                <AlertTriangle size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />
                O cargo {vaga.cargo} não é nenhuma das funções deste posto ({catListas.funcoes.map(f => f.nome).join(", ")}). Confira com o RH se o cadastro do colaborador está certo antes de enviar.
              </div>
            )}
            {cnhDoCargo && (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                <Car size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />{cnhDoCargo}: CNH obrigatória — já entra sozinha nos requisitos e não pode ser tirada.
              </div>
            )}
          </div>
          </>)}
          {/* Quantitativo do contrato (#0845): ativos × cotado, com RT Sim ou
              Não. É uma validação À PARTE da situação de quem sai — a
              substituição pode estar liberada e o contrato acima do cotado.
              Acima: Sim/Não; "Não" não prossegue, "Sim" pede a justificativa
              e quem autorizou. */}
          {checarVaga && checagem.estado === "buscando" && admissao && (
            <div className="nvg-fg" style={{ fontSize: 13, color: "#64748b" }}>Consultando o quantitativo do contrato…</div>
          )}
          {checarVaga && checagem.estado === "pronto" && checagem.quantitativo?.contrato_id && (
            checagem.quantitativo.cotado == null ? (
              <div className="nvg-fg" style={{ fontSize: 13, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 12px" }}>
                O contrato consta com {checagem.quantitativo.ativos ?? 0} colaboradores ativos. Não há quantitativo cotado na Planilha de Custo deste contrato para comparar.
              </div>
            ) : !quantAcima ? (
              <div className="nvg-fg" style={{ fontSize: 13.5, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7f5", borderRadius: 10, padding: "9px 12px" }}>
                {textoQuantitativo(checagem.quantitativo)}
              </div>
            ) : (<>
              <div className="nvg-fg" style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 14, color: "#b45309", fontWeight: 600, lineHeight: 1.45 }}>
                  {textoQuantitativo(checagem.quantitativo)} Deseja prosseguir com a contratação?
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  {(["nao", "sim"] as const).map(op => {
                    const marcado = decisaoQuant === op;
                    return (
                      <button key={op} type="button" aria-pressed={marcado} onClick={() => setDecisaoQuant(op)}
                        style={{ minWidth: 120, padding: "9px 18px", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                          border: marcado ? "1.5px solid #0f3171" : "1.5px solid #94a3b8",
                          background: marcado ? "#0f3171" : "#fff", color: marcado ? "#fff" : "#0f172a",
                          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        {op === "sim" ? "Sim" : "Não"}{marcado && <CheckCircle2 size={15} aria-hidden />}
                      </button>
                    );
                  })}
                </div>
                {decisaoQuant === "nao" && (
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
                    A contratação não prossegue com o contrato acima do quantitativo cotado.
                  </div>
                )}
              </div>
              {decisaoQuant === "sim" && (
                <div className="nvg-fg">
                  <label>Justificativa e quem autorizou *</label>
                  <textarea className="nvg-fi" rows={3} style={{ resize: "vertical" }}
                    placeholder="Informe o motivo e o nome de quem autorizou a contratação."
                    value={vaga.quantitativo_justificativa}
                    onChange={e => setVaga(v => ({ ...v, quantitativo_justificativa: e.target.value }))} />
                </div>
              )}
            </>)
          )}
          {/* #0848: toda Admissão nova passa pelo Gerente de Operações —
              dentro ou acima do quantitativo. Quem abre a vaga fica sabendo
              antes de enviar. */}
          {admissao && !editando && (
            <div className="nvg-fg" style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7f5", borderRadius: 10, padding: "10px 12px", lineHeight: 1.45 }}>
              <Info size={18} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Ao finalizar esta solicitação, a vaga seguirá para <b>aprovação do gerente de operações{gerentesOperacoes.length ? <>: {gerentesOperacoes.join(", ")}</> : ""}</b>.
                {" "}Toda nova admissão exige autorização, mesmo quando o contrato estiver dentro do <b>quantitativo</b>.
              </span>
            </div>
          )}
          {/* Vínculo com o catálogo (15/09/2026): posto e função obrigatórios
              quando o contrato tem posto no catálogo — é do posto que vêm o
              V.A e o V.T. O contrato nunca é escolhido aqui — é o da vaga,
              travado. Só o modo manual usa a função pra sugerir o cargo. */}
          <VinculoCatalogoVaga
            contratoNome={vaga.contrato}
            valor={{ contrato_id: vaga.contrato_id, posto_id: vaga.posto_id, funcao_id: vaga.funcao_id }}
            onChange={v => setVaga(x => ({ ...x, ...v }))}
            onListas={setCatListas}
            onFuncaoNome={vagaManual ? (nome => setVaga(x => ({ ...x, cargo: x.cargo || nome }))) : undefined}
            classeInput="nvg-fi" classeGrupo="nvg-fg" />
          {/* #0849 (11/11/2026): Contrato → Cargo → Posto → ENDEREÇO EFETIVO →
              o resto. A Licitação ainda não informa o endereço do posto; quem
              abre a vaga digita, e o Recrutamento e a Admissão leem daqui. */}
          <div className="nvg-fg">
            <label>Endereço efetivo do local de trabalho <span style={{ color: "#dc2626" }}>*</span></label>
            <input className="nvg-fi" value={vaga.endereco_trabalho} maxLength={300}
              placeholder={ENDERECO_TRABALHO_AJUDA}
              onChange={e => setVaga(v => ({ ...v, endereco_trabalho: e.target.value }))} />
          </div>
          {/* Benefícios e adicionais da vaga (27/10/2026, Convenções Coletivas):
              contrato + posto → CCT/decreto vinculado na Planilha de Custo. */}
          {vaga.contrato_id && postoNomeEscolhido && (
            <div style={{ marginBottom: 14 }}>
              <QuadroBeneficiosDoPosto contratoId={vaga.contrato_id} posto={postoNomeEscolhido} />
            </div>
          )}
          <div className="nvg-2col">
            <div className="nvg-fg">
              <label>Estado (UF) <span style={{ color: "#dc2626" }}>*</span></label>
              <select className="nvg-fi" value={vaga.estado} onChange={e => setVaga(v => ({ ...v, estado: e.target.value, cidade: "" }))}>
                <option value="">— Selecione —</option>
                {ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>)}
              </select>
            </div>
            <div className="nvg-fg">
              <label>Cidade <span style={{ color: "#dc2626" }}>*</span></label>
              <select className="nvg-fi" value={vaga.cidade} disabled={!vaga.estado} onChange={e => setVaga(v => ({ ...v, cidade: e.target.value }))}>
                <option value="">{vaga.estado ? "— Selecione —" : "Selecione o estado primeiro"}</option>
                {municipiosDe(vaga.estado).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* SIS-2026-0598: encarregado + login na ERP. */}
          <PerguntaLoginErp classeGrupo="nvg-fg" classeCampo="nvg-fi"
            valor={{ vaga_encarregado: vaga.vaga_encarregado, precisa_login_erp: vaga.precisa_login_erp }}
            onChange={(r) => setVaga(v => ({ ...v, ...r }))} />

          {/* Vaga administrativa + setor (18/09/2026): igual à demissão — SÓ o
              contrato ADM E ESTAGIÁRIOS é escritório, marca sozinho pelo contrato
              (ninguém marca à mão), e SÓ vaga do escritório escolhe setor. O
              setor vem do cadastro (substituído) ou do seu próprio setor, e
              pode ser trocado. */}
          <div className="nvg-fg" style={{ gridColumn: "1 / -1", border: ehAdministrativa ? "2px solid #0f3171" : "2px solid #e2e8f0", background: ehAdministrativa ? "#eef4ff" : "#f8fafc", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input type="checkbox" checked={ehAdministrativa} disabled style={{ marginTop: 3, width: 16, height: 16, accentColor: "#0f3171" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  Vaga é administrativa?
                  <span style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".4px", padding: "2px 9px", borderRadius: 999, background: ehAdministrativa ? "#0f3171" : "#e2e8f0", color: ehAdministrativa ? "#fff" : "#64748b" }}>
                    {!vaga.contrato ? "escolha o contrato" : ehAdministrativa ? "sim — escritório" : "não — posto/contrato"}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.5, marginTop: 6, display: "grid", gap: 3 }}>
                  <div><b>Só é administrativa a vaga do contrato ADM E ESTAGIÁRIOS (escritório).</b> O sistema marca sozinho pelo contrato — não dá pra marcar à mão.</div>
                  <div>Vaga de <b>posto</b> (limpeza, portaria, vigia, recepção…) <b>não</b> é administrativa: segue pelo Operacional / Analista, sem setor.</div>
                  <div>Vaga do <b>escritório</b>: vai pra <b>Diretoria</b>, e você informa o <b>setor</b> abaixo — só quem aprova esse setor enxerga.</div>
                </div>
                {vaga.contrato && !ehAdministrativa && (
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 10px" }}>
                    Contrato <b>{vaga.contrato}</b> não é o do escritório → vaga de posto, aprovação do Operacional / Analista, sem setor.
                  </div>
                )}
              </div>
            </div>
            {ehAdministrativa && (
              <div style={{ marginTop: 12, borderTop: "1px solid #c7d7f5", paddingTop: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#1e293b", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Setor da vaga do escritório <span style={{ color: "#dc2626" }}>*</span></label>
                <div style={{ fontSize: 13, color: "#475569", marginBottom: 6 }}>
                  <b>Só selecione setor se a vaga é do escritório.</b> É o setor que diz qual diretor aprova.
                  {setorSugerido && vaga.setor === setorSugerido && <> <span style={{ color: "#0f3171", fontWeight: 700 }}>Puxado do cadastro: {setorSugerido}</span> — pode trocar se estiver errado.</>}
                </div>
                <select className="nvg-fi" value={vaga.setor} onChange={e => setVaga(v => ({ ...v, setor: e.target.value }))} style={{ borderColor: vaga.setor ? undefined : "#dc2626", maxWidth: 420 }}>
                  <option value="">— Selecione o setor —</option>
                  {setoresCatalogo.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {!vaga.setor && <div style={{ fontSize: 11.5, color: "#b91c1c", fontWeight: 700, marginTop: 4 }}>Obrigatório: sem o setor a Diretoria não encontra a vaga.</div>}
              </div>
            )}
          </div>
        </>)}

        {/* Step 2 */}
        {vagaStep === 2 && (<>
          <div className="nvg-2col">
            {/* Substituicao repoe UMA pessoa: a vaga aponta para um
                colaborador especifico (substituido_id), e o banco usa esse id
                para travar a pessoa numa vaga so. Pedir 3 vagas para repor um
                unico colaborador nao tem leitura possivel — entao o campo fica
                travado em 1 em vez de aceitar o numero e depois recusar. */}
            <div className="nvg-fg">
              <label>Quantidade de Vagas</label>
              <input className="nvg-fi" type="number" min={1}
                max={maximoDeVagas(vaga.motivo_vaga)}
                value={ehSubstituicao(vaga.motivo_vaga) ? "1" : vaga.quantidade_vagas}
                disabled={ehSubstituicao(vaga.motivo_vaga)}
                onChange={e => setVaga(v => ({ ...v, quantidade_vagas: e.target.value }))} />
              {ehSubstituicao(vaga.motivo_vaga) && (
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                  Substituição repõe uma pessoa por vez.
                </div>
              )}
            </div>
            <div className="nvg-fg">
              <label>Data de Início Prevista *</label>
              <input className="nvg-fi" type="date" min={dataMinimaVaga()} value={vaga.data_inicio_prevista}
                onChange={e => setVaga(v => ({ ...v, data_inicio_prevista: e.target.value }))} />
            </div>
          </div>
          <PrazoAviso prazo={prazo} />
          {/* Horário saiu: a escala do cadastro já vem com a jornada dentro
              ("07:30-17:18 (1H)(08:48)"), então eram dois campos dizendo a
              mesma coisa — e o segundo, digitado à mão, era o que divergia. */}
          {/* A escala vinha travada do cadastro do colaborador (11/09/2026).
              Voltou a ser editável (16/09/2026): em vários cadastros ela não
              vinha (ou vinha de outro posto) e a vaga abria sem horário — o
              Recrutamento não sabia qual turno contratar. O cadastro continua
              sendo o ponto de partida; o encarregado corrige se estiver errado. */}
          <div className="nvg-fg">
            <label>Escala / horário *{!vagaManual && <span style={{ color: "#64748b", fontWeight: 600 }}> — vem do cadastro do colaborador; corrija se não bater</span>}</label>
            <input className="nvg-fi"
              placeholder={vagaManual ? "Ex: 12x36, 5x2..." : "Ex: 07:30-17:18 (1H) · 12x36 diurno"}
              value={vaga.escala}
              onChange={e => setVaga(v => ({ ...v, escala: e.target.value }))} />
            {/* 19/10/2026 (vaga #1364): escala trocada à mão sem ninguém
                perceber. Continua editável; só mostra o que o cadastro diz. */}
            {!vagaManual && escalaDiferenteDoCadastro(vaga.escala, empEscolhido?.["Escala"]) && (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                <AlertTriangle size={13} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />
                Diferente do cadastro do colaborador ({String(empEscolhido?.["Escala"])}). Só mude se a vaga for mesmo para outro turno.
              </div>
            )}
          </div>
          <div className="nvg-2col">
            <div className="nvg-fg"><label>Salário</label><input className="nvg-fi" placeholder="Ex: R$ 1.412,00" value={vaga.salario} onChange={e => setVaga(v => ({ ...v, salario: e.target.value }))} /></div>
            {camposEditaveis ? (
              <div className="nvg-fg">
                <label>Insalubridade</label>
                <select className="nvg-fi" value={vaga.insalubridade_recebe} onChange={e => setVaga(v => ({ ...v, insalubridade_recebe: e.target.value }))}>
                  <option>Não</option><option>Sim</option>
                </select>
              </div>
            ) : (
              /* Com colaborador: vem da Planilha de Custo, só leitura. */
              <div className="nvg-fg">
                <label>Insalubridade <span style={{ color: "#64748b", fontWeight: 600 }}>— da Planilha de Custo ou do cadastro</span></label>
                <input className="nvg-fi" readOnly
                  value={custoBuscando ? "Consultando a planilha…" : vaga.insalubridade_recebe === "Sim" ? `Sim — ${vaga.insalubridade_quanto}` : substituidoId ? "Não" : ""}
                  placeholder="Escolha o colaborador acima"
                  style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
              </div>
            )}
          </div>
          {camposEditaveis && vaga.insalubridade_recebe === "Sim" && (
            <div className="nvg-fg"><label>Percentual de Insalubridade</label><input className="nvg-fi" placeholder="Ex: 20%, 40%" value={vaga.insalubridade_quanto} onChange={e => setVaga(v => ({ ...v, insalubridade_quanto: e.target.value }))} /></div>
          )}
          {/* Benefícios: o V.A e o V.T da Planilha de Custo continuam sendo
              puxados quando o posto do catálogo é escolhido, mas o campo
              deixou de ser só leitura (16/09/2026) — a planilha nem sempre
              batia com o posto real e a vaga abria com benefício errado. */}
          {herancaVaga ? (
            <div className="nvg-fg">
              <label>Benefícios <span style={{ color: "#64748b", fontWeight: 600 }}>— da Convenção Coletiva do posto</span></label>
              <textarea className="nvg-fi" rows={3} readOnly value={vaga.beneficios || "A convenção não tem benefício preenchido."}
                style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
              <div style={{ marginTop: 6, fontSize: 13, color: "#1e3a8a", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 9px" }}>
                Os benefícios deste posto vêm da Convenção Coletiva e não são editados na vaga. Para mudar algum valor, atualize o cadastro da convenção
                {convencaoDaVagaId && <> — <Link to={urlEditarConvencao(convencaoDaVagaId)} target="_blank" style={{ fontWeight: 700, textDecoration: "underline" }}>editar convenção</Link></>}.
              </div>
            </div>
          ) : (
          <div className="nvg-fg">
            <label>Benefícios{!vagaManual && <span style={{ color: "#64748b", fontWeight: 600 }}> — VT e VA da Planilha de Custo; corrija se não bater</span>}</label>
            <textarea className="nvg-fi" rows={2}
              placeholder={vagaManual ? "VT, VR, Plano de Saúde..." : custoBuscando ? "Consultando a planilha…" : !vaga.posto_id ? "Selecione o posto no catálogo (etapa 1) para puxar o V.A e o V.T, ou descreva aqui" : "VT, VA, Plano de Saúde..."}
              value={vaga.beneficios} onChange={e => setVaga(v => ({ ...v, beneficios: e.target.value }))} />
            {!vagaManual && custoNota && <div style={{ marginTop: 4, fontSize: 14, fontWeight: custoPosto ? 400 : 600, color: custoPosto && !custoPosto.ambiguo ? "#64748b" : "#92400e" }}>{custoNota}</div>}
          </div>
          )}
          {/* Local exato voltou (16/09/2026), obrigatório e sempre manual: o
              posto do catálogo identifica o contrato, não a unidade/endereço
              onde a pessoa vai trabalhar. Sem isso o Recrutamento não sabia
              pra onde contratar. */}
          <div className="nvg-fg">
            <label>Local exato da vaga *</label>
            <textarea className="nvg-fi" rows={2}
              placeholder="Unidade, endereço, bloco/andar, ponto de referência — onde a pessoa vai trabalhar"
              value={vaga.local_exato} onChange={e => setVaga(v => ({ ...v, local_exato: e.target.value }))} />
          </div>
        </>)}

        {/* Step 3 */}
        {vagaStep === 3 && (<>
          <div className="nvg-2col">
            {/* Grau não é mais escolhido: sai do prazo da data de início. */}
            <div className="nvg-fg">
              <label>Grau de Urgência — calculado pelo prazo</label>
              <input className="nvg-fi" readOnly value={prazo.grau ?? "— informe a data de início —"}
                style={{ background: "#f1f5f9", color: prazo.grau ? "#0f172a" : "#64748b", fontWeight: 700, cursor: "not-allowed" }} />
            </div>
            <div className="nvg-fg">
              <label>Alta Rotatividade?</label>
              <select className="nvg-fi" value={vaga.alta_rotatividade} onChange={e => setVaga(v => ({ ...v, alta_rotatividade: e.target.value }))}>
                <option>Não</option><option>Sim</option>
              </select>
            </div>
          </div>
          <PrazoAviso prazo={prazo} />
          {/* Requisitos obrigatórios e experiência mínima SAÍRAM (14/09/2026):
              vão vir da licitação/planilha. A CNH segue automática pelo cargo. */}
          {cnhDoCargo && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
              <span style={{ display: "inline-flex" }}><Car size={14} aria-hidden /></span><span>{REQ_CNH_TEXTO} <span style={{ fontWeight: 600, color: "#92400e" }}>(automático para {cnhDoCargo.toLowerCase()})</span></span>
            </div>
          )}
          <div className="nvg-fg"><label>Requisitos Desejáveis</label><textarea className="nvg-fi" rows={2} placeholder="Inglês básico, curso técnico... (opcional)" value={vaga.req_desejaveis} onChange={e => setVaga(v => ({ ...v, req_desejaveis: e.target.value }))} /></div>
                    {/* Indicação: quem abre a vaga muitas vezes JÁ tem alguém em mente, e
              hoje isso chegava no Recrutamento por WhatsApp, solto. Dizendo
              "Sim", os três dados vêm juntos — a regra está em
              erroDaRecomendacao(), a mesma que a outra tela de vaga usa. */}
          <div className="nvg-fg">
            <label>Você já tem recomendação para essa vaga?</label>
            <select className="nvg-fi" value={vaga.tem_recomendacao}
              onChange={e => setVaga(v => ({ ...v, tem_recomendacao: e.target.value }))}>
              <option>Não</option><option>Sim</option>
            </select>
          </div>
          {vaga.tem_recomendacao === "Sim" && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Dados de quem você está indicando</div>
              <div className="nvg-fg"><label>Nome completo *</label>
                <input className="nvg-fi" placeholder="Nome completo da pessoa indicada"
                  value={vaga.recomendacao_nome} onChange={e => setVaga(v => ({ ...v, recomendacao_nome: e.target.value }))} /></div>
              <div className="nvg-2col">
                <div className="nvg-fg"><label>CPF *</label>
                  <input className="nvg-fi" inputMode="numeric" placeholder="000.000.000-00"
                    value={vaga.recomendacao_cpf} onChange={e => setVaga(v => ({ ...v, recomendacao_cpf: maskCpf(e.target.value) }))} />
                  {soDigitos(vaga.recomendacao_cpf).length === 11 && !cpfValido(vaga.recomendacao_cpf) && (
                    <div style={{ marginTop: 4, fontSize: 14, color: "#dc2626", fontWeight: 700 }}>CPF não confere.</div>
                  )}</div>
                <div className="nvg-fg"><label>WhatsApp *</label>
                  <input className="nvg-fi" inputMode="numeric" placeholder="(51) 99999-9999"
                    value={vaga.recomendacao_whatsapp} onChange={e => setVaga(v => ({ ...v, recomendacao_whatsapp: maskFone(e.target.value) }))} /></div>
              </div>
            </div>
          )}
          <div className="nvg-fg"><label>Observação Importante</label><textarea className="nvg-fi" rows={2} placeholder="Opcional..." value={vaga.observacao_importante} onChange={e => setVaga(v => ({ ...v, observacao_importante: e.target.value }))} /></div>
        </>)}

        </div>

        {/* Navegação */}
        <div className="nvg-rodape">
          <div style={{ display: "flex", gap: 8 }}>
            {vagaStep > 1 && <button onClick={() => setVagaStep(s => s - 1)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>← Anterior</button>}
            {vagaStep === 1 && situacaoBarra && (
              <span style={{ marginRight: "auto", alignSelf: "center", fontSize: 13, color: "#64748b" }}>Avanço bloqueado pela situação do colaborador.</span>
            )}
            {vagaStep < 3 && (() => {
              const travado = vagaStep === 1 && situacaoBarra;
              return <button disabled={travado} onClick={() => { if (vagaValidar(vagaStep)) setVagaStep(s => s + 1); }} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: travado ? "#cbd5e1" : "#0f3171", color: travado ? "#64748b" : "#fff", fontSize: 13.5, fontWeight: 700, cursor: travado ? "not-allowed" : "pointer" }}>Próximo →</button>;
            })()}
            {vagaStep === 3 && <button onClick={submitVaga} disabled={salvando} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: salvando ? "#64748b" : "#16a34a", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: salvando ? "default" : "pointer" }}>{salvando ? (editando ? "Salvando…" : "Enviando…") : editando ? "✓ Salvar alterações" : "✓ Solicitar Vaga"}</button>}
          </div>
        </div>
      </div>

      {/* Toasts próprios — só existem quando quem chamou não passou `onToast`. */}
      {!onToast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              display: "inline-block", padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.1)",
              background: t.type === "ok" ? "#ecfdf3" : t.type === "err" ? "#fef2f2" : "#eff6ff",
              color: t.type === "ok" ? "#15803d" : t.type === "err" ? "#b91c1c" : "#1d4ed8",
              border: `1px solid ${t.type === "ok" ? "#86efac" : t.type === "err" ? "#fecaca" : "#bfdbfe"}`,
            }}>{t.msg}</div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

export default ModalNovaVaga;
