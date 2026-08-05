import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";

// ── Helpers ────────────────────────────────────────────────────────
function fmtDt(s?: string) {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  return isNaN(+d) ? (s ?? "—") : d.toLocaleDateString("pt-BR");
}
/** Dias inteiros decorridos desde a data informada (0 = hoje). */
function diasDesde(s?: string): number | null {
  if (!s) return null;
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  if (isNaN(+d)) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function mesLabel(s?: string) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return s || "—";
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[+m[2] - 1] ?? m[2]}/${m[1]}`;
}
function badgeStatusCls(st: string) {
  const m: Record<string, string> = {
    "Aguardando Aprovação": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente Operacional": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente Recrutamento": "bg-purple-100 text-purple-700 border-purple-200",
    "Seleção de Candidato": "bg-blue-100 text-blue-700 border-blue-200",
    "Aguardando Recrutamento": "bg-purple-100 text-purple-700 border-purple-200",
    "Aguardando Jurídico": "bg-purple-100 text-purple-700 border-purple-200",
    "Concluída": "bg-green-100 text-green-700 border-green-200",
    Pendente: "bg-yellow-100 text-yellow-800 border-yellow-200",
    Aprovada: "bg-green-100 text-green-700 border-green-200",
    Reprovada: "bg-red-100 text-red-700 border-red-200",
    Cancelada: "bg-slate-100 text-slate-600 border-slate-200",
    Contratado: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Respondida: "bg-green-100 text-green-700 border-green-200",
    Aberta: "bg-orange-100 text-orange-700 border-orange-200",
  };
  return m[st] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

function brToISO(d?: string): string | null {
  const m = String(d ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function addDaysISO(iso: string, days: number): string {
  const dt = new Date(iso + "T12:00:00");
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}
function hojeMaisDias(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

const FERIAS_RESET = {
  colaborador_id: null as number | null, colaborador_nome: "", colaborador_cpf: "",
  colaborador_cargo: "", colaborador_filial: "", colaborador_admissao: "",
  data_saida: "", dias_ferias: "30", dias_vendidos: "0", observacoes: "",
};
const ADV_RESET = {
  colaborador_id: null as number | null, colaborador_nome: "", colaborador_cpf: "",
  colaborador_cargo: "", colaborador_filial: "", contrato: "", contrato_id: null as number | null,
  tipo_advertencia: "", grau: "", data_ocorrido: "", descricao_ocorrido: "",
  advertencia_verbal_dada: "Não", data_advertencia_verbal: "",
};
const VAGA_RESET = {
  motivo_vaga: "", nome_substituido: "", contrato: "", cargo: "",
  estado: "", cidade: "", quantidade_vagas: "1", data_inicio_prevista: "",
  escala: "", horario: "", salario: "", insalubridade_recebe: "Não",
  insalubridade_quanto: "", beneficios: "", local_exato: "",
  grau_urgencia: "", alta_rotatividade: "Não", req_obrigatorios: "",
  req_desejaveis: "", exp_minima: "Não", exp_minima_qual: "",
  motivos_saida: "", recomendacao: "", observacao_importante: "",
};

interface SolItem {
  tipo: string; icon: string; id: number; titulo: string; status: string; data: string;
  substituido?: string; motivo?: string; qtdVagas?: number; statusDesde?: string; excecao?: boolean;
}

// `abrir` vem das rotas dedicadas da sidebar (Solicitar Vaga / Férias /
// Advertência): é a MESMA tela, só que já com o formulário aberto. Assim cada
// submódulo tem seu item no menu sem duplicar formulário nenhum, e fechar o
// modal deixa a pessoa no histórico, que é o resto da página.
export type SolicitacaoInicial = "vaga" | "ferias" | "advertencia";

export default function MinhasSolicitacoes({ abrir }: { abrir?: SolicitacaoInicial }) {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");

  // Wizard nova vaga
  const [modalVaga, setModalVaga] = useState(false);
  const [vagaStep, setVagaStep] = useState(1);
  const [vaga, setVaga] = useState({ ...VAGA_RESET });
  const [contratos, setContratos] = useState<string[]>([]);
  const [contratosFull, setContratosFull] = useState<any[]>([]);
  const [empregados, setEmpregados] = useState<any[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [loadingEmps, setLoadingEmps] = useState(false);

  // Modal férias
  const [modalFerias, setModalFerias] = useState(false);
  const [ferias, setFerias] = useState({ ...FERIAS_RESET });

  // Modal advertência
  const [modalAdv, setModalAdv] = useState(false);
  const [adv, setAdv] = useState({ ...ADV_RESET });
  const [advHistorico, setAdvHistorico] = useState<any[]>([]);
  const [advExc, setAdvExc] = useState({ open: false, justificativa: "" });

  // Histórico unificado
  const [minhasSols, setMinhasSols] = useState<SolItem[]>([]);
  const [loadingSols, setLoadingSols] = useState(false);
  const [filtro, setFiltro] = useState("");

  // Toasts
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const toastId = useRef(0);
  const empDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empTermo = useRef("");

  const toast = useCallback((msg: string, type = "info") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || data?.email || user.email || ""));
  }, [user?.id]);

  // ── Histórico (vaga + férias) ───────────────────────────────────────
  const carregarMinhasSols = useCallback(async () => {
    if (!user?.email) return;
    setLoadingSols(true);
    const email = user.email;

    // Vaga: tenta com status_changed_at; se a coluna ainda não existir, refaz sem ela.
    const vagaQuery = (cols: string) => (supabase as any)
      .from("SISTEMA_RECRUTAMENTO").select(cols)
      .eq("solicitante_cpf", email).order("created_at", { ascending: false }).limit(30);
    let vg = await vagaQuery("id, cargo, contrato, status, created_at, nome_substituido, quantidade_vagas, motivo_vaga, status_changed_at");
    if (vg.error) vg = await vagaQuery("id, cargo, contrato, status, created_at, nome_substituido, quantidade_vagas, motivo_vaga");

    const fr = await (supabase as any).from("SISTEMA_SOLICITACOES_FERIAS").select("id, colaborador_nome, status, criado_em").eq("solicitante_email", email).order("criado_em", { ascending: false }).limit(30);
    const ad = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA").select("id, colaborador_nome, tipo_advertencia, status, created_at, status_changed_at, excecao").eq("solicitante_email", email).order("created_at", { ascending: false }).limit(30);
    const itens: SolItem[] = [
      ...(vg.data ?? []).map((r: any) => ({
        tipo: "Vaga", icon: "🎯", id: r.id,
        titulo: `${r.cargo || "Vaga"}${r.contrato ? ` — ${r.contrato}` : ""}`,
        status: r.status, data: r.created_at,
        substituido: r.nome_substituido || "", motivo: r.motivo_vaga || "",
        qtdVagas: Number(r.quantidade_vagas) || 1,
        statusDesde: r.status_changed_at || r.created_at,
      })),
      ...(fr.data ?? []).map((r: any) => ({ tipo: "Férias", icon: "📅", id: r.id, titulo: `Férias — ${r.colaborador_nome || ""}`, status: r.status, data: r.criado_em, statusDesde: r.criado_em })),
      ...(ad.data ?? []).map((r: any) => ({ tipo: "Advertência", icon: "⚠️", id: r.id, titulo: `Advertência ${r.tipo_advertencia || ""} — ${r.colaborador_nome || ""}`, status: r.status, data: r.created_at, statusDesde: r.status_changed_at || r.created_at, excecao: r.excecao })),
    ].sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    setLoadingSols(false);
    setMinhasSols(itens);
  }, [user?.email, user?.id]);

  useEffect(() => { carregarMinhasSols(); }, [carregarMinhasSols]);

  // ── Contratos ───────────────────────────────────────────────────────
  const carregarContratos = async () => {
    const { data } = await (supabase as any)
      .from("CONTRATOS").select('id, "NOME CONTRATO", Filial').eq("ATIVO", "SIM").order('"NOME CONTRATO"');
    if (data) {
      setContratosFull(data);
      const nomes = Array.from(new Set(data.map((c: any) => c["NOME CONTRATO"] ?? "").filter(Boolean)));
      setContratos(nomes as string[]);
    }
  };

  // ── Empregados (busca auto-debounced + descarta obsoletas) ──────────
  const buscarEmpregados = (term: string) => {
    empTermo.current = term;
    setLoadingEmps(true);
    if (empDebounce.current) clearTimeout(empDebounce.current);
    empDebounce.current = setTimeout(async () => {
      const { data, error } = await (supabase as any)
        .from("EMPREGADOS")
        .select('"ID", "Nome", "CPF", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Admissão", "Escala"')
        .eq("Situação", "Trabalhando")
        .ilike("Nome", `%${term}%`)
        .order('"Nome"')
        .limit(50);
      if (empTermo.current !== term) return;
      setLoadingEmps(false);
      if (error) console.error("[EMPREGADOS] erro:", error.message, error.code);
      setEmpregados(data ?? []);
    }, 350);
  };

  const selecionarEmpregado = (emp: any) => {
    const contratoMatch = contratosFull.find((c: any) => c.Filial === emp.Filial);
    const insal = parseFloat(String(emp["% Insalubridade"] ?? "0").replace(",", ".")) || 0;
    setVaga(v => ({
      ...v,
      nome_substituido: emp.Nome,
      cargo: emp["Título do Cargo"] ?? "",
      salario: emp["Valor Salário"] ? `R$ ${String(emp["Valor Salário"]).replace(".", ",")}` : "",
      insalubridade_recebe: insal > 0 ? "Sim" : "Não",
      insalubridade_quanto: insal > 0 ? `${emp["% Insalubridade"]}%` : "",
      escala: emp["Escala"] ? String(emp["Escala"]) : v.escala,
      contrato: contratoMatch ? contratoMatch["NOME CONTRATO"] : v.contrato,
    }));
    setEmpSearch(emp.Nome);
    setShowEmpDrop(false);
  };

  const abrirModalVaga = () => {
    setModalVaga(true); setVagaStep(1); setEmpSearch(""); setShowEmpDrop(false); setVaga({ ...VAGA_RESET });
    if (!contratos.length) carregarContratos();
  };

  const vagaValidar = (step: number) => {
    if (step === 1) {
      if (!vaga.motivo_vaga) { toast("Selecione o motivo da vaga.", "err"); return false; }
      if (!vaga.contrato) { toast("Selecione o contrato.", "err"); return false; }
      if (!vaga.cargo.trim()) { toast("Informe o cargo.", "err"); return false; }
    }
    if (step === 3) {
      if (!vaga.req_obrigatorios.trim()) { toast("Informe os requisitos obrigatórios.", "err"); return false; }
    }
    return true;
  };

  const submitVaga = async () => {
    if (!vagaValidar(3)) return;
    const payload = {
      ...vaga,
      quantidade_vagas: parseInt(vaga.quantidade_vagas) || 1,
      status: "Pendente Operacional",
      solicitante_nome: user?.user_metadata?.nome ?? user?.email ?? "",
      solicitante_cpf: user?.email ?? "",
    };
    const { error, data } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").insert(payload).select("id").single();
    if (error) { toast("Erro ao solicitar vaga: " + error.message, "err"); return; }
    toast(`Solicitação #${data?.id} criada com sucesso!`, "ok");
    setModalVaga(false); setVaga({ ...VAGA_RESET }); setVagaStep(1); setEmpSearch(""); setShowEmpDrop(false);
    carregarMinhasSols();
  };

  // ── Férias ──────────────────────────────────────────────────────────
  const selecionarColabFerias = (emp: any) => {
    setFerias(f => ({
      ...f,
      colaborador_id: emp.ID ?? null,
      colaborador_nome: emp.Nome ?? "",
      colaborador_cpf: emp.CPF ?? "",
      colaborador_cargo: emp["Título do Cargo"] ?? "",
      colaborador_filial: emp["Nome Filial"] ?? "",
      colaborador_admissao: emp["Admissão"] ?? "",
    }));
    setEmpSearch(emp.Nome ?? ""); setShowEmpDrop(false);
  };

  const abrirModalFerias = () => {
    setModalFerias(true); setFerias({ ...FERIAS_RESET }); setEmpSearch(""); setShowEmpDrop(false); setEmpregados([]);
  };

  const submitFerias = async () => {
    if (!ferias.colaborador_id) { toast("Selecione o colaborador.", "err"); return; }
    if (!ferias.data_saida) { toast("Informe a data de saída.", "err"); return; }
    if (ferias.data_saida < hojeMaisDias(30)) { toast("A saída precisa de no mínimo 30 dias de antecedência.", "err"); return; }
    const dias = parseInt(ferias.dias_ferias) || 30;
    const vend = parseInt(ferias.dias_vendidos) || 0;
    const payload = {
      solicitante_nome: displayName || user?.email || "", solicitante_email: user?.email ?? "",
      colaborador_id: ferias.colaborador_id, colaborador_nome: ferias.colaborador_nome, colaborador_cpf: ferias.colaborador_cpf,
      colaborador_cargo: ferias.colaborador_cargo, colaborador_filial: ferias.colaborador_filial,
      colaborador_admissao: brToISO(ferias.colaborador_admissao),
      data_saida: ferias.data_saida, data_retorno: addDaysISO(ferias.data_saida, dias),
      dias_ferias: dias, dias_vendidos: vend, observacoes: ferias.observacoes.trim() || null, status: "Pendente",
    };
    const { error, data } = await (supabase as any).from("SISTEMA_SOLICITACOES_FERIAS").insert(payload).select("id").single();
    if (error) { toast("Erro ao solicitar férias: " + error.message, "err"); return; }
    toast(`Férias solicitadas para ${ferias.colaborador_nome}! (#${data?.id})`, "ok");
    setModalFerias(false); setFerias({ ...FERIAS_RESET }); setEmpSearch(""); carregarMinhasSols();
  };

  // ── Advertência ─────────────────────────────────────────────────────
  const selecionarColabAdv = async (emp: any) => {
    const contratoMatch = contratosFull.find((c: any) => c.Filial === emp.Filial);
    setAdv(a => ({
      ...a,
      colaborador_id: emp.ID ?? null, colaborador_nome: emp.Nome ?? "", colaborador_cpf: emp.CPF ?? "",
      colaborador_cargo: emp["Título do Cargo"] ?? "", colaborador_filial: emp["Nome Filial"] ?? "",
      contrato: contratoMatch ? contratoMatch["NOME CONTRATO"] : "",
      contrato_id: contratoMatch ? (contratoMatch.id ?? null) : null,
    }));
    setEmpSearch(emp.Nome ?? ""); setShowEmpDrop(false);
    // Histórico de advertências do colaborador (2ª advertência reabre o mesmo histórico).
    setAdvHistorico([]);
    if (emp.ID != null) {
      const { data } = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA")
        .select("id, tipo_advertencia, grau, status, data_ocorrido, created_at")
        .eq("colaborador_id", emp.ID).order("created_at", { ascending: false }).limit(20);
      setAdvHistorico(data ?? []);
    }
  };

  const abrirModalAdv = () => {
    setModalAdv(true); setAdv({ ...ADV_RESET }); setEmpSearch(""); setShowEmpDrop(false); setEmpregados([]); setAdvHistorico([]);
    if (!contratos.length) carregarContratos();
  };

  // Abre o formulário pedido pela rota. Guarda o último valor atendido em vez
  // de um "já abri": sem isso, ir de Solicitar Vaga para Solicitar Férias pela
  // sidebar não reabriria nada (o componente não remonta, só troca a prop) — e
  // fechar o modal não pode reabri-lo sozinho.
  const ultimoAbrir = useRef<SolicitacaoInicial | null>(null);
  useEffect(() => {
    if (!abrir || ultimoAbrir.current === abrir) return;
    ultimoAbrir.current = abrir;
    if (abrir === "vaga") abrirModalVaga();
    else if (abrir === "ferias") abrirModalFerias();
    else if (abrir === "advertencia") abrirModalAdv();
  }, [abrir]);

  // Trava: grau Baixo exige advertência verbal antes da escrita.
  const advBloqueada = adv.grau === "Baixo" && adv.advertencia_verbal_dada === "Não";

  // Data do ocorrido com mais de 3 dias → fora do prazo (vira EXCEÇÃO com justificativa).
  const advForaDoPrazo = () => {
    if (!adv.data_ocorrido) return false;
    const limite = new Date(); limite.setHours(0, 0, 0, 0); limite.setDate(limite.getDate() - 3);
    return new Date(adv.data_ocorrido + "T00:00:00") < limite;
  };

  const submitAdv = async () => {
    if (!adv.colaborador_id) { toast("Selecione o colaborador.", "err"); return; }
    if (!adv.tipo_advertencia) { toast("Selecione o tipo de advertência.", "err"); return; }
    if (!adv.grau) { toast("Selecione o grau da advertência.", "err"); return; }
    if (!adv.data_ocorrido) { toast("Informe a data do ocorrido.", "err"); return; }
    if (adv.descricao_ocorrido.trim().length < 50) { toast("A descrição do ocorrido precisa ter pelo menos 50 caracteres.", "err"); return; }
    if (adv.advertencia_verbal_dada === "Sim" && !adv.data_advertencia_verbal) { toast("Informe a data em que a advertência verbal foi aplicada.", "err"); return; }
    if (advBloqueada) { toast("Primeiro dê a advertência verbal para dar a escrita.", "err"); return; }
    if (advForaDoPrazo()) { setAdvExc({ open: true, justificativa: "" }); return; }  // pede justificativa de exceção
    await doSubmitAdv(false, null);
  };

  const confirmarExcecao = async () => {
    if (advExc.justificativa.trim().length < 10) { toast("Justifique a exceção (mín. 10 caracteres).", "err"); return; }
    await doSubmitAdv(true, advExc.justificativa.trim());
  };

  const doSubmitAdv = async (excecao: boolean, justificativa: string | null) => {
    const payload = {
      solicitante_nome: displayName || user?.email || "", solicitante_email: user?.email ?? "",
      colaborador_id: adv.colaborador_id, colaborador_nome: adv.colaborador_nome, colaborador_cpf: adv.colaborador_cpf,
      colaborador_cargo: adv.colaborador_cargo, colaborador_filial: adv.colaborador_filial,
      contrato: adv.contrato || null, contrato_id: adv.contrato_id,
      tipo_advertencia: adv.tipo_advertencia, grau: adv.grau, data_ocorrido: adv.data_ocorrido,
      descricao_ocorrido: adv.descricao_ocorrido.trim(),
      advertencia_verbal_dada: adv.advertencia_verbal_dada === "Sim",
      data_advertencia_verbal: adv.advertencia_verbal_dada === "Sim" ? (adv.data_advertencia_verbal || null) : null,
      status: "Aguardando Aprovação",
      excecao, justificativa_excecao: justificativa,
    };
    const { error, data } = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA").insert(payload).select("id").single();
    if (error) { toast("Erro ao solicitar advertência: " + error.message, "err"); return; }
    toast(`Advertência solicitada${excecao ? " (EXCEÇÃO)" : ""} para ${adv.colaborador_nome}! (#${data?.id})`, "ok");
    setAdvExc({ open: false, justificativa: "" });
    setModalAdv(false); setAdv({ ...ADV_RESET }); setEmpSearch(""); carregarMinhasSols();
  };

  // ── CSS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "mns-styles";
    style.textContent = `
      .ini-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 8px 24px rgba(15,23,42,.06);overflow:hidden;margin-bottom:20px;}
      .ini-card-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #e2e8f0;}
      .ini-card-hd h3{font-size:.94rem;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:7px;}
      .ini-card-body{padding:16px 20px;}
      .ini-sol-create{display:flex;flex-direction:column;align-items:center;gap:7px;padding:14px 10px;border-radius:12px;border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;transition:all .15s;text-align:center;box-shadow:0 1px 4px rgba(15,23,42,.04);font-family:inherit;}
      .ini-sol-create:hover{border-color:#0f3171;background:#eef4ff;transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,49,113,.1);}
      .ini-sol-create .icon{font-size:1.3rem;}
      .ini-sol-create span{font-size:.75rem;font-weight:600;color:#0f172a;line-height:1.2;}
      .ini-sol-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;}
      .ini-sol-item:last-child{border-bottom:none;}
      .ini-sol-icon{width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:15px;background:rgba(8,145,178,.1);}
      .ini-sol-info{flex:1;min-width:0;}
      .ini-sol-title{font-size:.85rem;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ini-sol-meta{font-size:.72rem;color:#94a3b8;margin-top:2px;}
      .ini-sol-top{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;}
      .ini-sol-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569;background:#eef4ff;border:1px solid #dbe4f0;border-radius:6px;padding:1px 7px;line-height:1.5;}
      .ini-sol-tag strong{color:#0f172a;font-weight:700;}
      .ini-sol-dias{font-size:10px;color:#94a3b8;white-space:nowrap;font-weight:600;}
      .ini-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;border:1px solid transparent;}
      .ini-modal-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.42);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;}
      .ini-modal{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:24px;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.12);}
      .ini-fi{width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;font-size:13px;padding:8px 12px;outline:none;font-family:inherit;transition:.15s;}
      .ini-fi:focus{border-color:#0f3171;box-shadow:0 0 0 4px rgba(15,49,113,.08);}
      .ini-fg{margin-bottom:14px;}
      .ini-fg label{display:block;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;}
    `;
    document.head.appendChild(style);
    return () => { document.getElementById("mns-styles")?.remove(); };
  }, []);

  const lista = filtro ? minhasSols.filter(s => s.tipo === filtro) : minhasSols;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 40px", background: "#f5f7fb" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>📤 Minhas Solicitações</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Abra novas solicitações e acompanhe o status e o histórico das suas.</p>
      </div>

      {/* Botões de criação */}
      <div className="ini-card">
        <div className="ini-card-hd"><h3>➕ Nova Solicitação</h3></div>
        <div className="ini-card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
            <button onClick={abrirModalVaga} className="ini-sol-create"><span className="icon">🎯</span><span>Solicitar Vaga</span></button>
            <button onClick={abrirModalFerias} className="ini-sol-create"><span className="icon">📅</span><span>Solicitar Férias</span></button>
            <button onClick={abrirModalAdv} className="ini-sol-create"><span className="icon">⚠️</span><span>Advertência</span></button>
            <button className="ini-sol-create" style={{ opacity: .5, cursor: "not-allowed" }} disabled title="Em breve"><span className="icon">🚪</span><span>Solicitar Demissão</span></button>
          </div>
        </div>
      </div>

      {/* Histórico / status */}
      <div className="ini-card">
        <div className="ini-card-hd">
          <h3>🗂 Histórico & Status</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {["", "Vaga", "Férias", "Advertência"].map(f => (
              <button key={f || "all"} onClick={() => setFiltro(f)}
                style={{ padding: "4px 10px", borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${filtro === f ? "#0f3171" : "#e2e8f0"}`, background: filtro === f ? "#0f3171" : "#fff", color: filtro === f ? "#fff" : "#475569" }}>
                {f || "Todas"}
              </button>
            ))}
          </div>
        </div>
        <div className="ini-card-body">
          {loadingSols ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Carregando...</div>
          ) : lista.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>Nenhuma solicitação ainda.
            </div>
          ) : (
            <div>
              {lista.map(s => {
                const dias = diasDesde(s.statusDesde);
                const qtd = s.qtdVagas || 1;
                return (
                  <div key={`${s.tipo}-${s.id}`} className="ini-sol-item">
                    <div className="ini-sol-icon">{s.icon}</div>
                    <div className="ini-sol-info">
                      {s.tipo === "Vaga" && (
                        <div className="ini-sol-top">
                          {s.motivo === "Substituição" && s.substituido && (
                            <span className="ini-sol-tag">🔁 Substituindo: <strong>{s.substituido}</strong></span>
                          )}
                          <span className="ini-sol-tag">🎯 {qtd} vaga{qtd > 1 ? "s" : ""} solicitada{qtd > 1 ? "s" : ""}</span>
                        </div>
                      )}
                      <div className="ini-sol-title">{s.titulo}</div>
                      <div className="ini-sol-meta">{s.tipo} · #{s.id} · {fmtDt(s.data)}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span className={`ini-badge ${badgeStatusCls(s.status)}`}>{s.status}</span>
                      {s.excecao && <span className="ini-badge" style={{ background: "#fef3c7", color: "#b45309", borderColor: "#fde68a" }}>EXCEÇÃO</span>}
                      {dias !== null && (
                        <span className="ini-sol-dias" title={`Tempo parado no status atual: ${s.status}`}>
                          ⏱ {dias === 0 ? "hoje" : `há ${dias} dia${dias > 1 ? "s" : ""}`} neste status
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal Nova Vaga ── */}
      {modalVaga && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalVaga(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Solicitar Nova Vaga</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
              {vagaStep === 1 ? "Etapa 1 de 3 — Identificação da Vaga" : vagaStep === 2 ? "Etapa 2 de 3 — Detalhes do Posto" : "Etapa 3 de 3 — Requisitos e Urgência"}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < vagaStep ? "#16a34a" : i === vagaStep ? "#0f3171" : "#dbe4f0", transition: "background .2s" }} />
              ))}
            </div>

            {vagaStep === 1 && (<>
              <div className="ini-fg">
                <label>Motivo da Vaga *</label>
                <select className="ini-fi" value={vaga.motivo_vaga} onChange={e => setVaga(v => ({ ...v, motivo_vaga: e.target.value }))}>
                  <option value="">— Selecione —</option>
                  {["Admissão", "Substituição", "Expansão", "Transferência", "Retorno"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              {vaga.motivo_vaga === "Substituição" && (
                <div className="ini-fg" style={{ position: "relative" }} onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
                  <label>Colaborador a Substituir</label>
                  <input className="ini-fi" placeholder="Digite o nome do colaborador..." value={empSearch} autoComplete="off"
                    onChange={e => { const v = e.target.value; setEmpSearch(v); setVaga(prev => ({ ...prev, nome_substituido: v })); if (v.length >= 2) { setShowEmpDrop(true); buscarEmpregados(v); } else { setShowEmpDrop(false); setEmpregados([]); } }} />
                  {showEmpDrop && empSearch.length >= 2 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                      {loadingEmps ? <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Buscando...</div>
                        : empregados.length === 0 ? <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                          : empregados.slice(0, 40).map((emp, i) => (
                            <div key={i} onMouseDown={() => selecionarEmpregado(emp)} style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}
                              onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                              <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                            </div>
                          ))}
                    </div>
                  )}
                </div>
              )}
              <div className="ini-fg">
                <label>Contrato *</label>
                <select className="ini-fi" value={vaga.contrato} onChange={e => setVaga(v => ({ ...v, contrato: e.target.value }))}>
                  <option value="">— Selecione —</option>
                  {contratos.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="ini-fg"><label>Cargo *</label><input className="ini-fi" placeholder="Ex: Auxiliar de Limpeza, Vigilante..." value={vaga.cargo} onChange={e => setVaga(v => ({ ...v, cargo: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg">
                  <label>Estado (UF)</label>
                  <select className="ini-fi" value={vaga.estado} onChange={e => setVaga(v => ({ ...v, estado: e.target.value, cidade: "" }))}>
                    <option value="">— Selecione —</option>
                    {ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>)}
                  </select>
                </div>
                <div className="ini-fg">
                  <label>Cidade</label>
                  <select className="ini-fi" value={vaga.cidade} disabled={!vaga.estado} onChange={e => setVaga(v => ({ ...v, cidade: e.target.value }))}>
                    <option value="">{vaga.estado ? "— Selecione —" : "Selecione o estado primeiro"}</option>
                    {municipiosDe(vaga.estado).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </>)}

            {vagaStep === 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg"><label>Quantidade de Vagas</label><input className="ini-fi" type="number" min={1} max={99} value={vaga.quantidade_vagas} onChange={e => setVaga(v => ({ ...v, quantidade_vagas: e.target.value }))} /></div>
                <div className="ini-fg"><label>Data de Início Prevista</label><input className="ini-fi" type="date" value={vaga.data_inicio_prevista} onChange={e => setVaga(v => ({ ...v, data_inicio_prevista: e.target.value }))} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg"><label>Escala</label><input className="ini-fi" placeholder="Ex: 12x36, 5x2..." value={vaga.escala} onChange={e => setVaga(v => ({ ...v, escala: e.target.value }))} /></div>
                <div className="ini-fg"><label>Horário</label><input className="ini-fi" placeholder="Ex: 07h às 19h..." value={vaga.horario} onChange={e => setVaga(v => ({ ...v, horario: e.target.value }))} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg"><label>Salário</label><input className="ini-fi" placeholder="Ex: R$ 1.412,00" value={vaga.salario} onChange={e => setVaga(v => ({ ...v, salario: e.target.value }))} /></div>
                <div className="ini-fg"><label>Insalubridade</label><select className="ini-fi" value={vaga.insalubridade_recebe} onChange={e => setVaga(v => ({ ...v, insalubridade_recebe: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
              </div>
              {vaga.insalubridade_recebe === "Sim" && (
                <div className="ini-fg"><label>Percentual de Insalubridade</label><input className="ini-fi" placeholder="Ex: 20%, 40%" value={vaga.insalubridade_quanto} onChange={e => setVaga(v => ({ ...v, insalubridade_quanto: e.target.value }))} /></div>
              )}
              <div className="ini-fg"><label>Benefícios</label><textarea className="ini-fi" rows={2} placeholder="VT, VR, Plano de Saúde..." value={vaga.beneficios} onChange={e => setVaga(v => ({ ...v, beneficios: e.target.value }))} /></div>
              <div className="ini-fg"><label>Local Exato / Posto</label><input className="ini-fi" placeholder="Nome do posto ou endereço..." value={vaga.local_exato} onChange={e => setVaga(v => ({ ...v, local_exato: e.target.value }))} /></div>
            </>)}

            {vagaStep === 3 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg"><label>Grau de Urgência</label><select className="ini-fi" value={vaga.grau_urgencia} onChange={e => setVaga(v => ({ ...v, grau_urgencia: e.target.value }))}><option value="">— Selecione —</option>{["Baixa", "Média", "Alta — Urgente"].map(o => <option key={o}>{o}</option>)}</select></div>
                <div className="ini-fg"><label>Alta Rotatividade?</label><select className="ini-fi" value={vaga.alta_rotatividade} onChange={e => setVaga(v => ({ ...v, alta_rotatividade: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
              </div>
              <div className="ini-fg"><label>Requisitos Obrigatórios *</label><textarea className="ini-fi" rows={3} placeholder="Experiência comprovada, CNH B..." value={vaga.req_obrigatorios} onChange={e => setVaga(v => ({ ...v, req_obrigatorios: e.target.value }))} /></div>
              <div className="ini-fg"><label>Requisitos Desejáveis</label><textarea className="ini-fi" rows={2} placeholder="Inglês básico, curso técnico..." value={vaga.req_desejaveis} onChange={e => setVaga(v => ({ ...v, req_desejaveis: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg"><label>Experiência Mínima?</label><select className="ini-fi" value={vaga.exp_minima} onChange={e => setVaga(v => ({ ...v, exp_minima: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
                {vaga.exp_minima === "Sim" && (<div className="ini-fg"><label>Qual experiência?</label><input className="ini-fi" placeholder="Ex: 6 meses em limpeza" value={vaga.exp_minima_qual} onChange={e => setVaga(v => ({ ...v, exp_minima_qual: e.target.value }))} /></div>)}
              </div>
              <div className="ini-fg"><label>Observação Importante</label><textarea className="ini-fi" rows={2} placeholder="Opcional..." value={vaga.observacao_importante} onChange={e => setVaga(v => ({ ...v, observacao_importante: e.target.value }))} /></div>
            </>)}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              {vagaStep > 1 && <button onClick={() => setVagaStep(s => s - 1)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Anterior</button>}
              {vagaStep < 3 && <button onClick={() => { if (vagaValidar(vagaStep)) setVagaStep(s => s + 1); }} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Próximo →</button>}
              {vagaStep === 3 && <button onClick={submitVaga} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Solicitar Vaga</button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Férias ── */}
      {modalFerias && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <button onClick={() => setModalFerias(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>📅 Solicitar Férias</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Antecedência mínima de 30 dias · abono (venda) de até 10 dias.</div>
            <div className="ini-fg" style={{ position: "relative" }} onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
              <label>Colaborador *</label>
              <input className="ini-fi" placeholder="Digite o nome do colaborador..." value={empSearch} autoComplete="off"
                onChange={e => { const v = e.target.value; setEmpSearch(v); setFerias(f => ({ ...f, colaborador_id: null })); if (v.length >= 2) { setShowEmpDrop(true); buscarEmpregados(v); } else { setShowEmpDrop(false); setEmpregados([]); } }} />
              {showEmpDrop && empSearch.length >= 2 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                  {loadingEmps ? <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Buscando...</div>
                    : empregados.length === 0 ? <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                      : empregados.slice(0, 40).map((emp, i) => (
                        <div key={i} onMouseDown={() => selecionarColabFerias(emp)} style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                          <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                        </div>
                      ))}
                </div>
              )}
            </div>
            {ferias.colaborador_id && (
              <div style={{ margin: "-6px 0 14px", padding: "8px 12px", borderRadius: 10, background: "#f0f4ff", border: "1px solid #dbe4f0", fontSize: 12, color: "#475569" }}>
                <strong style={{ color: "#0f172a" }}>{ferias.colaborador_nome}</strong>
                {ferias.colaborador_cargo ? ` · ${ferias.colaborador_cargo}` : ""}{ferias.colaborador_filial ? ` · ${ferias.colaborador_filial}` : ""}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Data de Saída *</label><input className="ini-fi" type="date" min={hojeMaisDias(30)} value={ferias.data_saida} onChange={e => setFerias(f => ({ ...f, data_saida: e.target.value }))} /></div>
              <div className="ini-fg"><label>Dias de Férias</label><select className="ini-fi" value={ferias.dias_ferias} onChange={e => setFerias(f => ({ ...f, dias_ferias: e.target.value }))}>{["30", "20", "15", "10"].map(o => <option key={o} value={o}>{o} dias</option>)}</select></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Abono (vender dias)</label><select className="ini-fi" value={ferias.dias_vendidos} onChange={e => setFerias(f => ({ ...f, dias_vendidos: e.target.value }))}>{["0", "5", "10"].map(o => <option key={o} value={o}>{o} dias</option>)}</select></div>
              <div className="ini-fg"><label>Retorno (previsto)</label><input className="ini-fi" readOnly value={ferias.data_saida ? fmtDt(addDaysISO(ferias.data_saida, parseInt(ferias.dias_ferias) || 30)) : "—"} style={{ background: "#f8fafc", color: "#475569" }} /></div>
            </div>
            <div className="ini-fg"><label>Observações</label><textarea className="ini-fi" rows={2} value={ferias.observacoes} onChange={e => setFerias(f => ({ ...f, observacoes: e.target.value }))} placeholder="Opcional..." /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <button onClick={() => setModalFerias(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={submitFerias} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Solicitar Férias</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Advertência ── */}
      {modalAdv && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <button onClick={() => setModalAdv(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>⚠️ Solicitar Advertência</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Selecione o colaborador e responda as questões. Segue para o analista do contrato aprovar e depois para o Jurídico.</div>

            <div className="ini-fg" style={{ position: "relative" }} onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
              <label>Colaborador *</label>
              <input className="ini-fi" placeholder="Digite o nome do colaborador..." value={empSearch} autoComplete="off"
                onChange={e => { const v = e.target.value; setEmpSearch(v); setAdv(a => ({ ...a, colaborador_id: null })); if (v.length >= 2) { setShowEmpDrop(true); buscarEmpregados(v); } else { setShowEmpDrop(false); setEmpregados([]); } }} />
              {showEmpDrop && empSearch.length >= 2 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                  {loadingEmps ? <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Buscando...</div>
                    : empregados.length === 0 ? <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                      : empregados.slice(0, 40).map((emp, i) => (
                        <div key={i} onMouseDown={() => selecionarColabAdv(emp)} style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                          <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                        </div>
                      ))}
                </div>
              )}
            </div>
            {adv.colaborador_id && (
              <div style={{ margin: "-6px 0 14px", padding: "8px 12px", borderRadius: 10, background: "#f0f4ff", border: "1px solid #dbe4f0", fontSize: 12, color: "#475569" }}>
                <strong style={{ color: "#0f172a" }}>{adv.colaborador_nome}</strong>{adv.colaborador_cargo ? ` · ${adv.colaborador_cargo}` : ""}{adv.colaborador_filial ? ` · ${adv.colaborador_filial}` : ""}
              </div>
            )}

            {adv.colaborador_id && advHistorico.length > 0 && (
              <div style={{ margin: "-6px 0 14px", padding: "8px 12px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 12, color: "#9a3412" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ {advHistorico.length} advertência(s) anterior(es) deste colaborador:</div>
                {advHistorico.slice(0, 5).map((h: any) => (
                  <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #fed7aa", padding: "3px 0" }}>
                    <span>{h.tipo_advertencia || "—"} · grau {h.grau || "—"}</span>
                    <span style={{ color: "#b45309" }}>{fmtDt(h.data_ocorrido || h.created_at)} · {h.status}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="ini-fg">
              <label>Contrato (puxado automaticamente do colaborador)</label>
              <input className="ini-fi" readOnly value={adv.contrato || "—"} style={{ background: "#f8fafc", color: "#475569", cursor: "not-allowed" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Tipo de advertência *</label><select className="ini-fi" value={adv.tipo_advertencia} onChange={e => setAdv(a => ({ ...a, tipo_advertencia: e.target.value }))}><option value="">— Selecione —</option>{["Verbal", "Escrita", "Suspensão"].map(o => <option key={o}>{o}</option>)}</select></div>
              <div className="ini-fg"><label>Grau *</label><select className="ini-fi" value={adv.grau} onChange={e => setAdv(a => ({ ...a, grau: e.target.value }))}><option value="">— Selecione —</option>{["Baixo", "Médio", "Alto"].map(o => <option key={o}>{o}</option>)}</select></div>
            </div>

            <div className="ini-fg"><label>Data do ocorrido *</label><input className="ini-fi" type="date" max={hojeMaisDias(0)} value={adv.data_ocorrido} onChange={e => setAdv(a => ({ ...a, data_ocorrido: e.target.value }))} /><div style={{ fontSize: 11, color: advForaDoPrazo() ? "#dc2626" : "#94a3b8", marginTop: 3, fontWeight: 600 }}>{advForaDoPrazo() ? "⚠️ Mais de 3 dias atrás — será registrada como Exceção (com justificativa)." : "Prazo ideal: até 3 dias atrás."}</div></div>
            <div className="ini-fg">
              <label>Descrição do ocorrido * (mín. 50 caracteres)</label>
              <textarea className="ini-fi" rows={4} placeholder="Descreva o que aconteceu, com detalhes..." value={adv.descricao_ocorrido} onChange={e => setAdv(a => ({ ...a, descricao_ocorrido: e.target.value }))} />
              <div style={{ fontSize: 11, color: adv.descricao_ocorrido.trim().length >= 50 ? "#16a34a" : "#94a3b8", marginTop: 3, fontWeight: 600 }}>{adv.descricao_ocorrido.trim().length}/50 caracteres</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Advertência verbal já foi dada para o mesmo fato?</label><select className="ini-fi" value={adv.advertencia_verbal_dada} onChange={e => setAdv(a => ({ ...a, advertencia_verbal_dada: e.target.value, tipo_advertencia: (e.target.value === "Sim" && !a.tipo_advertencia) ? "Escrita" : a.tipo_advertencia }))}><option>Não</option><option>Sim</option></select></div>
              {adv.advertencia_verbal_dada === "Sim" && (
                <div className="ini-fg"><label>Data da advertência verbal *</label><input className="ini-fi" type="date" max={hojeMaisDias(0)} value={adv.data_advertencia_verbal} onChange={e => setAdv(a => ({ ...a, data_advertencia_verbal: e.target.value }))} /></div>
              )}
            </div>

            {advBloqueada && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, marginBottom: 14, fontWeight: 600 }}>
                Primeiro dê a advertência verbal para dar a escrita.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <button onClick={() => setModalAdv(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={submitAdv} disabled={advBloqueada} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: advBloqueada ? "#cbd5e1" : "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: advBloqueada ? "not-allowed" : "pointer" }}>✓ Solicitar Advertência</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmação de Exceção (advertência fora do prazo de 3 dias) ── */}
      {advExc.open && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: "#b45309" }}>⚠️ Advertência fora do prazo</div>
            <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 14, lineHeight: 1.5 }}>A advertência está sendo aplicada fora do período correto (mais de 3 dias após o ocorrido). Poderá ser aceita como <b>Exceção</b>. Justifique:</div>
            <div className="ini-fg"><label>Justificativa da exceção *</label><textarea className="ini-fi" rows={3} placeholder="Explique por que está sendo solicitada fora do prazo…" value={advExc.justificativa} onChange={e => setAdvExc(s => ({ ...s, justificativa: e.target.value }))} /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button onClick={() => setAdvExc({ open: false, justificativa: "" })} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarExcecao} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#d97706", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Confirmar como Exceção</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.1)",
            background: t.type === "ok" ? "#ecfdf3" : t.type === "err" ? "#fef2f2" : "#eff6ff",
            color: t.type === "ok" ? "#15803d" : t.type === "err" ? "#b91c1c" : "#1d4ed8",
            border: `1px solid ${t.type === "ok" ? "#86efac" : t.type === "err" ? "#fecaca" : "#bfdbfe"}`,
          }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
