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
//   • os três pontinhos com "✍️ Preencher manualmente" — vaga do escritório,
//     em que cargo/contrato/escala/salário são digitados em vez de copiados
//     do cadastro de um colaborador;
//   • o vínculo com o catálogo de Suprimentos (contrato → posto → função),
//     que é o que define uniformes e EPIs da admissão.
//
// Quem libera o preenchimento à mão é `recrutamento_vaga_administrativa`, a
// capacidade que JÁ existe em Administração › Acesso por Usuário e que também
// governa o checkbox "Vaga é administrativa?". Nenhuma chave de acesso nova
// foi criada para isto.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useContratosCatalogo, usePostos, useFuncoes } from "@/hooks/useSupCatalogo";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import {
  MOTIVOS_VAGA, ehSubstituicao, avaliarPrazo, dataMinimaVaga,
  cargoExigeCnh, aplicarReqCnh, REQ_CNH_TEXTO,
  rotuloReferencia, ajudaReferencia, mostraNomeReferencia, contratoDoEmpregado,
  faltamCamposManuais, podeVagaAdministrativa,
  substituidosComVagaViva, avisoSubstituidoPreso,
} from "@/lib/recrutamento/vagaRegras";

const VAGA_RESET = {
  motivo_vaga: "", administrativa: false, nome_substituido: "", contrato: "", cargo: "",
  contrato_id: "", posto_id: "", funcao_id: "",
  estado: "", cidade: "", quantidade_vagas: "1", data_inicio_prevista: "",
  escala: "", horario: "", salario: "", insalubridade_recebe: "Não",
  insalubridade_quanto: "", beneficios: "", local_exato: "",
  grau_urgencia: "", alta_rotatividade: "Não", req_obrigatorios: "",
  req_desejaveis: "", exp_minima: "Não", exp_minima_qual: "",
  motivos_saida: "", recomendacao: "", observacao_importante: "",
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
        ? <>⚠️ {prazo.erro}</>
        : <>✅ <b>{prazo.dias} dias úteis</b> de antecedência → urgência <b>{prazo.grau}</b>. <span style={{ fontWeight: 500 }}>O grau sai do prazo: até 13 dias úteis é urgente, de 14 a 20 é média, 21 ou mais é baixa.</span></>}
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
}

export function ModalNovaVaga({ aberto, onFechar, onCriada, onToast }: Props) {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const { empresa } = useEmpresaAtiva();
  // Vaga do escritório: só quem enxerga esse tipo pode marcar uma como tal —
  // e é a mesma capacidade que libera preencher à mão.
  const podeAdministrativa = podeVagaAdministrativa(can);

  const [vaga, setVaga] = useState({ ...VAGA_RESET });
  const [vagaStep, setVagaStep] = useState(1);
  // Vaga do escritório preenchida à mão, sem colaborador de referência.
  const [vagaManual, setVagaManual] = useState(false);
  const [menuVagaAberto, setMenuVagaAberto] = useState(false);
  const [contratosFull, setContratosFull] = useState<any[]>([]);
  // Empregado -> nº da vaga de substituição que já o segura (regra do banco).
  const [presos, setPresos] = useState<Map<number, number>>(new Map());
  const [empregados, setEmpregados] = useState<any[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [loadingEmps, setLoadingEmps] = useState(false);
  // Cargo/contrato vêm do cadastro do escolhido (o id prova que a pessoa foi
  // escolhida na lista, não só digitada).
  const [substituidoId, setSubstituidoId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  const empDebounce = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce busca colaborador
  const empTermo = useRef("");  // último termo buscado (descarta respostas obsoletas)

  const { data: contratosCatalogo = [] } = useContratosCatalogo(empresa?.id ?? null);
  const { data: postosCatalogo = [] } = usePostos(vaga.contrato_id || null);
  const { data: funcoesCatalogo = [] } = useFuncoes(vaga.posto_id || null);

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
      .nvg-modal{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:24px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.1)}
      .nvg-fi{width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;font-size:13px;padding:8px 12px;outline:none;font-family:inherit;transition:.15s}
      .nvg-fi:focus{border-color:#0f3171;box-shadow:0 0 0 4px rgba(15,49,113,.08)}
      .nvg-fg{margin-bottom:14px}
      .nvg-fg label{display:block;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
    `;
    document.head.appendChild(style);
  }, []);

  // Abrir é sempre do zero: solicitação nova não herda o que sobrou da anterior.
  useEffect(() => {
    if (!aberto) return;
    setVaga({ ...VAGA_RESET });
    setVagaStep(1);
    setEmpSearch("");
    setShowEmpDrop(false);
    setEmpregados([]);
    setSubstituidoId(null);
    setVagaManual(false);
    setMenuVagaAberto(false);
    if (!contratosFull.length) {
      (async () => {
        const { data } = await (supabase as any)
          .from("CONTRATOS")
          .select('"NOME CONTRATO", Filial')
          .eq("ATIVO", "SIM")
          .order('"NOME CONTRATO"');
        if (data) setContratosFull(data);
      })();
    }
    // contratosFull fica fora das deps de propósito: a lista é carregada uma
    // vez por sessão e recarregá-la a cada abertura não muda nada na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const buscarEmpregados = async (term: string) => {
    empTermo.current = term;
    setLoadingEmps(true);
    const { data, error } = await (supabase as any)
      .from("EMPREGADOS")
      .select('"ID", "Nome", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Escala"')
      .eq("Situação", "Trabalhando")
      .ilike("Nome", `%${term}%`)
      .order('"Nome"')
      .limit(50);
    if (empTermo.current !== term) return; // resposta de uma busca antiga — descarta
    setLoadingEmps(false);
    if (error) { toast("EMPREGADOS: " + error.message + " (" + (error.code ?? "?") + ")", "err"); return; }
    const lista = data ?? [];
    setEmpregados(lista);
    // Só a substituição trava: nos outros motivos a pessoa é molde e pode
    // servir de molde quantas vezes for.
    setPresos(ehSubstituicao(vaga.motivo_vaga)
      ? await substituidosComVagaViva(supabase, lista.map((e: any) => Number(e.ID)))
      : new Map());
  };

  const selecionarEmpregado = (emp: any) => {
    const jaTem = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
    if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return; }
    const contratoMatch = contratoDoEmpregado(contratosFull, emp);
    const insal = parseFloat(String(emp["% Insalubridade"] ?? "0").replace(",", ".")) || 0;
    setSubstituidoId(emp.ID ?? null);
    setVaga(v => ({
      ...v,
      // Nos outros motivos o escolhido é só o molde: o nome não entra na vaga.
      nome_substituido: mostraNomeReferencia(v.motivo_vaga) ? emp.Nome : "",
      cargo: emp["Título do Cargo"] ?? "",
      salario: emp["Valor Salário"] ? `R$ ${String(emp["Valor Salário"]).replace(".", ",")}` : "",
      insalubridade_recebe: insal > 0 ? "Sim" : "Não",
      insalubridade_quanto: insal > 0 ? `${emp["% Insalubridade"]}%` : "",
      escala: emp["Escala"] ? String(emp["Escala"]) : v.escala,
      contrato: contratoMatch ? contratoMatch["NOME CONTRATO"] : v.contrato,
      contrato_id: "", posto_id: "", funcao_id: "",
    }));
    setEmpSearch(mostraNomeReferencia(vaga.motivo_vaga) ? emp.Nome : "");
    setShowEmpDrop(false);
  };

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
    setMenuVagaAberto(false);
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

  const vagaValidar = (step: number) => {
    if (step === 1) {
      if (!vaga.motivo_vaga) { toast("Selecione o motivo da vaga.", "err"); return false; }

      // No modo manual ninguém preenche por você: o que o cadastro daria vira
      // digitação, e o que era "escolha alguém" vira "informe o campo".
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
      } else if (!substituidoId) {
        toast(ehSubstituicao(vaga.motivo_vaga)
          ? "Escolha na lista o colaborador que será substituído — o cargo e o contrato vêm do cadastro dele."
          : "Escolha na lista alguém com o mesmo cargo da vaga — é de lá que vêm cargo, contrato, escala e salário.", "err");
        return false;
      }

      const jaTem = ehSubstituicao(vaga.motivo_vaga) && substituidoId ? presos.get(substituidoId) : undefined;
      if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return false; }
      if (!vaga.contrato)    { toast("Selecione o contrato.", "err"); return false; }
      if (!vaga.cargo.trim()){ toast("Informe o cargo.", "err"); return false; }
      if (!vaga.contrato_id) { toast("Selecione o contrato do catálogo de Suprimentos.", "err"); return false; }
      if (!vaga.posto_id)    { toast("Selecione o posto do catálogo de Suprimentos.", "err"); return false; }
      if (!vaga.funcao_id)   { toast("Selecione a função do catálogo de Suprimentos.", "err"); return false; }
    }
    if (step === 2) {
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
    }
    if (step === 3) {
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
      if (!vaga.req_obrigatorios.trim() && !cnhDoCargo) { toast("Informe os requisitos obrigatórios.", "err"); return false; }
    }
    return true;
  };

  const submitVaga = async () => {
    if (salvando) return;
    if (!vagaValidar(1) || !vagaValidar(3)) return;
    setSalvando(true);
    const payload = {
      ...vaga,
      quantidade_vagas: parseInt(vaga.quantidade_vagas) || 1,
      // Grau e CNH saem das regras (o trigger recalcula os dois no banco).
      grau_urgencia: prazo.grau ?? "",
      req_obrigatorios: aplicarReqCnh(vaga.req_obrigatorios, vaga.cargo),
      cnh_obrigatoria: !!cnhDoCargo,
      administrativa: podeAdministrativa ? !!vaga.administrativa : false,
      // Só a substituição grava o id: é ele que trava a pessoa numa vaga só.
      substituido_id: ehSubstituicao(vaga.motivo_vaga) ? substituidoId : null,
      status: "Pendente Analista",
      solicitante_nome: user?.user_metadata?.nome ?? user?.email ?? "",
      solicitante_cpf: user?.email ?? "",
    };
    let { error, data } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").insert(payload).select("id").single();
    // Banco ainda sem as colunas novas: reenvia sem elas.
    if (error && /column|schema cache/i.test(error.message)) {
      const { cnh_obrigatoria, substituido_id, contrato_id, posto_id, funcao_id, ...semColunasNovas } = payload as any;
      ({ error, data } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").insert(semColunasNovas).select("id").single());
    }
    setSalvando(false);
    if (error) { toast("Erro ao solicitar vaga: " + error.message, "err"); return; }
    toast(`Solicitação #${data?.id} criada com sucesso!`, "ok");
    onFechar();
    onCriada?.(data?.id);
  };

  if (!aberto) return null;

  return (
    <div className="nvg-modal-ov">
      <div className="nvg-modal" onClick={e => e.stopPropagation()}>
        <button onClick={onFechar} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>

        {/* Os três pontinhos ficam DENTRO da solicitação, ao lado do ✕.
            É o lugar certo: o que eles oferecem muda esta solicitação que
            está aberta, não a decisão de abrir uma. */}
        {podeAdministrativa && (
          <>
            <button
              type="button"
              aria-label="Mais opções desta solicitação"
              aria-haspopup="menu"
              aria-expanded={menuVagaAberto}
              onClick={e => { e.stopPropagation(); setMenuVagaAberto(v => !v); }}
              style={{ position: "absolute", top: 13, right: 44, width: 26, height: 26, borderRadius: 8, background: menuVagaAberto ? "#e2e8f0" : "none", border: "none", color: "#64748b", fontSize: 17, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              ⋯
            </button>
            {menuVagaAberto && (
              <>
                {/* Overlay transparente fecha ao clicar fora, sem listener
                    global que alguém esquece de remover na desmontagem. */}
                <div onClick={() => setMenuVagaAberto(false)}
                     style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div role="menu" style={{ position: "absolute", top: 42, right: 40, zIndex: 61, minWidth: 268, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 32px rgba(15,23,42,.16)", padding: 5, textAlign: "left" }}>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={alternarVagaManual}
                    style={{ display: "block", width: "100%", padding: "9px 11px", border: "none", borderRadius: 9, background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#0f172a", textAlign: "left" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#eef4ff"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {vagaManual ? "↩️ Voltar a puxar do cadastro" : "✍️ Preencher manualmente"}
                    <small style={{ display: "block", marginTop: 3, fontWeight: 500, fontSize: 11, color: "#64748b", lineHeight: 1.35, whiteSpace: "normal" }}>
                      {vagaManual
                        ? "Volta a escolher um colaborador; cargo, contrato, escala e salário vêm do cadastro dele."
                        : "Vaga do escritório: você digita cargo, contrato, escala e salário em vez de copiar de um colaborador."}
                    </small>
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Solicitar Nova Vaga</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
          {vagaStep === 1 ? "Etapa 1 de 3 — Identificação da Vaga" : vagaStep === 2 ? "Etapa 2 de 3 — Detalhes do Posto" : "Etapa 3 de 3 — Requisitos e Urgência"}
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < vagaStep ? "#16a34a" : i === vagaStep ? "#0f3171" : "#dbe4f0", transition: "background .2s" }}></div>
          ))}
        </div>

        {/* Step 1 */}
        {vagaStep === 1 && (<>
          <div className="nvg-fg">
            <label>Motivo da Vaga *</label>
            <select className="nvg-fi" value={vaga.motivo_vaga}
              onChange={e => {
                const m = e.target.value;
                // Trocou de motivo: limpa tudo o que veio do cadastro do
                // escolhido anterior (senão sobra cargo/contrato/salário de
                // outro posto) e obriga a escolher de novo.
                setSubstituidoId(null); setEmpSearch("");
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
          {/* Aviso do modo manual: a pessoa precisa saber que trocou de
              regime, senão estranha os campos que antes vinham prontos. */}
          {vagaManual && (
            <div className="nvg-fg" style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7fe", borderRadius: 9, padding: "8px 11px" }}>
                ✍️ <b>Preenchendo à mão</b> — vaga do escritório. Cargo, contrato, escala e salário
                são digitados por você, e não copiados de um colaborador.
              </div>
            </div>
          )}
          {/* Em Substituição o colaborador continua obrigatório mesmo à
              mão: é o vínculo que impede duas vagas repondo a mesma pessoa. */}
          {!!vaga.motivo_vaga && (!vagaManual || ehSubstituicao(vaga.motivo_vaga)) && (
            <div className="nvg-fg" style={{ position: "relative" }}
              onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
              <label>{rotuloReferencia(vaga.motivo_vaga)} *</label>
              <input
                className="nvg-fi"
                placeholder="Buscar e escolher na lista..."
                value={empSearch}
                autoComplete="off"
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
                    <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Buscando...</div>
                  ) : empregados.length === 0 ? (
                    <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                  ) : empregados.slice(0, 40).map((emp, i) => {
                    // Já tem vaga de substituição em pé: fica na lista
                    // para a pessoa entender por que não pode escolher.
                    const preso = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
                    return (
                      <div key={i} onMouseDown={() => selecionarEmpregado(emp)}
                        style={{ padding: "8px 12px", fontSize: 13, cursor: preso ? "not-allowed" : "pointer", borderBottom: "1px solid #f1f5f9", color: preso ? "#94a3b8" : "#0f172a", background: preso ? "#f8fafc" : "#fff" }}
                        onMouseEnter={e => { if (!preso) e.currentTarget.style.background = "#f0f4ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = preso ? "#f8fafc" : "#fff"; }}>
                        <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                        {preso && <div style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c", marginTop: 2 }}>🚫 já está na vaga de substituição #{preso}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#94a3b8" }}>{ajudaReferencia(vaga.motivo_vaga)}</div>
              {/* Sem nome: nos motivos que não são Substituição o escolhido
                  é só o molde da vaga, e é isso que a tela confirma. */}
              {!!substituidoId && !mostraNomeReferencia(vaga.motivo_vaga) && (
                <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 9px" }}>
                  ✓ Colaborador escolhido — cargo, contrato, escala e salário já vieram do cadastro dele.
                </div>
              )}
            </div>
          )}
          {/* Contrato e cargo vêm do cadastro do escolhido e ficam travados
              — a vaga é do posto dele, não de outro. */}
          <div className="nvg-fg">
            <label>Contrato *{!vagaManual && <span style={{ color: "#94a3b8", fontWeight: 600 }}> — do colaborador escolhido</span>}</label>
            <input className="nvg-fi"
              placeholder={vagaManual ? "Ex.: ADM E ESTAGIARIOS - NH" : "Escolha o colaborador acima"}
              value={vaga.contrato} readOnly={!vagaManual}
              onChange={e => setVaga(v => ({ ...v, contrato: e.target.value }))}
              style={vagaManual ? undefined : { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
            {vagaManual && (
              <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
                Escolher o contrato no catálogo de Suprimentos, abaixo, também preenche este campo.
              </div>
            )}
          </div>
          <div className="nvg-fg">
            <label>Cargo *{!vagaManual && <span style={{ color: "#94a3b8", fontWeight: 600 }}> — do colaborador escolhido</span>}</label>
            <input className="nvg-fi"
              placeholder={vagaManual ? "Ex.: Analista Administrativo" : "Escolha o colaborador acima"}
              value={vaga.cargo} readOnly={!vagaManual}
              onChange={e => setVaga(v => ({ ...v, cargo: e.target.value }))}
              style={vagaManual ? undefined : { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
            {cnhDoCargo && (
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                🚗 {cnhDoCargo}: CNH obrigatória — já entra sozinha nos requisitos e não pode ser tirada.
              </div>
            )}
          </div>
          <div className="nvg-fg" style={{ gridColumn: "1 / -1" }}>
            <label>Vínculo com o catálogo de Suprimentos *</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              <select className="nvg-fi" value={vaga.contrato_id} onChange={e => {
                const id = e.target.value;
                const contrato = contratosCatalogo.find(c => c.id === id);
                setVaga(v => ({
                  ...v, contrato_id: id, posto_id: "", funcao_id: "",
                  contrato: contrato?.nome ?? v.contrato,
                }));
              }}>
                <option value="">Contrato</option>
                {contratosCatalogo.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <select className="nvg-fi" value={vaga.posto_id} disabled={!vaga.contrato_id} onChange={e => {
                const id = e.target.value;
                setVaga(v => ({ ...v, posto_id: id, funcao_id: "" }));
              }}>
                <option value="">{vaga.contrato_id ? "Posto" : "Escolha o contrato"}</option>
                {postosCatalogo.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <select className="nvg-fi" value={vaga.funcao_id} disabled={!vaga.posto_id} onChange={e => {
                const id = e.target.value;
                const funcao = funcoesCatalogo.find(f => f.id === id);
                setVaga(v => ({ ...v, funcao_id: id, cargo: funcao?.nome ?? v.cargo }));
              }}>
                <option value="">{vaga.posto_id ? "Função" : "Escolha o posto"}</option>
                {funcoesCatalogo.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: "#64748b" }}>
              Este vínculo define automaticamente os uniformes e EPIs da admissão.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="nvg-fg">
              <label>Estado (UF)</label>
              <select className="nvg-fi" value={vaga.estado} onChange={e => setVaga(v => ({ ...v, estado: e.target.value, cidade: "" }))}>
                <option value="">— Selecione —</option>
                {ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>)}
              </select>
            </div>
            <div className="nvg-fg">
              <label>Cidade</label>
              <select className="nvg-fi" value={vaga.cidade} disabled={!vaga.estado} onChange={e => setVaga(v => ({ ...v, cidade: e.target.value }))}>
                <option value="">{vaga.estado ? "— Selecione —" : "Selecione o estado primeiro"}</option>
                {municipiosDe(vaga.estado).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {podeAdministrativa && (
            <div className="nvg-fg" style={{ gridColumn: "1 / -1" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", background: vaga.administrativa ? "#f0f6ff" : "#fff", border: vaga.administrativa ? "1.5px solid #0f3171" : "1px solid #e2e8f0", borderRadius: 11, padding: "10px 13px", transition: "background .18s, border-color .18s" }}>
                <input type="checkbox" checked={!!vaga.administrativa} style={{ marginTop: 2, width: 15, height: 15, accentColor: "#0f3171", cursor: "pointer" }}
                  onChange={e => setVaga(v => ({ ...v, administrativa: e.target.checked }))} />
                <span>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>Vaga é administrativa?</span>
                  <span style={{ display: "block", fontSize: 11, color: "#94a3b8", marginTop: 3, lineHeight: 1.45 }}>
                    Vaga do escritório. Só quem tem “Ver vaga administrativa?” enxerga, aprova ou reprova — os demais nem veem que ela existe.
                  </span>
                </span>
              </label>
            </div>
          )}
        </>)}

        {/* Step 2 */}
        {vagaStep === 2 && (<>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="nvg-fg"><label>Quantidade de Vagas</label><input className="nvg-fi" type="number" min={1} max={99} value={vaga.quantidade_vagas} onChange={e => setVaga(v => ({ ...v, quantidade_vagas: e.target.value }))} /></div>
            <div className="nvg-fg">
              <label>Data de Início Prevista *</label>
              <input className="nvg-fi" type="date" min={dataMinimaVaga()} value={vaga.data_inicio_prevista}
                onChange={e => setVaga(v => ({ ...v, data_inicio_prevista: e.target.value }))} />
            </div>
          </div>
          <PrazoAviso prazo={prazo} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="nvg-fg"><label>Escala</label><input className="nvg-fi" placeholder="Ex: 12x36, 5x2..." value={vaga.escala} onChange={e => setVaga(v => ({ ...v, escala: e.target.value }))} /></div>
            <div className="nvg-fg"><label>Horário</label><input className="nvg-fi" placeholder="Ex: 07h às 19h..." value={vaga.horario} onChange={e => setVaga(v => ({ ...v, horario: e.target.value }))} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="nvg-fg"><label>Salário</label><input className="nvg-fi" placeholder="Ex: R$ 1.412,00" value={vaga.salario} onChange={e => setVaga(v => ({ ...v, salario: e.target.value }))} /></div>
            <div className="nvg-fg">
              <label>Insalubridade</label>
              <select className="nvg-fi" value={vaga.insalubridade_recebe} onChange={e => setVaga(v => ({ ...v, insalubridade_recebe: e.target.value }))}>
                <option>Não</option><option>Sim</option>
              </select>
            </div>
          </div>
          {vaga.insalubridade_recebe === "Sim" && (
            <div className="nvg-fg"><label>Percentual de Insalubridade</label><input className="nvg-fi" placeholder="Ex: 20%, 40%" value={vaga.insalubridade_quanto} onChange={e => setVaga(v => ({ ...v, insalubridade_quanto: e.target.value }))} /></div>
          )}
          <div className="nvg-fg"><label>Benefícios</label><textarea className="nvg-fi" rows={2} placeholder="VT, VR, Plano de Saúde..." value={vaga.beneficios} onChange={e => setVaga(v => ({ ...v, beneficios: e.target.value }))} /></div>
          <div className="nvg-fg"><label>Local Exato / Posto</label><input className="nvg-fi" placeholder="Nome do posto ou endereço..." value={vaga.local_exato} onChange={e => setVaga(v => ({ ...v, local_exato: e.target.value }))} /></div>
        </>)}

        {/* Step 3 */}
        {vagaStep === 3 && (<>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Grau não é mais escolhido: sai do prazo da data de início. */}
            <div className="nvg-fg">
              <label>Grau de Urgência — calculado pelo prazo</label>
              <input className="nvg-fi" readOnly value={prazo.grau ?? "— informe a data de início —"}
                style={{ background: "#f1f5f9", color: prazo.grau ? "#0f172a" : "#94a3b8", fontWeight: 700, cursor: "not-allowed" }} />
            </div>
            <div className="nvg-fg">
              <label>Alta Rotatividade?</label>
              <select className="nvg-fi" value={vaga.alta_rotatividade} onChange={e => setVaga(v => ({ ...v, alta_rotatividade: e.target.value }))}>
                <option>Não</option><option>Sim</option>
              </select>
            </div>
          </div>
          <PrazoAviso prazo={prazo} />
          <div className="nvg-fg">
            <label>Requisitos Obrigatórios *</label>
            {cnhDoCargo && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 10px", marginBottom: 6 }}>
                <span>🚗</span><span>{REQ_CNH_TEXTO} <span style={{ fontWeight: 600, color: "#92400e" }}>(automático para {cnhDoCargo.toLowerCase()} — vai junto mesmo que você não escreva)</span></span>
              </div>
            )}
            <textarea className="nvg-fi" rows={3} placeholder="Experiência comprovada, curso específico..." value={vaga.req_obrigatorios} onChange={e => setVaga(v => ({ ...v, req_obrigatorios: e.target.value }))} />
          </div>
          <div className="nvg-fg"><label>Requisitos Desejáveis</label><textarea className="nvg-fi" rows={2} placeholder="Inglês básico, curso técnico... (opcional)" value={vaga.req_desejaveis} onChange={e => setVaga(v => ({ ...v, req_desejaveis: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="nvg-fg">
              <label>Experiência Mínima?</label>
              <select className="nvg-fi" value={vaga.exp_minima} onChange={e => setVaga(v => ({ ...v, exp_minima: e.target.value }))}>
                <option>Não</option><option>Sim</option>
              </select>
            </div>
            {vaga.exp_minima === "Sim" && (
              <div className="nvg-fg"><label>Qual experiência?</label><input className="nvg-fi" placeholder="Ex: 6 meses em limpeza" value={vaga.exp_minima_qual} onChange={e => setVaga(v => ({ ...v, exp_minima_qual: e.target.value }))} /></div>
            )}
          </div>
          <div className="nvg-fg"><label>Observação Importante</label><textarea className="nvg-fi" rows={2} placeholder="Opcional..." value={vaga.observacao_importante} onChange={e => setVaga(v => ({ ...v, observacao_importante: e.target.value }))} /></div>
        </>)}

        {/* Navegação */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
          <div />
          <div style={{ display: "flex", gap: 8 }}>
            {vagaStep > 1 && <button onClick={() => setVagaStep(s => s - 1)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Anterior</button>}
            {vagaStep < 3 && <button onClick={() => { if (vagaValidar(vagaStep)) setVagaStep(s => s + 1); }} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Próximo →</button>}
            {vagaStep === 3 && <button onClick={submitVaga} disabled={salvando} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: salvando ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: salvando ? "default" : "pointer" }}>{salvando ? "Enviando…" : "✓ Solicitar Vaga"}</button>}
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
    </div>
  );
}

export default ModalNovaVaga;
