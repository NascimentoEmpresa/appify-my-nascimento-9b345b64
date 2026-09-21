import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useMeuNome } from "@/hooks/useMeuNome";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { ModalExportarDados } from "@/components/exportar/ModalExportarDados";
import { baixar } from "@/lib/exportarRelatorio";
import {
  CATEGORIAS_ANEXO, COR_ETAPA, COR_PRAZO, COR_RESULTADO, DESFECHOS, ETAPAS, INSTANCIAS, RESULTADOS, RESULTADOS_DEFESA,
  SETORES, TIPOS, encerrada, indicadores, ordemDaFila, situacaoPrazo, valorEvitado, valorVigente, type Notificacao,
} from "./notificacoes/regras";
import { carregarExtras, gerarExcel, gerarHtml, nomeArquivo } from "./notificacoes/exportar";

// =====================================================================
// JURÍDICO › Controle de Notificações (21/09/2026)
//
// Multas, glosas, notificações e apontamentos contratuais — do recebimento
// ao encerramento, com defesa, recurso, desconto e medida preventiva. Veio
// das planilhas de Excel do Jurídico; o banco é a mig 20260930000199.
//
// Três perguntas separadas em três campos (ver mig): `etapa` (onde está o
// trabalho), `resultado` (o que decidiram) e `desfecho_financeiro` (o que
// aconteceu com o dinheiro). O histórico é gravado por trigger — a tela só
// lê — e é ele que dá a rastreabilidade ("quem mudou o valor e quando").
//
// Acesso: menu `juridico_notificacoes`. visualizar = ver tudo; incluir =
// registrar ocorrência; alterar = editar, lançar defesa, anexar; excluir.
// =====================================================================

const db = supabase as unknown as SupabaseClient;
const BUCKET = "juridico-notificacoes";
const MENU = "juridico_notificacoes";

interface Defesa {
  id: number; notificacao_id: number; instancia: string; prazo?: string | null; data_protocolo?: string | null;
  numero_protocolo?: string | null; argumentos?: string | null; resultado: string; data_resultado?: string | null;
  valor_apos?: number | null; responsavel_nome?: string | null; observacao?: string | null; created_at?: string;
}
interface Anexo { id: number; notificacao_id: number; defesa_id?: number | null; categoria: string; nome: string; storage_path: string; tamanho?: number | null; enviado_por?: string | null; created_at?: string }
interface Hist { id: number; acao: string; detalhe?: string | null; autor_nome?: string | null; created_at: string }
interface Comentario { id: number; texto: string; autor_nome?: string | null; created_at?: string }

const hoje = () => new Date().toISOString().slice(0, 10);
const money = (v?: number | null) => v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const moneyCurto = (v: number) => Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M` : Math.abs(v) >= 1e4 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k` : money(v);
const fmtDt = (s?: string | null) => { if (!s) return "—"; const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const fmtDtHr = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
const numOuNull = (v: string) => { const t = String(v ?? "").trim(); if (!t) return null; const n = Number(t.replace(/\./g, "").replace(",", ".")); return isNaN(n) ? null : n; };
const paraCampo = (v?: number | null) => v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PALETA = ["#0f3171", "#2563eb", "#0891b2", "#16a34a", "#eab308", "#f97316", "#dc2626", "#7c3aed"];

const Selo = ({ texto, cor }: { texto?: string | null; cor?: { bg: string; fg: string } }) => !texto ? null : (
  <span style={{ display: "inline-block", fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap", background: cor?.bg ?? "#f1f5f9", color: cor?.fg ?? "#475569" }}>{texto}</span>
);

const FORM_VAZIO = {
  tipo: "Multa", assunto: "", orgao: "", contrato: "", numero_documento: "", local_posto: "",
  data_ocorrencia: "", data_recebimento: hoje(), prazo_defesa: "",
  descricao: "", fundamentacao: "", observacoes: "",
  valor_original: "", valor_final: "", valor_descontado: "",
  etapa: "Recebida", resultado: "", desfecho_financeiro: "", data_desfecho: "",
  setor_responsavel: "Jurídico", responsavel_nome: "",
  causa_raiz: "", medida_preventiva: "", medida_responsavel: "", medida_prazo: "", medida_concluida: false,
};
type Form = typeof FORM_VAZIO;
const DEFESA_VAZIA = { instancia: "Defesa prévia", prazo: "", data_protocolo: "", numero_protocolo: "", argumentos: "", resultado: "Aguardando", data_resultado: "", valor_apos: "", responsavel_nome: "", observacao: "" };

export default function Notificacoes() {
  const autor = useMeuNome() || "Usuário";
  const { data: podeIncluir } = useScreenAccess(MENU, "incluir");
  const { data: podeAlterar } = useScreenAccess(MENU, "alterar");
  const { data: podeExcluir } = useScreenAccess(MENU, "excluir");

  const [lista, setLista] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"painel" | "lista">("lista");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600); };

  // Listas de apoio: contratos ativos e nomes de usuários (sugestão de responsável).
  const [contratos, setContratos] = useState<string[]>([]);
  const [pessoas, setPessoas] = useState<string[]>([]);

  // Filtros
  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fEtapa, setFEtapa] = useState("abertas");
  const [fPrazo, setFPrazo] = useState("");
  const [fContrato, setFContrato] = useState("");
  const [fSetor, setFSetor] = useState("");
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");

  // Modal de cadastro/edição
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ ...FORM_VAZIO });
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);

  // Detalhe
  const [sel, setSel] = useState<Notificacao | null>(null);
  const [tabDet, setTabDet] = useState<"resumo" | "defesas" | "documentos" | "historico" | "comentarios">("resumo");
  const [defesas, setDefesas] = useState<Defesa[]>([]);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [coments, setComents] = useState<Comentario[]>([]);
  const [novoComent, setNovoComent] = useState("");
  const [defForm, setDefForm] = useState<typeof DEFESA_VAZIA | null>(null);
  const [defEditId, setDefEditId] = useState<number | null>(null);
  const [catAnexo, setCatAnexo] = useState<string>("Notificação recebida");
  const fileRef = useRef<HTMLInputElement>(null);

  const [exportando, setExportando] = useState<{ id: number | null } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const acc: Notificacao[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db.from("JUR_NOTIFICACOES").select("*").order("id", { ascending: true }).range(de, de + 999);
      if (error) { setErro(error.message); setCarregando(false); return; }
      acc.push(...((data ?? []) as Notificacao[]));
      if (!data || data.length < 1000) break;
    }
    setLista(acc); setCarregando(false);
    setSel(s => (s ? acc.find(n => n.id === s.id) ?? null : s));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: p }] = await Promise.all([
        db.from("CONTRATOS").select('"NOME CONTRATO"').eq("ATIVO", "SIM"),
        db.from("profiles").select("display_name").eq("ativo", true).order("display_name"),
      ]);
      setContratos([...new Set((c ?? []).map((x: Record<string, unknown>) => String(x["NOME CONTRATO"] ?? "").trim()).filter(Boolean))].sort() as string[]);
      setPessoas([...new Set((p ?? []).map((x: { display_name?: string | null }) => String(x.display_name ?? "").trim()).filter(Boolean))] as string[]);
    })();
  }, []);

  const H = hoje();
  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter(n => {
      if (fTipo && n.tipo !== fTipo) return false;
      if (fEtapa === "abertas" && encerrada(n)) return false;
      if (fEtapa && fEtapa !== "abertas" && n.etapa !== fEtapa) return false;
      if (fContrato && (n.contrato ?? "") !== fContrato) return false;
      if (fSetor && (n.setor_responsavel ?? "") !== fSetor) return false;
      if (fDe && n.data_recebimento < fDe) return false;
      if (fAte && n.data_recebimento > fAte) return false;
      if (fPrazo) {
        const nv = situacaoPrazo(n, H).nivel;
        if (fPrazo === "vencido" && nv !== "vencido") return false;
        if (fPrazo === "7dias" && !["hoje", "urgente", "atencao"].includes(nv)) return false;
      }
      if (q && ![n.protocolo, n.assunto, n.orgao, n.contrato, n.numero_documento, n.responsavel_nome, n.local_posto, n.descricao]
        .some(x => String(x ?? "").toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => ordemDaFila(a, b, H));
  }, [lista, busca, fTipo, fEtapa, fContrato, fSetor, fDe, fAte, fPrazo, H]);
  const ind = useMemo(() => indicadores(filtrada, H), [filtrada, H]);
  const indGeral = useMemo(() => indicadores(lista, H), [lista, H]);
  const contratosUsados = useMemo(() => [...new Set(lista.map(n => n.contrato ?? "").filter(Boolean))].sort(), [lista]);
  const filtrosAtivos = [busca, fTipo, fEtapa !== "abertas" ? fEtapa : "", fPrazo, fContrato, fSetor, fDe, fAte].filter(Boolean).length;
  const limpar = () => { setBusca(""); setFTipo(""); setFEtapa("abertas"); setFPrazo(""); setFContrato(""); setFSetor(""); setFDe(""); setFAte(""); };

  // ── Cadastro / edição ───────────────────────────────────────────
  const abrirNovo = () => { setEditId(null); setForm({ ...FORM_VAZIO, data_recebimento: hoje() }); setArquivosNovos([]); setModal(true); };
  const abrirEditar = (n: Notificacao) => {
    setEditId(n.id);
    setForm({
      ...FORM_VAZIO,
      ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v ?? ""])),
      valor_original: paraCampo(n.valor_original), valor_final: paraCampo(n.valor_final), valor_descontado: paraCampo(n.valor_descontado),
      medida_concluida: !!n.medida_concluida,
    } as Form);
    setArquivosNovos([]); setModal(true);
  };
  const avisoForm = (() => {
    if (form.prazo_defesa && form.data_recebimento && form.prazo_defesa < form.data_recebimento) return "O prazo de defesa está antes da data de recebimento.";
    if (form.etapa === "Encerrada" && !form.resultado) return "Para encerrar, informe o resultado.";
    return null;
  })();
  const salvar = async () => {
    if (!form.assunto.trim()) { toast("Informe o assunto.", "err"); return; }
    if (!form.data_recebimento) { toast("Informe a data de recebimento.", "err"); return; }
    if (avisoForm) { toast(avisoForm, "err"); return; }
    const t = (v: string) => (String(v ?? "").trim() || null);
    const payload = {
      tipo: form.tipo, assunto: form.assunto.trim(), orgao: t(form.orgao), contrato: t(form.contrato),
      numero_documento: t(form.numero_documento), local_posto: t(form.local_posto),
      data_ocorrencia: t(form.data_ocorrencia), data_recebimento: form.data_recebimento, prazo_defesa: t(form.prazo_defesa),
      descricao: t(form.descricao), fundamentacao: t(form.fundamentacao), observacoes: t(form.observacoes),
      valor_original: numOuNull(form.valor_original), valor_final: numOuNull(form.valor_final), valor_descontado: numOuNull(form.valor_descontado),
      etapa: form.etapa, resultado: t(form.resultado), desfecho_financeiro: t(form.desfecho_financeiro), data_desfecho: t(form.data_desfecho),
      setor_responsavel: t(form.setor_responsavel), responsavel_nome: t(form.responsavel_nome),
      causa_raiz: t(form.causa_raiz), medida_preventiva: t(form.medida_preventiva), medida_responsavel: t(form.medida_responsavel),
      medida_prazo: t(form.medida_prazo), medida_concluida: !!form.medida_concluida,
    };
    setSalvando(true);
    let id = editId;
    if (editId) {
      const { error } = await db.from("JUR_NOTIFICACOES").update(payload).eq("id", editId);
      if (error) { setSalvando(false); toast("Erro ao salvar: " + error.message, "err"); return; }
    } else {
      const { data, error } = await db.from("JUR_NOTIFICACOES").insert(payload).select("id, protocolo").single();
      if (error) { setSalvando(false); toast("Erro ao registrar: " + error.message, "err"); return; }
      id = data.id;
      toast(`Ocorrência ${data.protocolo} registrada.`, "ok");
    }
    // O documento que chegou junto (a própria notificação) já sobe no cadastro.
    if (id && arquivosNovos.length) await enviarArquivos(id, arquivosNovos, "Notificação recebida");
    setSalvando(false); setModal(false);
    if (editId) toast("Ocorrência atualizada.", "ok");
    await carregar();
    if (sel && id === sel.id) abrirDetalhe({ ...sel, ...payload } as Notificacao, tabDet);
  };
  const excluir = async (n: Notificacao) => {
    if (!confirm(`Excluir ${n.protocolo} e tudo o que está nela (defesas, documentos, histórico)? Não dá para desfazer.`)) return;
    const { data: arqs } = await db.from("JUR_NOTIFICACAO_ANEXOS").select("storage_path").eq("notificacao_id", n.id);
    const paths = (arqs ?? []).map((a: { storage_path: string }) => a.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await db.from("JUR_NOTIFICACOES").delete().eq("id", n.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    toast(`${n.protocolo} excluída.`, "ok"); setSel(null); setModal(false); carregar();
  };

  // ── Detalhe ─────────────────────────────────────────────────────
  const abrirDetalhe = async (n: Notificacao, tab: typeof tabDet = "resumo") => {
    setSel(n); setTabDet(tab); setDefForm(null); setNovoComent("");
    const [d, a, h, c] = await Promise.all([
      db.from("JUR_NOTIFICACAO_DEFESAS").select("*").eq("notificacao_id", n.id).order("id"),
      db.from("JUR_NOTIFICACAO_ANEXOS").select("*").eq("notificacao_id", n.id).order("created_at", { ascending: false }),
      db.from("JUR_NOTIFICACAO_HISTORICO").select("*").eq("notificacao_id", n.id).order("created_at", { ascending: false }),
      db.from("SISTEMA_COMENTARIOS").select("*").eq("modulo", "notificacao").eq("entidade_id", String(n.id)).order("created_at", { ascending: false }),
    ]);
    setDefesas((d.data ?? []) as Defesa[]); setAnexos((a.data ?? []) as Anexo[]); setHist((h.data ?? []) as Hist[]); setComents((c.data ?? []) as Comentario[]);
  };
  const recarregarDetalhe = async () => { await carregar(); if (sel) { const { data } = await db.from("JUR_NOTIFICACOES").select("*").eq("id", sel.id).single(); if (data) abrirDetalhe(data as Notificacao, tabDet); } };

  // Mudança rápida de etapa pelo detalhe (o resto é pelo Editar).
  const mudarEtapa = async (etapa: string) => {
    if (!sel) return;
    if (etapa === "Encerrada" && !sel.resultado) { toast("Para encerrar, abra o Editar e informe o resultado.", "err"); abrirEditar(sel); setForm(f => ({ ...f, etapa: "Encerrada" })); return; }
    const { error } = await db.from("JUR_NOTIFICACOES").update({ etapa }).eq("id", sel.id);
    if (error) { toast(error.message, "err"); return; }
    toast(`Etapa: ${etapa}.`, "ok"); recarregarDetalhe();
  };

  const salvarDefesa = async () => {
    if (!sel || !defForm) return;
    const t = (v: string) => (String(v ?? "").trim() || null);
    const payload = {
      notificacao_id: sel.id, instancia: defForm.instancia, prazo: t(defForm.prazo), data_protocolo: t(defForm.data_protocolo),
      numero_protocolo: t(defForm.numero_protocolo), argumentos: t(defForm.argumentos), resultado: defForm.resultado,
      data_resultado: t(defForm.data_resultado), valor_apos: numOuNull(defForm.valor_apos), responsavel_nome: t(defForm.responsavel_nome), observacao: t(defForm.observacao),
      ...(defEditId ? {} : { criado_por_nome: autor }),
    };
    const { error } = defEditId
      ? await db.from("JUR_NOTIFICACAO_DEFESAS").update(payload).eq("id", defEditId)
      : await db.from("JUR_NOTIFICACAO_DEFESAS").insert(payload);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    // A etapa acompanha a peça: protocolou a defesa prévia → "Defesa protocolada";
    // protocolou recurso → "Em recurso". Só avança, nunca volta sozinha.
    const ordem = (e: string) => ETAPAS.indexOf(e as (typeof ETAPAS)[number]);
    const alvo = defForm.data_protocolo ? (defForm.instancia.startsWith("Recurso") ? "Em recurso" : "Defesa protocolada") : "Defesa em elaboração";
    const extras: Record<string, unknown> = {};
    if (!encerrada(sel) && ordem(alvo) > ordem(sel.etapa)) extras.etapa = alvo;
    if (defForm.resultado !== "Aguardando" && payload.valor_apos != null) extras.valor_final = payload.valor_apos;
    if (Object.keys(extras).length) await db.from("JUR_NOTIFICACOES").update(extras).eq("id", sel.id);
    toast(defEditId ? "Defesa atualizada." : `${defForm.instancia} lançada.`, "ok");
    setDefForm(null); setDefEditId(null); recarregarDetalhe();
  };
  const excluirDefesa = async (d: Defesa) => {
    if (!confirm(`Excluir ${d.instancia}?`)) return;
    const { error } = await db.from("JUR_NOTIFICACAO_DEFESAS").delete().eq("id", d.id);
    if (error) { toast(error.message, "err"); return; }
    recarregarDetalhe();
  };

  const enviarArquivos = async (notifId: number, files: File[], categoria: string) => {
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`"${f.name}" passa de 25 MB.`, "err"); continue; }
      const path = `${notifId}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage.from(BUCKET).upload(path, f);
      if (up.error) { toast(`Não subiu "${f.name}": ${up.error.message}`, "err"); continue; }
      const { error } = await db.from("JUR_NOTIFICACAO_ANEXOS").insert({ notificacao_id: notifId, categoria, nome: f.name, storage_path: path, tamanho: f.size, tipo: f.type || null, enviado_por: autor });
      if (error) { await supabase.storage.from(BUCKET).remove([path]); toast(`Erro ao registrar "${f.name}": ${error.message}`, "err"); }
    }
  };
  const anexarNoDetalhe = async (files: FileList | null) => {
    if (!sel || !files?.length) return;
    await enviarArquivos(sel.id, Array.from(files), catAnexo);
    if (fileRef.current) fileRef.current.value = "";
    toast("Documento(s) anexado(s).", "ok"); recarregarDetalhe();
  };
  const abrirAnexo = async (a: Anexo) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) { toast("Não abriu o arquivo: " + (error?.message ?? ""), "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const removerAnexo = async (a: Anexo) => {
    if (!confirm(`Remover "${a.nome}"?`)) return;
    await supabase.storage.from(BUCKET).remove([a.storage_path]);
    const { error } = await db.from("JUR_NOTIFICACAO_ANEXOS").delete().eq("id", a.id);
    if (error) { toast(error.message, "err"); return; }
    recarregarDetalhe();
  };
  const comentar = async () => {
    if (!sel || !novoComent.trim()) return;
    const { error } = await db.from("SISTEMA_COMENTARIOS").insert({ modulo: "notificacao", entidade_id: String(sel.id), autor_nome: autor, texto: novoComent.trim() });
    if (error) { toast("Erro ao comentar: " + error.message, "err"); return; }
    setNovoComent(""); recarregarDetalhe();
  };

  // ── UI ──────────────────────────────────────────────────────────
  const kpi = (rotulo: string, valor: string | number, cor: string, sub?: string) => (
    <div className="jn-kpi"><div className="jn-kpi-r">{rotulo}</div><div className="jn-kpi-v" style={{ color: cor }}>{valor}</div>{sub && <div className="jn-kpi-s">{sub}</div>}</div>
  );
  const campo = (rotulo: string, el: React.ReactNode, largo = false) => (
    <div className="jn-fg" style={largo ? { gridColumn: "1/-1" } : undefined}><label>{rotulo}</label>{el}</div>
  );
  const inp = (k: keyof Form, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="jn-fi" value={String(form[k] ?? "")} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} {...extra} />
  );
  const sel_ = (k: keyof Form, opcoes: readonly string[], vazio?: string) => (
    <select className="jn-fi" value={String(form[k] ?? "")} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}>
      {vazio != null && <option value="">{vazio}</option>}
      {opcoes.map(o => <option key={o}>{o}</option>)}
    </select>
  );
  const txtArea = (k: keyof Form, rows = 3, ph = "") => (
    <textarea className="jn-fi" rows={rows} placeholder={ph} value={String(form[k] ?? "")} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
  );
  const prazoSelo = (n: Notificacao) => { const p = situacaoPrazo(n, H); return <Selo texto={p.rotulo} cor={COR_PRAZO[p.nivel]} />; };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .jn-hero{position:relative;overflow:hidden;border-radius:22px;padding:24px 28px 20px;margin:18px 24px 0;background:linear-gradient(135deg,#0f3171 0%,#1d4ed8 60%,#2563eb 100%);color:#fff;box-shadow:0 22px 50px rgba(15,49,113,.25)}
        .jn-hero-in{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
        .jn-hero h1{margin:4px 0 6px;font-size:26px;font-weight:900;letter-spacing:-.3px}
        .jn-hero p{margin:0;font-size:13.5px;opacity:.9;max-width:760px;line-height:1.5}
        .jn-eyebrow{font-size:11.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:.8}
        .jn-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
        .jn-pills span{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700}
        .jn-btn{border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:12.5px;padding:8px 14px;font-family:inherit}
        .jn-hero .jn-btn{padding:11px 18px;font-size:13px;border-radius:12px}
        .jn-tabs{display:flex;gap:4px;margin:16px 24px 0}
        .jn-tab{border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:800;color:#475569;cursor:pointer}
        .jn-tab.on{background:#0f3171;color:#fff;border-color:#0f3171}
        .jn-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
        .jn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}
        .jn-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px}
        .jn-kpi-r{font-size:10.5px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.4px}
        .jn-kpi-v{font-size:21px;font-weight:900;margin-top:2px}
        .jn-kpi-s{font-size:11.5px;color:#94a3b8;margin-top:2px}
        .jn-fi{width:100%;min-height:38px;border:1px solid #cbd5e1;border-radius:9px;padding:7px 10px;font-size:13px;background:#fff;box-sizing:border-box;font-family:inherit;color:#0f172a}
        textarea.jn-fi{resize:vertical}
        .jn-fi:focus{outline:none;border-color:#0f3171;box-shadow:0 0 0 3px rgba(15,49,113,.1)}
        .jn-fg label{display:block;font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
        .jn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
        .jn-sec{font-size:12px;font-weight:900;color:#0f3171;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;padding-top:12px;border-top:1px dashed #e2e8f0}
        .jn-tab-l{width:100%;border-collapse:collapse;font-size:12.5px}
        .jn-tab-l th{background:#f8fafc;text-align:left;padding:9px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:#64748b;white-space:nowrap;border-bottom:1px solid #e2e8f0}
        .jn-tab-l td{padding:9px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
        .jn-tab-l tbody tr{cursor:pointer}
        .jn-tab-l tbody tr:hover td{background:#f8fbff}
        .jn-ov{position:fixed;inset:0;z-index:900;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
        .jn-modal{background:#fff;border-radius:16px;padding:22px;width:100%;max-width:860px;max-height:94vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.18)}
        .jn-drw-ov{position:fixed;inset:0;z-index:850;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;justify-content:flex-end}
        .jn-drw{width:94%;max-width:920px;height:100%;background:#f8fafc;display:flex;flex-direction:column;box-shadow:-20px 0 50px rgba(15,23,42,.18)}
        .jn-dtab{padding:10px 14px;border:none;background:none;font-size:13px;font-weight:800;color:#64748b;cursor:pointer;border-bottom:2px solid transparent}
        .jn-dtab.on{color:#0f3171;border-bottom-color:#0f3171}
        .jn-dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 16px}
        .jn-dl dt{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.3px}
        .jn-dl dd{margin:2px 0 0;font-size:13px;font-weight:600;color:#0f172a;white-space:pre-wrap;word-break:break-word}
      `}</style>

      <div className="jn-hero">
        <div className="jn-hero-in">
          <div>
            <div className="jn-eyebrow">Jurídico · Controle de Notificações</div>
            <h1>⚠️ Multas, glosas e notificações</h1>
            <p>Cada ocorrência do recebimento ao encerramento: prazo de defesa, defesas e recursos, valores (aplicado, revertido, descontado), documentos, medida preventiva e o histórico de tudo o que mudou.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="jn-btn" onClick={() => setExportando({ id: null })} style={{ background: "rgba(255,255,255,.14)", color: "#fff", border: "1px solid rgba(255,255,255,.35)" }}>⬇ Exportar dados</button>
            {podeIncluir && <button className="jn-btn" onClick={abrirNovo} style={{ background: "#fff", color: "#0f3171", boxShadow: "0 12px 28px rgba(0,0,0,.18)" }}>+ Nova ocorrência</button>}
          </div>
        </div>
        <div className="jn-pills">
          <span>📂 <b>{indGeral.abertas}</b> em aberto</span>
          <span style={indGeral.vencidas ? { background: "rgba(220,38,38,.35)" } : undefined}>⏰ <b>{indGeral.vencidas}</b> com prazo vencido</span>
          <span>📅 <b>{indGeral.vencendo7}</b> vencem em 7 dias</span>
          <span>💰 <b>{moneyCurto(indGeral.valorVigente)}</b> em jogo</span>
          <span>🛡️ <b>{moneyCurto(indGeral.valorEvitado)}</b> evitados pela defesa</span>
        </div>
      </div>

      <div className="jn-tabs">
        <button className={`jn-tab${aba === "lista" ? " on" : ""}`} onClick={() => setAba("lista")}>📋 Ocorrências</button>
        <button className={`jn-tab${aba === "painel" ? " on" : ""}`} onClick={() => setAba("painel")}>📊 Painel</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 24px 28px" }}>
        {/* Filtros valem para as duas abas: o painel mostra o recorte. */}
        <div className="jn-card" style={{ marginBottom: 14 }}>
          <div className="jn-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div className="jn-fg" style={{ gridColumn: "span 2" }}><label>Buscar</label><input className="jn-fi" placeholder="Protocolo, assunto, órgão, contrato, nº do documento, responsável…" value={busca} onChange={e => setBusca(e.target.value)} /></div>
            <div className="jn-fg"><label>Tipo</label><select className="jn-fi" value={fTipo} onChange={e => setFTipo(e.target.value)}><option value="">Todos</option>{TIPOS.map(t => <option key={t}>{t}</option>)}</select></div>
            <div className="jn-fg"><label>Etapa</label><select className="jn-fi" value={fEtapa} onChange={e => setFEtapa(e.target.value)}><option value="abertas">Em aberto</option><option value="">Todas (inclui encerradas)</option>{ETAPAS.map(t => <option key={t}>{t}</option>)}</select></div>
            <div className="jn-fg"><label>Prazo</label><select className="jn-fi" value={fPrazo} onChange={e => setFPrazo(e.target.value)}><option value="">Qualquer</option><option value="vencido">Vencido</option><option value="7dias">Vence em até 7 dias</option></select></div>
            <div className="jn-fg"><label>Contrato</label><select className="jn-fi" value={fContrato} onChange={e => setFContrato(e.target.value)}><option value="">Todos</option>{contratosUsados.map(c => <option key={c}>{c}</option>)}</select></div>
            <div className="jn-fg"><label>Setor responsável</label><select className="jn-fi" value={fSetor} onChange={e => setFSetor(e.target.value)}><option value="">Todos</option>{SETORES.map(s => <option key={s}>{s}</option>)}</select></div>
            <div className="jn-fg"><label>Recebida de</label><input className="jn-fi" type="date" value={fDe} onChange={e => setFDe(e.target.value)} /></div>
            <div className="jn-fg"><label>até</label><input className="jn-fi" type="date" value={fAte} onChange={e => setFAte(e.target.value)} /></div>
          </div>
          {filtrosAtivos > 0 && <div style={{ marginTop: 8, textAlign: "right" }}><button className="jn-btn" onClick={limpar} style={{ background: "#f1f5f9", color: "#475569" }}>Limpar filtros</button></div>}
        </div>

        {erro && <div className="jn-card" style={{ color: "#b91c1c", marginBottom: 14 }}>Não carregou: {erro}</div>}

        {aba === "painel" ? (<>
          <div className="jn-kpis">
            {kpi("Ocorrências no recorte", ind.total, "#0f3171", `${ind.abertas} em aberto · ${ind.encerradas} encerradas`)}
            {kpi("Prazo vencido", ind.vencidas, ind.vencidas ? "#dc2626" : "#16a34a", "defesa não protocolada")}
            {kpi("Vencem em 7 dias", ind.vencendo7, ind.vencendo7 ? "#ea580c" : "#16a34a")}
            {kpi("Sem responsável", ind.semResponsavel, ind.semResponsavel ? "#ea580c" : "#16a34a", "em aberto")}
            {kpi("Valor aplicado", money(ind.valorAplicado), "#0f172a", "soma dos valores originais")}
            {kpi("Valor vigente", money(ind.valorVigente), "#dc2626", "o que ainda vale depois das defesas")}
            {kpi("Evitado pela defesa", money(ind.valorEvitado), "#15803d", "original − vigente")}
            {kpi("Descontado / pago", money(ind.valorDescontado), "#7c3aed")}
            {kpi("Êxito das defesas", ind.taxaExito == null ? "—" : `${ind.taxaExito}%`, "#2563eb", "revertidas no todo ou em parte")}
            {kpi("Medidas preventivas pendentes", ind.medidasPendentes, ind.medidasPendentes ? "#ea580c" : "#16a34a")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 14 }}>
            <div className="jn-card">
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Por tipo</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={ind.porTipo} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, k: string) => (k === "valor" ? money(v) : v)} />
                  <Bar dataKey="qtd" name="Ocorrências">{ind.porTipo.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="jn-card">
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Recebidas por mês (últimos 12)</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={ind.porMes}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="mes" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} />
                  <Tooltip formatter={(v: number, k: string) => (k === "valor" ? money(v) : v)} />
                  <Bar dataKey="qtd" name="Ocorrências" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="jn-card">
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Onde está o trabalho (etapa)</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={ind.porEtapa}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="nome" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={60} /><YAxis allowDecimals={false} />
                  <Tooltip /><Bar dataKey="qtd" name="Ocorrências" radius={[6, 6, 0, 0]}>{ind.porEtapa.map(e => <Cell key={e.nome} fill={COR_ETAPA[e.nome]?.fg ?? "#64748b"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="jn-card">
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Contratos com mais valor aplicado</div>
              {ind.porContrato.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Sem dados.</div> : (
                <table className="jn-tab-l"><thead><tr><th>Contrato</th><th style={{ textAlign: "right" }}>Qtd</th><th style={{ textAlign: "right" }}>Valor</th></tr></thead>
                  <tbody>{ind.porContrato.map(c => (
                    <tr key={c.nome} onClick={() => { setFContrato(c.nome === "Não informado" ? "" : c.nome); setAba("lista"); }}>
                      <td>{c.nome}</td><td style={{ textAlign: "right" }}>{c.qtd}</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(c.valor)}</td></tr>))}</tbody></table>
              )}
            </div>
          </div>
        </>) : (
          <div className="jn-card" style={{ padding: 0, overflow: "hidden" }}>
            {carregando ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
              : filtrada.length === 0 ? (
                <div style={{ padding: 46, textAlign: "center", color: "#94a3b8" }}>
                  {lista.length === 0 ? <>Nenhuma ocorrência registrada ainda.{podeIncluir && <> Clique em <b>+ Nova ocorrência</b>.</>}</> : "Nada bate com os filtros."}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="jn-tab-l">
                    <thead><tr><th>Protocolo</th><th>Tipo</th><th>Assunto / contrato</th><th>Recebida</th><th>Prazo de defesa</th><th>Etapa</th><th style={{ textAlign: "right" }}>Valor original</th><th style={{ textAlign: "right" }}>Vigente</th><th>Responsável</th></tr></thead>
                    <tbody>
                      {filtrada.map(n => (
                        <tr key={n.id} onClick={() => abrirDetalhe(n)}>
                          <td style={{ fontWeight: 800, color: "#0f3171", whiteSpace: "nowrap" }}>{n.protocolo}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{n.tipo}</td>
                          <td style={{ minWidth: 240 }}><div style={{ fontWeight: 700 }}>{n.assunto}</div><div style={{ fontSize: 11.5, color: "#64748b" }}>{[n.contrato, n.orgao].filter(Boolean).join(" · ") || "—"}</div></td>
                          <td style={{ whiteSpace: "nowrap" }}>{fmtDt(n.data_recebimento)}</td>
                          <td style={{ whiteSpace: "nowrap" }}><div>{fmtDt(n.prazo_defesa)}</div>{prazoSelo(n)}</td>
                          <td><Selo texto={n.etapa} cor={COR_ETAPA[n.etapa]} />{n.resultado && <div style={{ marginTop: 3 }}><Selo texto={n.resultado} cor={COR_RESULTADO[n.resultado]} /></div>}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(n.valor_original)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800 }}>{n.valor_original == null && n.valor_final == null ? "—" : money(valorVigente(n))}</td>
                          <td style={{ fontSize: 12 }}>{n.responsavel_nome || <span style={{ color: "#ea580c", fontWeight: 700 }}>sem responsável</span>}<div style={{ color: "#94a3b8" }}>{n.setor_responsavel}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: "10px 14px", fontSize: 12, color: "#64748b", borderTop: "1px solid #f1f5f9" }}>
                    {filtrada.length} ocorrência(s) · valor original {money(ind.valorAplicado)} · vigente {money(ind.valorVigente)}
                  </div>
                </div>
              )}
          </div>
        )}
      </div>

      {/* ── Cadastro / edição ── */}
      {modal && createPortal(
        <div className="jn-ov">
          <div className="jn-modal">
            <button onClick={() => setModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 2 }}>{editId ? `Editar ${form && lista.find(x => x.id === editId)?.protocolo}` : "Nova ocorrência"}</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 6 }}>O protocolo (NOT-AAAA-NNNNN) é gerado sozinho. Toda alteração fica no histórico, com quem e quando.</div>

            <div className="jn-sec" style={{ borderTop: "none", marginTop: 6, paddingTop: 0 }}>Identificação</div>
            <div className="jn-grid">
              {campo("Tipo *", sel_("tipo", TIPOS))}
              {campo("Nº do documento (auto, ofício…)", inp("numero_documento"))}
              {campo("Assunto *", inp("assunto", { placeholder: "Ex.: Falta de posto no turno da noite" }), true)}
              {campo("Órgão / contratante que aplicou", inp("orgao", { placeholder: "Ex.: Prefeitura de Porto Alegre — SMS" }))}
              {campo("Contrato", <><input className="jn-fi" list="jn-contratos" value={form.contrato} onChange={e => setForm(f => ({ ...f, contrato: e.target.value }))} placeholder="Digite para buscar" /><datalist id="jn-contratos">{contratos.map(c => <option key={c} value={c} />)}</datalist></>)}
              {campo("Local / posto", inp("local_posto"))}
            </div>

            <div className="jn-sec">Datas e prazo</div>
            <div className="jn-grid">
              {campo("Data do fato", inp("data_ocorrencia", { type: "date" }))}
              {campo("Recebida em *", inp("data_recebimento", { type: "date" }))}
              {campo("Prazo para defesa", inp("prazo_defesa", { type: "date" }))}
            </div>

            <div className="jn-sec">Conteúdo</div>
            <div className="jn-grid">
              {campo("Descrição do apontamento", txtArea("descricao", 3, "O que foi apontado, como chegou, o que o órgão pede"), true)}
              {campo("Fundamentação (cláusula / base legal citada)", txtArea("fundamentacao", 2), true)}
            </div>

            <div className="jn-sec">Valores</div>
            <div className="jn-grid">
              {campo("Valor original (R$)", inp("valor_original", { inputMode: "decimal", placeholder: "0,00" }))}
              {campo("Valor final após defesa (R$)", inp("valor_final", { inputMode: "decimal", placeholder: "em branco = ainda não decidido" }))}
              {campo("Valor descontado / pago (R$)", inp("valor_descontado", { inputMode: "decimal", placeholder: "0,00" }))}
            </div>

            <div className="jn-sec">Andamento e responsáveis</div>
            <div className="jn-grid">
              {campo("Etapa", sel_("etapa", ETAPAS))}
              {campo("Resultado", sel_("resultado", RESULTADOS, "— ainda sem decisão —"))}
              {campo("Desfecho financeiro", sel_("desfecho_financeiro", DESFECHOS, "—"))}
              {campo("Data do desfecho", inp("data_desfecho", { type: "date" }))}
              {campo("Setor responsável", sel_("setor_responsavel", SETORES, "—"))}
              {campo("Responsável", <><input className="jn-fi" list="jn-pessoas" value={form.responsavel_nome} onChange={e => setForm(f => ({ ...f, responsavel_nome: e.target.value }))} /><datalist id="jn-pessoas">{pessoas.map(p => <option key={p} value={p} />)}</datalist></>)}
            </div>

            <div className="jn-sec">Medida preventiva</div>
            <div className="jn-grid">
              {campo("Causa raiz", txtArea("causa_raiz", 2, "Por que aconteceu"), true)}
              {campo("Medida preventiva", txtArea("medida_preventiva", 2, "O que vai ser feito para não se repetir"), true)}
              {campo("Responsável pela medida", <input className="jn-fi" list="jn-pessoas" value={form.medida_responsavel} onChange={e => setForm(f => ({ ...f, medida_responsavel: e.target.value }))} />)}
              {campo("Prazo da medida", inp("medida_prazo", { type: "date" }))}
              {campo("Medida concluída?", <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, textTransform: "none", minHeight: 38 }}><input type="checkbox" checked={!!form.medida_concluida} onChange={e => setForm(f => ({ ...f, medida_concluida: e.target.checked }))} /> Sim, já foi implantada</label>)}
            </div>
            {campo("Observações", txtArea("observacoes", 2), true)}

            {!editId && (<>
              <div className="jn-sec">Documento recebido</div>
              <input type="file" multiple onChange={e => setArquivosNovos(Array.from(e.target.files ?? []))} />
              {arquivosNovos.length > 0 && <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{arquivosNovos.map(f => f.name).join(", ")} — vão como “Notificação recebida”.</div>}
            </>)}

            {avisoForm && <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, fontWeight: 700 }}>{avisoForm}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
              <div>{editId && podeExcluir && <button className="jn-btn" onClick={() => { const n = lista.find(x => x.id === editId); if (n) excluir(n); }} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Excluir ocorrência</button>}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="jn-btn" onClick={() => setModal(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
                <button className="jn-btn" onClick={salvar} disabled={salvando} style={{ background: "#0f3171", color: "#fff", opacity: salvando ? 0.7 : 1 }}>{salvando ? "Salvando…" : editId ? "Salvar alterações" : "Registrar ocorrência"}</button>
              </div>
            </div>
          </div>
        </div>, document.body)}

      {/* ── Detalhe ── */}
      {sel && createPortal(
        <div className="jn-drw-ov" onClick={e => { if (e.target === e.currentTarget) setSel(null); }}>
          <div className="jn-drw">
            <div style={{ padding: "16px 22px", borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{sel.protocolo} · {sel.tipo}{sel.numero_documento ? ` · ${sel.numero_documento}` : ""}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>{sel.assunto}</div>
                  <div style={{ fontSize: 12.5, color: "#475569" }}>{[sel.contrato, sel.orgao].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="jn-btn" onClick={() => setExportando({ id: sel.id })} style={{ background: "#fff", color: "#0f3171", border: "1px solid #dbe4f0" }}>⬇ Exportar</button>
                  {podeAlterar && <button className="jn-btn" onClick={() => abrirEditar(sel)} style={{ background: "#eef4ff", color: "#0f3171", border: "1px solid #dbe4f0" }}>Editar</button>}
                  <button onClick={() => setSel(null)} style={{ border: "none", background: "none", fontSize: 22, color: "#94a3b8", cursor: "pointer" }}>✕</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                <Selo texto={sel.etapa} cor={COR_ETAPA[sel.etapa]} />
                {sel.resultado && <Selo texto={sel.resultado} cor={COR_RESULTADO[sel.resultado]} />}
                {prazoSelo(sel)}
                {sel.desfecho_financeiro && <Selo texto={sel.desfecho_financeiro} />}
                {podeAlterar && !encerrada(sel) && (
                  <select className="jn-fi" style={{ width: "auto", minHeight: 30, padding: "3px 8px", fontSize: 12, marginLeft: "auto" }} value="" onChange={e => e.target.value && mudarEtapa(e.target.value)}>
                    <option value="">Mover para etapa…</option>
                    {ETAPAS.filter(e => e !== sel.etapa).map(e => <option key={e}>{e}</option>)}
                  </select>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {[["Valor original", money(sel.valor_original), "#0f172a"], ["Vigente", money(valorVigente(sel)), "#dc2626"], ["Evitado pela defesa", money(valorEvitado(sel)), "#15803d"], ["Descontado / pago", money(sel.valor_descontado), "#7c3aed"]].map(([r, v, c]) => (
                  <div key={r} style={{ flex: 1, minWidth: 140, background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "7px 11px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>{r}</div><div style={{ fontSize: 14.5, fontWeight: 900, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 2, padding: "0 16px", borderBottom: "1px solid #e2e8f0", background: "#fff", flexWrap: "wrap" }}>
              {([["resumo", "Resumo"], ["defesas", `Defesas e recursos (${defesas.length})`], ["documentos", `Documentos (${anexos.length})`], ["historico", `Histórico (${hist.length})`], ["comentarios", `Comentários (${coments.length})`]] as const).map(([k, l]) => (
                <button key={k} className={`jn-dtab${tabDet === k ? " on" : ""}`} onClick={() => setTabDet(k)}>{l}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {tabDet === "resumo" && (
                <div style={{ display: "grid", gap: 14 }}>
                  <div className="jn-card"><dl className="jn-dl">
                    {[["Recebida em", fmtDt(sel.data_recebimento)], ["Data do fato", fmtDt(sel.data_ocorrencia)], ["Prazo de defesa", fmtDt(sel.prazo_defesa)], ["Local / posto", sel.local_posto],
                      ["Setor responsável", sel.setor_responsavel], ["Responsável", sel.responsavel_nome], ["Data do desfecho", fmtDt(sel.data_desfecho)], ["Registrada por", `${sel.criado_por_nome ?? "—"} em ${fmtDtHr(sel.created_at)}`]]
                      .map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v || "—"}</dd></div>)}
                  </dl></div>
                  {(sel.descricao || sel.fundamentacao || sel.observacoes) && <div className="jn-card"><dl className="jn-dl" style={{ gridTemplateColumns: "1fr" }}>
                    {[["Descrição", sel.descricao], ["Fundamentação", sel.fundamentacao], ["Observações", sel.observacoes]].filter(([, v]) => v).map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v}</dd></div>)}
                  </dl></div>}
                  <div className="jn-card" style={{ borderColor: sel.medida_preventiva && !sel.medida_concluida ? "#fed7aa" : undefined }}>
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>🛠️ Medida preventiva {sel.medida_preventiva && <Selo texto={sel.medida_concluida ? "Concluída" : "Pendente"} cor={sel.medida_concluida ? COR_RESULTADO.Revertida : { bg: "#ffedd5", fg: "#c2410c" }} />}</div>
                    {sel.medida_preventiva || sel.causa_raiz ? <dl className="jn-dl">
                      {[["Causa raiz", sel.causa_raiz], ["Medida", sel.medida_preventiva], ["Responsável", sel.medida_responsavel], ["Prazo", fmtDt(sel.medida_prazo)]].map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v || "—"}</dd></div>)}
                    </dl> : <div style={{ fontSize: 13, color: "#94a3b8" }}>Nenhuma medida registrada. {podeAlterar && "Use Editar para registrar causa raiz e medida."}</div>}
                  </div>
                </div>
              )}

              {tabDet === "defesas" && (
                <div style={{ display: "grid", gap: 10 }}>
                  {podeAlterar && !defForm && <div><button className="jn-btn" onClick={() => { setDefEditId(null); setDefForm({ ...DEFESA_VAZIA, instancia: defesas.length ? "Recurso" : "Defesa prévia", prazo: defesas.length ? "" : (sel.prazo_defesa ?? "") }); }} style={{ background: "#0f3171", color: "#fff" }}>+ Lançar defesa / recurso</button></div>}
                  {defForm && (
                    <div className="jn-card" style={{ borderColor: "#c7d7f5" }}>
                      <div className="jn-grid">
                        <div className="jn-fg"><label>Instância</label><select className="jn-fi" value={defForm.instancia} onChange={e => setDefForm(f => f && ({ ...f, instancia: e.target.value }))}>{INSTANCIAS.map(i => <option key={i}>{i}</option>)}</select></div>
                        <div className="jn-fg"><label>Prazo</label><input className="jn-fi" type="date" value={defForm.prazo} onChange={e => setDefForm(f => f && ({ ...f, prazo: e.target.value }))} /></div>
                        <div className="jn-fg"><label>Protocolada em</label><input className="jn-fi" type="date" value={defForm.data_protocolo} onChange={e => setDefForm(f => f && ({ ...f, data_protocolo: e.target.value }))} /></div>
                        <div className="jn-fg"><label>Nº do protocolo</label><input className="jn-fi" value={defForm.numero_protocolo} onChange={e => setDefForm(f => f && ({ ...f, numero_protocolo: e.target.value }))} /></div>
                        <div className="jn-fg"><label>Resultado</label><select className="jn-fi" value={defForm.resultado} onChange={e => setDefForm(f => f && ({ ...f, resultado: e.target.value }))}>{RESULTADOS_DEFESA.map(r => <option key={r}>{r}</option>)}</select></div>
                        <div className="jn-fg"><label>Decisão em</label><input className="jn-fi" type="date" value={defForm.data_resultado} onChange={e => setDefForm(f => f && ({ ...f, data_resultado: e.target.value }))} /></div>
                        <div className="jn-fg"><label>Valor após a decisão (R$)</label><input className="jn-fi" inputMode="decimal" value={defForm.valor_apos} onChange={e => setDefForm(f => f && ({ ...f, valor_apos: e.target.value }))} placeholder="atualiza o valor final" /></div>
                        <div className="jn-fg"><label>Responsável</label><input className="jn-fi" list="jn-pessoas-d" value={defForm.responsavel_nome} onChange={e => setDefForm(f => f && ({ ...f, responsavel_nome: e.target.value }))} /><datalist id="jn-pessoas-d">{pessoas.map(p => <option key={p} value={p} />)}</datalist></div>
                        <div className="jn-fg" style={{ gridColumn: "1/-1" }}><label>Argumentos da defesa</label><textarea className="jn-fi" rows={3} value={defForm.argumentos} onChange={e => setDefForm(f => f && ({ ...f, argumentos: e.target.value }))} /></div>
                        <div className="jn-fg" style={{ gridColumn: "1/-1" }}><label>Observação</label><textarea className="jn-fi" rows={2} value={defForm.observacao} onChange={e => setDefForm(f => f && ({ ...f, observacao: e.target.value }))} /></div>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#64748b", margin: "6px 0 10px" }}>Protocolar avança a etapa sozinho (defesa → “Defesa protocolada”, recurso → “Em recurso”). Decisão com valor atualiza o valor final da ocorrência.</div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="jn-btn" onClick={() => { setDefForm(null); setDefEditId(null); }} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
                        <button className="jn-btn" onClick={salvarDefesa} style={{ background: "#0f3171", color: "#fff" }}>{defEditId ? "Salvar" : "Lançar"}</button>
                      </div>
                    </div>
                  )}
                  {defesas.length === 0 && !defForm && <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhuma defesa ou recurso lançado.</div>}
                  {defesas.map(d => (
                    <div key={d.id} className="jn-card">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900 }}>{d.instancia} <Selo texto={d.resultado} cor={d.resultado === "Deferida" ? COR_RESULTADO.Revertida : d.resultado === "Parcialmente deferida" ? COR_RESULTADO["Revertida parcialmente"] : d.resultado === "Indeferida" ? COR_RESULTADO.Mantida : undefined} /></div>
                        {podeAlterar && <div style={{ display: "flex", gap: 6 }}>
                          <button className="jn-btn" onClick={() => { setDefEditId(d.id); setDefForm({ ...DEFESA_VAZIA, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? ""])), valor_apos: paraCampo(d.valor_apos) } as typeof DEFESA_VAZIA); }} style={{ background: "#eef4ff", color: "#0f3171" }}>Editar</button>
                          <button className="jn-btn" onClick={() => excluirDefesa(d)} style={{ background: "none", color: "#dc2626" }}>Excluir</button>
                        </div>}
                      </div>
                      <dl className="jn-dl" style={{ marginTop: 8 }}>
                        {[["Prazo", fmtDt(d.prazo)], ["Protocolada em", fmtDt(d.data_protocolo)], ["Nº do protocolo", d.numero_protocolo], ["Decisão em", fmtDt(d.data_resultado)], ["Valor após", d.valor_apos != null ? money(d.valor_apos) : null], ["Responsável", d.responsavel_nome]]
                          .map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v || "—"}</dd></div>)}
                        {d.argumentos && <div style={{ gridColumn: "1/-1" }}><dt>Argumentos</dt><dd>{d.argumentos}</dd></div>}
                        {d.observacao && <div style={{ gridColumn: "1/-1" }}><dt>Observação</dt><dd>{d.observacao}</dd></div>}
                      </dl>
                    </div>
                  ))}
                </div>
              )}

              {tabDet === "documentos" && (
                <div style={{ display: "grid", gap: 10 }}>
                  {podeAlterar && (
                    <div className="jn-card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select className="jn-fi" style={{ width: "auto" }} value={catAnexo} onChange={e => setCatAnexo(e.target.value)}>{CATEGORIAS_ANEXO.map(c => <option key={c}>{c}</option>)}</select>
                      <input ref={fileRef} type="file" multiple onChange={e => anexarNoDetalhe(e.target.files)} />
                      <span style={{ fontSize: 11.5, color: "#94a3b8" }}>até 25 MB por arquivo</span>
                    </div>
                  )}
                  {anexos.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhum documento.</div> : (
                    <div className="jn-card" style={{ padding: 0 }}>
                      <table className="jn-tab-l"><thead><tr><th>Categoria</th><th>Arquivo</th><th>Enviado</th><th></th></tr></thead>
                        <tbody>{anexos.map(a => (
                          <tr key={a.id} onClick={() => abrirAnexo(a)}>
                            <td><Selo texto={a.categoria} /></td><td style={{ fontWeight: 700, color: "#1d4ed8" }}>📎 {a.nome}</td>
                            <td style={{ fontSize: 12, color: "#64748b" }}>{a.enviado_por ?? "—"}<br />{fmtDtHr(a.created_at)}</td>
                            <td onClick={e => e.stopPropagation()}>{podeAlterar && <button className="jn-btn" onClick={() => removerAnexo(a)} style={{ background: "none", color: "#dc2626" }}>Remover</button>}</td>
                          </tr>))}</tbody></table>
                    </div>
                  )}
                </div>
              )}

              {tabDet === "historico" && (
                hist.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Sem histórico.</div> : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {hist.map(h => (
                      <div key={h.id} className="jn-card" style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b style={{ fontSize: 13 }}>{h.acao}</b><span style={{ fontSize: 11.5, color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtDtHr(h.created_at)} · {h.autor_nome}</span></div>
                        {h.detalhe && <div style={{ fontSize: 12.5, color: "#475569", whiteSpace: "pre-wrap", marginTop: 3 }}>{h.detalhe}</div>}
                      </div>
                    ))}
                  </div>
                )
              )}

              {tabDet === "comentarios" && (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="jn-fi" placeholder="Escreva um comentário…" value={novoComent} onChange={e => setNovoComent(e.target.value)} onKeyDown={e => { if (e.key === "Enter") comentar(); }} />
                    <button className="jn-btn" onClick={comentar} disabled={!novoComent.trim()} style={{ background: novoComent.trim() ? "#0f3171" : "#cbd5e1", color: "#fff" }}>Comentar</button>
                  </div>
                  {coments.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Sem comentários.</div> : coments.map(c => (
                    <div key={c.id} className="jn-card" style={{ padding: "10px 14px" }}>
                      <div style={{ fontSize: 11.5, color: "#94a3b8" }}><b style={{ color: "#475569" }}>{c.autor_nome}</b> · {fmtDtHr(c.created_at)}</div>
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{c.texto}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>, document.body)}

      {exportando && (
        <ModalExportarDados
          nome={{ um: "ocorrência", varios: "ocorrências" }}
          conteudo="Sai a ficha de cada ocorrência (datas, prazo, valores, andamento, medida preventiva) e as defesas e recursos, documentos, histórico e comentários."
          registros={[...lista].sort((a, b) => b.protocolo.localeCompare(a.protocolo)).map(n => ({ id: String(n.id), titulo: `${n.protocolo} · ${n.assunto}`, detalhe: n.tipo, busca: `${n.contrato ?? ""} ${n.orgao ?? ""}` }))}
          inicialId={exportando.id != null ? String(exportando.id) : null}
          onFechar={() => setExportando(null)}
          onErro={msg => toast(msg, "err")}
          onExportar={async (formato, id) => {
            const alvo = id == null ? [...lista].sort((a, b) => a.protocolo.localeCompare(b.protocolo)) : lista.filter(n => String(n.id) === id);
            if (!alvo.length) throw new Error("nenhuma ocorrência para exportar.");
            const extras = await carregarExtras(db, id == null ? null : alvo.map(n => n.id));
            const nome = nomeArquivo(alvo);
            if (formato === "excel") baixar(gerarExcel(alvo, extras, autor), `${nome}.xlsx`);
            else baixar(gerarHtml(alvo, extras, autor), `${nome}.html`);
            toast("Exportação gerada — confira os downloads.", "ok");
          }}
        />
      )}

      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (<div key={t.id} style={{ padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.12)", background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff", color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8", border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>))}
      </div>
    </div>
  );
}
