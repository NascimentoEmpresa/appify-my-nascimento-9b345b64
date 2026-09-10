import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import arcoNascimento from "@/assets/logo-nascimento-icon.png";
import { TrendingUp, Users, MapPin, Search, Inbox, CheckCircle2, Paperclip, Building2 } from "lucide-react";

// =====================================================================
// PORTAL PÚBLICO DE VAGAS / CANDIDATURA  (rota /vagas — sem login)
// Dois fluxos: candidatura GERAL (Banco de Talentos) e candidatura a uma VAGA.
// Tudo via RPCs SECURITY DEFINER (portal_*) + upload no bucket 'curriculos'.
// =====================================================================

interface Cidade { cidade: string; vagas: number; }
interface Vaga {
  id: number; cargo: string; contrato: string; cidade: string;
  escala: string; salario: string; beneficios: string; quantidade_vagas: number;
}

const maskCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};
const maskFone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const isValidCpf = (v: string): boolean => {
  const c = v.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += parseInt(c[i], 10) * (10 - i);
  let d1 = 11 - (s % 11); if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;
  s = 0; for (let i = 0; i < 10; i++) s += parseInt(c[i], 10) * (11 - i);
  let d2 = 11 - (s % 11); if (d2 >= 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
};
const isValidEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

const MAX_MB = 10;
const MAX_FILES = 5;
const ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";

const SEXOS = ["Masculino", "Feminino", "Outros", "Não informar"];
const ESCOLARIDADES = [
  "Analfabeto", "Alfabetizado sem escolarização formal",
  "Ensino Fundamental incompleto", "Ensino Fundamental completo",
  "Ensino Médio incompleto", "Ensino Médio completo",
  "Ensino Técnico incompleto", "Ensino Técnico completo",
  "Ensino Superior incompleto", "Ensino Superior completo",
];
const HORARIOS = ["Manhã", "Tarde", "Noite"];
const CARGOS = [
  "Servente de Limpeza", "Auxiliar de serviços gerais", "Recepcionista", "Copeira",
  "Carregador", "Supervisor Operacional", "Intérprete de Libras", "Motorista",
  "Cozinheira/Merendeira", "Telefonista", "Outro",
];

const FORM_INIT = {
  nome: "", email: "", data_nascimento: "", cpf: "", rg: "", sexo: "", nome_mae: "", nome_pai: "",
  escolaridade: "", telefone: "", disp_fim_semana: "", possui_cnh: "", experiencia_previa: "",
  estrangeiro: "", uf_residencia: "", cidade_residencia: "", uf_desejada: "", cidade_desejada: "",
  cargo_outro: "", mensagem: "",
  experiencia_1: "", experiencia_2: "", experiencia_3: "",
};

const Arco = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M16 118 A 104 104 0 0 1 224 118" stroke="#f97316" strokeWidth="22" strokeLinecap="round" />
  </svg>
);

export default function Vagas() {
  const [step, setStep] = useState<"cidade" | "vagas" | "form" | "form-geral" | "ok">("cidade");
  const [cidades, setCidades] = useState<Cidade[]>([]);
  const [loadingCid, setLoadingCid] = useState(true);
  const [cidade, setCidade] = useState("");
  const [buscaCidade, setBuscaCidade] = useState("");
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [loadingVagas, setLoadingVagas] = useState(false);
  const [vaga, setVaga] = useState<Vaga | null>(null);

  const [form, setForm] = useState({ ...FORM_INIT });
  const [disponibilidade, setDisponibilidade] = useState<string[]>([]);
  const [cargos, setCargos] = useState<string[]>([]);
  const [cvFiles, setCvFiles] = useState<File[]>([]);
  const [ctpsFiles, setCtpsFiles] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingCid(true);
      const { data, error } = await (supabase as any).rpc("portal_cidades_com_vagas");
      setLoadingCid(false);
      if (!error && Array.isArray(data)) setCidades(data as Cidade[]);
    })();
  }, []);

  const irPara = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const resetForm = () => {
    setForm({ ...FORM_INIT }); setDisponibilidade([]); setCargos([]);
    setCvFiles([]); setCtpsFiles([]); setErro(null);
  };

  const escolherCidade = useCallback(async (c: string) => {
    setCidade(c); setStep("vagas"); setLoadingVagas(true); setVagas([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const { data, error } = await (supabase as any).rpc("portal_vagas_por_cidade", { p_cidade: c });
    setLoadingVagas(false);
    if (!error && Array.isArray(data)) setVagas(data as Vaga[]);
  }, []);

  const abrirForm = (v: Vaga) => { setVaga(v); resetForm(); setStep("form"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const abrirFormGeral = () => { setVaga(null); resetForm(); setStep("form-geral"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const voltarInicio = () => { setStep("cidade"); setVaga(null); window.scrollTo({ top: 0 }); };

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) =>
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);

  const addFiles = (cur: File[], set: (f: File[]) => void, list: FileList | null) => {
    if (!list) return;
    const novos = Array.from(list).filter(f => f.size <= MAX_MB * 1024 * 1024);
    set([...cur, ...novos].slice(0, MAX_FILES));
  };

  const uploadAll = async (files: File[], folder: string) => {
    const out: { path: string; nome: string }[] = [];
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safe}`;
      const { error } = await supabase.storage.from("curriculos").upload(path, f, { upsert: false });
      if (error) throw new Error("Falha ao enviar um dos arquivos. Tente novamente.");
      out.push({ path, nome: f.name });
    }
    return out;
  };

  const enviar = async (modo: "geral" | "vaga") => {
    setErro(null);
    const f = form;
    if (!f.nome.trim()) return setErro("Informe seu nome completo.");
    if (!isValidEmail(f.email)) return setErro("Informe um e-mail válido.");
    if (!f.data_nascimento) return setErro("Informe sua data de nascimento.");
    if (!isValidCpf(f.cpf)) return setErro("CPF inválido. Confira os números digitados.");
    if (!f.rg.trim()) return setErro("Informe seu RG.");
    if (!f.sexo) return setErro("Selecione o sexo.");
    if (!f.nome_mae.trim()) return setErro("Informe o nome da mãe.");
    if (!f.nome_pai.trim()) return setErro("Informe o nome do pai.");
    if (!f.escolaridade) return setErro("Selecione a escolaridade.");
    if (f.telefone.replace(/\D/g, "").length < 10) return setErro("Informe um celular válido com DDD.");
    if (disponibilidade.length === 0) return setErro("Selecione a disponibilidade de horários.");
    if (!f.disp_fim_semana) return setErro("Informe a disponibilidade para sábados/domingos.");
    if (!f.possui_cnh) return setErro("Informe se possui CNH.");
    if (!f.experiencia_previa) return setErro("Informe se tem experiência prévia.");
    if (!f.estrangeiro) return setErro("Informe se é estrangeiro.");
    if (!f.uf_residencia || !f.cidade_residencia) return setErro("Informe a cidade onde você reside.");
    if (modo === "geral") {
      if (!f.uf_desejada || !f.cidade_desejada) return setErro("Informe a cidade onde deseja trabalhar.");
      if (cargos.length === 0) return setErro("Selecione ao menos um cargo de interesse.");
      if (ctpsFiles.length === 0) return setErro("Anexe sua CTPS Digital.");
    }

    setEnviando(true);
    try {
      const folder = modo === "vaga" && vaga ? `vaga/${vaga.id}` : `geral/${f.cpf.replace(/\D/g, "")}`;
      const curriculos = await uploadAll(cvFiles, folder + "/cv");
      const ctps = await uploadAll(ctpsFiles, folder + "/ctps");

      const cargosFinal = cargos.map(c => c === "Outro" && f.cargo_outro.trim() ? `Outro: ${f.cargo_outro.trim()}` : c);
      const payload: Record<string, any> = {
        vaga_id: modo === "vaga" && vaga ? vaga.id : null,
        nome: f.nome.trim().toUpperCase(), email: f.email, telefone: f.telefone, cpf: f.cpf, rg: f.rg,
        data_nascimento: f.data_nascimento, sexo: f.sexo, nome_mae: f.nome_mae, nome_pai: f.nome_pai,
        escolaridade: f.escolaridade, cidade_residencia: `${f.cidade_residencia}/${f.uf_residencia}`,
        estado_desejado: modo === "geral" ? f.uf_desejada : "",
        cidade_desejada: modo === "geral" ? f.cidade_desejada : "",
        cargos_interesse: modo === "geral" ? cargosFinal.join(", ") : "",
        disponibilidade_horarios: disponibilidade.join(", "),
        disp_fim_semana: f.disp_fim_semana === "Sim", possui_cnh: f.possui_cnh === "Sim",
        experiencia_previa: f.experiencia_previa === "Sim", estrangeiro: f.estrangeiro === "Sim",
        experiencia_1: f.experiencia_1, experiencia_2: f.experiencia_2, experiencia_3: f.experiencia_3,
        mensagem: f.mensagem, curriculos, ctps,
      };
      const { data, error } = await (supabase as any).rpc("portal_candidatar_v2", { p_payload: payload });
      setEnviando(false);
      if (error) return setErro(error.message || "Não foi possível registrar sua candidatura.");
      if (!data?.ok) return setErro(data?.error || "Não foi possível registrar sua candidatura.");
      setStep("ok"); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setEnviando(false); setErro(e?.message || "Erro ao enviar. Tente novamente.");
    }
  };

  const cidadesFiltradas = cidades.filter(c => norm(c.cidade).includes(norm(buscaCidade)));
  const totalVagas = cidades.reduce((s, c) => s + (c.vagas || 0), 0);
  const naLanding = step === "cidade";
  const upd = (k: string, v: string) => setForm(s => ({ ...s, [k]: v }));

  // ── Campos do formulário (compartilhado entre geral e vaga) ──────────
  const renderCampos = (modo: "geral" | "vaga") => (
    <>
      <div className="pv-fg"><label>Nome completo *</label>
        <input className="pv-fi" value={form.nome} onChange={e => upd("nome", e.target.value)} placeholder="Seu nome completo" /></div>
      <div className="pv-row">
        <div className="pv-fg"><label>E-mail *</label>
          <input className="pv-fi" type="email" value={form.email} onChange={e => upd("email", e.target.value)} placeholder="seu@email.com" /></div>
        <div className="pv-fg"><label>Data de nascimento *</label>
          <input className="pv-fi" type="date" value={form.data_nascimento} onChange={e => upd("data_nascimento", e.target.value)} /></div>
      </div>
      <div className="pv-row">
        <div className="pv-fg"><label>CPF *</label>
          <input className="pv-fi" inputMode="numeric" value={form.cpf} onChange={e => upd("cpf", maskCpf(e.target.value))} placeholder="000.000.000-00"
            style={form.cpf.replace(/\D/g, "").length === 11 && !isValidCpf(form.cpf) ? { borderColor: "#dc2626", boxShadow: "0 0 0 4px rgba(220,38,38,.12)" } : undefined} />
          {form.cpf.replace(/\D/g, "").length === 11 && !isValidCpf(form.cpf) && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 5, fontWeight: 600 }}>CPF inválido. Confira os números.</div>}</div>
        <div className="pv-fg"><label>RG *</label>
          <input className="pv-fi" value={form.rg} onChange={e => upd("rg", e.target.value)} placeholder="0000000" /></div>
      </div>
      <div className="pv-row">
        <div className="pv-fg"><label>Sexo *</label>
          <select className="pv-fi" value={form.sexo} onChange={e => upd("sexo", e.target.value)}>
            <option value="">Selecione...</option>{SEXOS.map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="pv-fg"><label>Celular (WhatsApp) *</label>
          <input className="pv-fi" inputMode="numeric" value={form.telefone} onChange={e => upd("telefone", maskFone(e.target.value))} placeholder="(51) 99999-9999" /></div>
      </div>
      <div className="pv-row">
        <div className="pv-fg"><label>Nome da mãe *</label>
          <input className="pv-fi" value={form.nome_mae} onChange={e => upd("nome_mae", e.target.value)} placeholder="Nome completo da mãe" /></div>
        <div className="pv-fg"><label>Nome do pai *</label>
          <input className="pv-fi" value={form.nome_pai} onChange={e => upd("nome_pai", e.target.value)} placeholder="Nome completo do pai" /></div>
      </div>
      <div className="pv-fg"><label>Grau de escolaridade (comprovado) *</label>
        <select className="pv-fi" value={form.escolaridade} onChange={e => upd("escolaridade", e.target.value)}>
          <option value="">Selecione...</option>{ESCOLARIDADES.map(s => <option key={s}>{s}</option>)}</select></div>

      {/* Cidade onde reside */}
      <div className="pv-row">
        <div className="pv-fg"><label>Estado onde reside *</label>
          <select className="pv-fi" value={form.uf_residencia} onChange={e => setForm(s => ({ ...s, uf_residencia: e.target.value, cidade_residencia: "" }))}>
            <option value="">UF</option>{ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} · {e.nome}</option>)}</select></div>
        <div className="pv-fg"><label>Cidade onde reside *</label>
          <select className="pv-fi" value={form.cidade_residencia} disabled={!form.uf_residencia} onChange={e => upd("cidade_residencia", e.target.value)}>
            <option value="">{form.uf_residencia ? "Selecione..." : "Selecione o estado"}</option>{municipiosDe(form.uf_residencia).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
      </div>

      {modo === "geral" && (
        <div className="pv-row">
          <div className="pv-fg"><label>Estado onde deseja trabalhar *</label>
            <select className="pv-fi" value={form.uf_desejada} onChange={e => setForm(s => ({ ...s, uf_desejada: e.target.value, cidade_desejada: "" }))}>
              <option value="">UF</option>{ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} · {e.nome}</option>)}</select></div>
          <div className="pv-fg"><label>Cidade onde deseja trabalhar *</label>
            <select className="pv-fi" value={form.cidade_desejada} disabled={!form.uf_desejada} onChange={e => upd("cidade_desejada", e.target.value)}>
              <option value="">{form.uf_desejada ? "Selecione..." : "Selecione o estado"}</option>{municipiosDe(form.uf_desejada).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
      )}

      {modo === "geral" && (
        <div className="pv-fg"><label>Cargos que você tem interesse *</label>
          <div className="pv-checks">
            {CARGOS.map(c => (
              <label key={c} className={`pv-chk${cargos.includes(c) ? " on" : ""}`}>
                <input type="checkbox" checked={cargos.includes(c)} onChange={() => toggle(cargos, setCargos, c)} />{c}
              </label>
            ))}
          </div>
          {cargos.includes("Outro") && <input className="pv-fi" style={{ marginTop: 10 }} value={form.cargo_outro} onChange={e => upd("cargo_outro", e.target.value)} placeholder="Qual outro cargo?" />}
        </div>
      )}

      <div className="pv-fg"><label>Disponibilidade de horários *</label>
        <div className="pv-checks">
          {HORARIOS.map(h => (
            <label key={h} className={`pv-chk${disponibilidade.includes(h) ? " on" : ""}`}>
              <input type="checkbox" checked={disponibilidade.includes(h)} onChange={() => toggle(disponibilidade, setDisponibilidade, h)} />{h}
            </label>
          ))}
        </div>
      </div>

      {([
        ["disp_fim_semana", "Disponibilidade para sábados e domingos?"],
        ["possui_cnh", "Possui CNH (Carteira Nacional de Habilitação)?"],
        ["experiencia_previa", "Tem experiência prévia nas funções?"],
        ["estrangeiro", "Você é estrangeiro?"],
      ] as [string, string][]).map(([k, label]) => (
        <div className="pv-fg" key={k}><label>{label} *</label>
          <div className="pv-seg">
            {["Sim", "Não"].map(opt => (
              <button type="button" key={opt} className={`pv-segbtn${(form as any)[k] === opt ? " on" : ""}`} onClick={() => upd(k, opt)}>{opt}</button>
            ))}
          </div>
        </div>
      ))}

      {/* 3 últimas experiências relevantes */}
      <div className="pv-fg"><label>3 últimas experiências relevantes para a vaga</label>
        <input className="pv-fi" style={{ marginBottom: 8 }} value={form.experiencia_1} onChange={e => upd("experiencia_1", e.target.value)} placeholder="1ª experiência (empresa · cargo · tempo)" />
        <input className="pv-fi" style={{ marginBottom: 8 }} value={form.experiencia_2} onChange={e => upd("experiencia_2", e.target.value)} placeholder="2ª experiência (opcional)" />
        <input className="pv-fi" value={form.experiencia_3} onChange={e => upd("experiencia_3", e.target.value)} placeholder="3ª experiência (opcional)" />
      </div>

      {/* Anexos */}
      <FileMulti label={`Anexe seu currículo ${modo === "geral" ? "(opcional)" : "(opcional)"} · até ${MAX_FILES} arquivos, ${MAX_MB} MB cada`}
        files={cvFiles} onAdd={l => addFiles(cvFiles, setCvFiles, l)} onRemove={i => setCvFiles(cvFiles.filter((_, j) => j !== i))} />
      <FileMulti label={`Anexe sua CTPS Digital ${modo === "geral" ? "*" : "(opcional)"} · até ${MAX_FILES} arquivos, ${MAX_MB} MB cada`}
        files={ctpsFiles} onAdd={l => addFiles(ctpsFiles, setCtpsFiles, l)} onRemove={i => setCtpsFiles(ctpsFiles.filter((_, j) => j !== i))} />

      {modo === "vaga" && (
        <div className="pv-fg"><label>Mensagem (opcional)</label>
          <textarea className="pv-fi" rows={3} value={form.mensagem} onChange={e => upd("mensagem", e.target.value)} placeholder="Conte um pouco sobre você" /></div>
      )}

      {erro && <div className="pv-err">{erro}</div>}
      <button className="pv-btn pv-btn-pri" style={{ width: "100%" }} onClick={() => enviar(modo)} disabled={enviando}>
        {enviando ? "Enviando…" : modo === "geral" ? "Cadastrar meu currículo" : "Enviar candidatura"}
      </button>
    </>
  );

  return (
    <div className="pv">
      <style>{`
        *{box-sizing:border-box}
        .pv{min-height:100vh;background:#fff;font-family:Inter,system-ui,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
        .pv-main{flex:1 0 auto}
        .pv h1,.pv h2,.pv h3{font-family:'Plus Jakarta Sans',Inter,sans-serif;letter-spacing:-.02em}
        .pv-wrap{max-width:1100px;margin:0 auto;padding:0 22px}
        .pv-nav{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-bottom:1px solid #eef2f7}
        .pv-nav-in{max-width:1100px;margin:0 auto;padding:13px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px}
        .pv-brand{display:flex;align-items:center;gap:11px;cursor:pointer}
        .pv-logo{height:42px;width:42px;border-radius:11px;background:#0f3171;display:grid;place-items:center;padding:4px;flex-shrink:0}
        .pv-logo img{height:100%;width:100%;object-fit:contain}
        .pv-brand .nm{font-weight:800;font-size:15px;line-height:1.1}
        .pv-brand .sb{font-size:10px;text-transform:uppercase;letter-spacing:.18em;color:#94a3b8}
        .pv-navcta{display:inline-flex;align-items:center;gap:7px;background:#0f3171;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer}
        .pv-navcta:hover{background:#0b2350}
        .pv-hero{position:relative;overflow:hidden}
        .pv-hero-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;padding:64px 0 56px}
        .pv-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#ea580c;background:#fff4ec;border:1px solid #ffe0cc;border-radius:30px;padding:6px 14px}
        .pv-hero h1{font-size:clamp(34px,5.2vw,58px);font-weight:800;line-height:1.04;margin:20px 0 0;color:#0b1f44}
        .pv-hero h1 .hl{color:#f97316}
        .pv-hero-sub{font-size:clamp(15px,1.7vw,19px);color:#475569;line-height:1.55;margin:18px 0 0;max-width:520px}
        .pv-hero-cta{display:flex;align-items:center;gap:12px;margin-top:30px;flex-wrap:wrap}
        .pv-btn-ghost{background:#fff;color:#0f3171;border:1.5px solid #dbe4f0;padding:13px 20px;border-radius:12px;font-weight:800;font-size:14.5px;cursor:pointer}
        .pv-btn-ghost:hover{border-color:#f97316;color:#ea580c}
        .pv-stat-inline{display:flex;align-items:center;gap:7px;font-size:14px;color:#475569;font-weight:600}
        .pv-stat-inline b{color:#0f3171;font-weight:800}
        .pv-hero-art{position:relative;border-radius:26px;background:linear-gradient(150deg,#0b2350,#0f3171 60%,#16407f);padding:34px 30px;color:#fff;overflow:hidden;box-shadow:0 30px 70px rgba(11,35,80,.3)}
        .pv-hero-art .arco{position:absolute;top:-18px;right:-20px;width:230px;opacity:.9}
        .pv-hero-art .glow{position:absolute;bottom:-90px;left:-60px;width:240px;height:240px;border-radius:50%;background:#3b82f6;filter:blur(80px);opacity:.45}
        .pv-hero-art .lbl{position:relative;font-size:12px;text-transform:uppercase;letter-spacing:.18em;color:rgba(255,255,255,.7);font-weight:700}
        .pv-hero-art .big{position:relative;font-size:56px;font-weight:800;line-height:1;margin-top:6px;font-family:'Plus Jakarta Sans',sans-serif}
        .pv-hero-art .big small{font-size:18px;font-weight:700;color:rgba(255,255,255,.8);margin-left:6px}
        .pv-hero-art .mini{position:relative;display:flex;gap:10px;margin-top:26px;flex-wrap:wrap}
        .pv-hero-art .chip{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:11px 14px;font-size:13px;font-weight:600;flex:1;min-width:120px}
        .pv-hero-art .chip span{display:block;font-size:11px;color:rgba(255,255,255,.6);font-weight:600;margin-top:2px}
        .pv-sec{padding:54px 0}
        .pv-sec.tint{background:#f7f9fc;border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7}
        .pv-sec-h{text-align:center;max-width:560px;margin:0 auto 36px}
        .pv-sec-h .kick{font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#f97316}
        .pv-sec-h h2{font-size:clamp(24px,3vw,34px);font-weight:800;margin:8px 0 0;color:#0b1f44}
        .pv-sec-h p{font-size:15px;color:#64748b;margin:10px 0 0;line-height:1.55}
        .pv-card{background:#fff;border:1px solid #e7ecf3;border-radius:22px;box-shadow:0 24px 60px rgba(15,23,42,.1);overflow:hidden;max-width:760px;margin:0 auto}
        .pv-card-hd{padding:20px 26px;border-bottom:1px solid #eef2f7;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fbfcfe}
        .pv-card-hd h2{font-size:19px;font-weight:800;margin:0}
        .pv-card-hd .crumb{font-size:12.5px;color:#94a3b8;font-weight:600;margin-top:3px}
        .pv-back{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid #e2e8f0;color:#0f3171;font-size:12.5px;font-weight:700;cursor:pointer;padding:8px 13px;border-radius:9px}
        .pv-back:hover{background:#f1f5f9}
        .pv-body{padding:26px}
        .pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:13px}
        .pv-tile{text-align:left;border:1px solid #e7ecf3;border-radius:15px;padding:16px 18px;background:#fff;cursor:pointer;transition:.16s;display:flex;align-items:center;gap:13px}
        .pv-tile:hover{border-color:#f97316;box-shadow:0 14px 30px rgba(249,115,22,.14);transform:translateY(-2px)}
        .pv-tile .pin{width:42px;height:42px;border-radius:12px;background:#eef4ff;display:grid;place-items:center;font-size:18px;flex-shrink:0}
        .pv-tile .city{font-size:15px;font-weight:800;color:#0f172a}
        .pv-tile .n{font-size:12.5px;color:#64748b;margin-top:2px}
        .pv-tile .arrow{margin-left:auto;color:#cbd5e1;font-size:20px;font-weight:800}
        .pv-vaga{border:1px solid #e7ecf3;border-radius:16px;padding:18px 20px;margin-bottom:14px;transition:.16s}
        .pv-vaga:hover{box-shadow:0 14px 30px rgba(15,23,42,.08);border-color:#dbe4f0}
        .pv-vaga .cargo{font-size:18px;font-weight:800;color:#0b1f44}
        .pv-vaga .meta{font-size:13px;color:#64748b;margin-top:7px;display:flex;flex-wrap:wrap;gap:6px 18px}
        .pv-vaga .meta b{color:#334155;font-weight:700}
        .pv-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
        .pv-tag{font-size:11.5px;font-weight:600;color:#0f3171;background:#eef4ff;border:1px solid #dbe4f0;border-radius:7px;padding:3px 10px}
        .pv-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:12px;font-weight:800;cursor:pointer;font-size:14.5px;transition:.16s}
        .pv-btn-pri{background:linear-gradient(135deg,#fb8c3b,#f97316);color:#fff;padding:13px 22px;box-shadow:0 14px 28px rgba(249,115,22,.3)}
        .pv-btn-pri:hover{filter:brightness(1.05);transform:translateY(-1px)}
        .pv-btn-pri:disabled{opacity:.6;cursor:not-allowed;transform:none}
        .pv-fg{margin-bottom:16px}
        .pv-fg label{display:block;font-size:12.5px;font-weight:700;color:#334155;margin-bottom:7px}
        .pv-fi{width:100%;height:46px;border:1px solid #cbd5e1;border-radius:12px;padding:0 14px;font-size:15px;background:#fff}
        select.pv-fi{appearance:auto}
        textarea.pv-fi{height:auto;padding:12px 14px;resize:vertical}
        .pv-fi:focus{outline:none;border-color:#f97316;box-shadow:0 0 0 4px rgba(249,115,22,.12)}
        .pv-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .pv-checks{display:flex;flex-wrap:wrap;gap:8px}
        .pv-chk{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;color:#334155;border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px;cursor:pointer;background:#fff}
        .pv-chk.on{border-color:#f97316;background:#fff7f1;color:#ea580c}
        .pv-chk input{accent-color:#f97316}
        .pv-seg{display:inline-flex;gap:8px}
        .pv-segbtn{flex:1;min-width:90px;border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:700;color:#475569;cursor:pointer}
        .pv-segbtn.on{border-color:#f97316;background:#fff7f1;color:#ea580c}
        .pv-file{border:1.5px dashed #cbd5e1;border-radius:14px;padding:18px;text-align:center;font-size:14px;color:#64748b;cursor:pointer;display:block;transition:.16s}
        .pv-file:hover{border-color:#f97316;background:#fff7f1}.pv-file b{color:#0f3171}
        .pv-filelist{display:flex;flex-direction:column;gap:6px;margin-top:8px}
        .pv-fileitem{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #e7ecf3;border-radius:9px;padding:7px 11px;font-size:13px;background:#fbfcfe}
        .pv-fileitem button{background:none;border:none;color:#dc2626;cursor:pointer;font-size:15px}
        .pv-search{width:100%;height:48px;border:1px solid #cbd5e1;border-radius:12px;padding:0 15px;font-size:15px;background:#fff;margin-bottom:18px}
        .pv-search:focus{outline:none;border-color:#f97316;box-shadow:0 0 0 4px rgba(249,115,22,.12)}
        .pv-err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:12px;padding:12px 15px;font-size:14px;margin-bottom:16px}
        .pv-empty{text-align:center;color:#64748b;padding:48px 20px}.pv-empty .ico{font-size:40px;margin-bottom:10px}
        .pv-ok{text-align:center;padding:58px 24px}.pv-ok .ico{font-size:60px}
        .pv-ok h2{font-size:24px;font-weight:800;margin:16px 0 8px}
        .pv-ok p{font-size:15px;color:#64748b;max-width:450px;margin:0 auto 22px;line-height:1.6}
        .pv-pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
        .pv-pillar{background:#fff;border:1px solid #e7ecf3;border-radius:18px;padding:26px 22px;box-shadow:0 10px 30px rgba(15,23,42,.05)}
        .pv-pillar .ic{width:48px;height:48px;border-radius:13px;background:#fff4ec;display:grid;place-items:center;font-size:22px}
        .pv-pillar h3{font-size:17px;font-weight:800;margin:16px 0 6px}
        .pv-pillar p{font-size:14px;color:#64748b;line-height:1.55;margin:0}
        .pv-foot{background:#0b1f44;color:#fff;margin-top:8px}
        .pv-foot-in{max-width:1100px;margin:0 auto;padding:40px 22px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
        .pv-foot .nm{font-weight:800}
        .pv-foot .cp{font-size:12.5px;color:rgba(255,255,255,.55)}
        @media(max-width:860px){.pv-hero-grid{grid-template-columns:1fr;gap:28px;padding:40px 0 36px}.pv-hero-art{order:-1}.pv-pillars{grid-template-columns:1fr}}
        @media(max-width:600px){.pv-wrap,.pv-nav-in,.pv-foot-in{padding-left:16px;padding-right:16px}.pv-sec{padding:40px 0}.pv-card-hd{padding:16px}.pv-body{padding:17px}.pv-grid{grid-template-columns:1fr;gap:10px}.pv-row{grid-template-columns:1fr}.pv-fi,.pv-search{font-size:16px}.pv-hero-art .big{font-size:46px}.pv-navcta{padding:8px 13px;font-size:12px}}
      `}</style>

      <nav className="pv-nav">
        <div className="pv-nav-in">
          <div className="pv-brand" onClick={voltarInicio}>
            <div className="pv-logo"><img src={arcoNascimento} alt="Grupo Nascimento" /></div>
            <div><div className="nm">Grupo Nascimento</div><div className="sb">Trabalhe Conosco</div></div>
          </div>
          {naLanding
            ? <button className="pv-navcta" onClick={() => irPara("vagas")}>Ver vagas →</button>
            : <button className="pv-navcta" onClick={voltarInicio}>↑ Início</button>}
        </div>
      </nav>

      <div className="pv-main">
      {naLanding && (<>
        <section className="pv-hero">
          <div className="pv-wrap pv-hero-grid">
            <div>
              <span className="pv-eyebrow"><Building2 size={13} /> Trabalhe Conosco</span>
              <h1>Seu próximo passo de carreira começa <span className="hl">aqui.</span></h1>
              <p className="pv-hero-sub">Candidate-se a uma vaga aberta na sua cidade ou faça seu cadastro geral no nosso Banco de Talentos para qualquer oportunidade futura.</p>
              <div className="pv-hero-cta">
                <button className="pv-btn pv-btn-pri" onClick={() => irPara("vagas")}>Ver vagas abertas →</button>
                <button className="pv-btn-ghost" onClick={abrirFormGeral}>Entrar ao Banco de Talentos</button>
              </div>
              {!loadingCid && totalVagas > 0 && (
                <div style={{ marginTop: 16 }}><span className="pv-stat-inline"><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} /> <b>{totalVagas}</b> vaga{totalVagas > 1 ? "s" : ""} em <b>{cidades.length}</b> cidade{cidades.length > 1 ? "s" : ""}</span></div>
              )}
            </div>
            <div className="pv-hero-art">
              <Arco className="arco" /><div className="glow" />
              <div className="lbl">Vagas abertas agora</div>
              <div className="big">{loadingCid ? "…" : totalVagas}<small>oportunidade{totalVagas !== 1 ? "s" : ""}</small></div>
              <div className="mini">
                <div className="chip">{loadingCid ? "…" : cidades.length}<span>cidades</span></div>
                <div className="chip">100%<span>online</span></div>
                <div className="chip">Banco<span>de talentos</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="pv-sec tint">
          <div className="pv-wrap">
            <div className="pv-sec-h"><div className="kick">Por que a Nascimento</div><h2>Um lugar pra crescer de verdade</h2><p>Mais do que uma vaga, um time que valoriza as pessoas no dia a dia.</p></div>
            <div className="pv-pillars">
              <div className="pv-pillar"><div className="ic"><TrendingUp size={22} color="#ea580c" /></div><h3>Crescimento</h3><p>Oportunidades reais de evolução, novos desafios e reconhecimento pelo seu trabalho.</p></div>
              <div className="pv-pillar"><div className="ic"><Users size={22} color="#ea580c" /></div><h3>Time que cuida</h3><p>Um ambiente próximo, com respeito e apoio para você fazer o seu melhor.</p></div>
              <div className="pv-pillar"><div className="ic"><MapPin size={22} color="#ea580c" /></div><h3>Perto de você</h3><p>Vagas em diversas cidades onde atuamos, trabalhe perto de casa.</p></div>
            </div>
          </div>
        </section>

        <section id="vagas" className="pv-sec">
          <div className="pv-wrap">
            <div className="pv-sec-h"><div className="kick">Vagas abertas</div><h2>Selecione a sua cidade</h2><p>Escolha a cidade para ver as vagas, ou use o <b>cadastro geral</b> acima para qualquer vaga.</p></div>
            <div className="pv-card">
              <div className="pv-body">
                {loadingCid ? (<div className="pv-empty">Carregando cidades…</div>
                ) : cidades.length === 0 ? (
                  <div className="pv-empty"><div className="ico"><Inbox size={40} color="#94a3b8" /></div>Nenhuma vaga aberta no momento. Faça seu <b>cadastro geral</b> para ser avisado de futuras oportunidades!
                    <div style={{ marginTop: 16 }}><button className="pv-btn pv-btn-pri" onClick={abrirFormGeral}>Entrar ao Banco de Talentos →</button></div></div>
                ) : (<>
                  <input className="pv-search" value={buscaCidade} onChange={e => setBuscaCidade(e.target.value)} placeholder="Buscar cidade..." inputMode="search" />
                  {cidadesFiltradas.length === 0 ? (<div className="pv-empty">Nenhuma cidade encontrada para “{buscaCidade}”.</div>
                  ) : (
                    <div className="pv-grid">
                      {cidadesFiltradas.map(c => (
                        <button key={c.cidade} className="pv-tile" onClick={() => escolherCidade(c.cidade)}>
                          <span className="pin"><MapPin size={18} color="#0f3171" /></span>
                          <span><div className="city">{c.cidade}</div><div className="n">{c.vagas} vaga{c.vagas > 1 ? "s" : ""} disponível{c.vagas > 1 ? "is" : ""}</div></span>
                          <span className="arrow">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>)}
              </div>
            </div>
          </div>
        </section>
      </>)}

      {!naLanding && (
        <section className="pv-sec">
          <div className="pv-wrap">
            <div className="pv-card">
              {step === "vagas" && (<>
                <div className="pv-card-hd">
                  <div><h2>Vagas em {cidade}</h2><div className="crumb">{vagas.length} vaga{vagas.length !== 1 ? "s" : ""} disponíve{vagas.length !== 1 ? "is" : "l"}</div></div>
                  <button className="pv-back" onClick={voltarInicio}>← trocar cidade</button>
                </div>
                <div className="pv-body">
                  {loadingVagas ? (<div className="pv-empty">Carregando vagas…</div>
                  ) : vagas.length === 0 ? (<div className="pv-empty"><div className="ico"><Search size={40} color="#94a3b8" /></div>Nenhuma vaga aberta nesta cidade agora.</div>
                  ) : vagas.map(v => (
                    <div key={v.id} className="pv-vaga">
                      <div className="cargo">{v.cargo}</div>
                      <div className="meta">
                        {v.contrato && <span><b>Contrato:</b> {v.contrato}</span>}
                        {v.escala && <span><b>Escala:</b> {v.escala}</span>}
                        {v.salario && <span><b>Salário:</b> {v.salario}</span>}
                        {v.quantidade_vagas > 1 && <span><b>Vagas:</b> {v.quantidade_vagas}</span>}
                      </div>
                      {v.beneficios && <div className="pv-tags">{v.beneficios.split(/[;,]/).map((b, i) => b.trim() && <span key={i} className="pv-tag">{b.trim()}</span>)}</div>}
                      <div style={{ marginTop: 16 }}><button className="pv-btn pv-btn-pri" onClick={() => abrirForm(v)}>Candidatar-se →</button></div>
                    </div>
                  ))}
                </div>
              </>)}

              {step === "form" && vaga && (<>
                <div className="pv-card-hd">
                  <div><h2>Candidatura · {vaga.cargo}</h2><div className="crumb">{vaga.cidade}</div></div>
                  <button className="pv-back" onClick={() => setStep("vagas")}>← voltar</button>
                </div>
                <div className="pv-body">{renderCampos("vaga")}</div>
              </>)}

              {step === "form-geral" && (<>
                <div className="pv-card-hd">
                  <div><h2>Cadastro geral · Banco de Talentos</h2><div className="crumb">Candidatura para qualquer vaga</div></div>
                  <button className="pv-back" onClick={voltarInicio}>← início</button>
                </div>
                <div className="pv-body">{renderCampos("geral")}</div>
              </>)}

              {step === "ok" && (
                <div className="pv-ok">
                  <div className="ico"><CheckCircle2 size={60} color="#16a34a" /></div>
                  <h2>Candidatura enviada!</h2>
                  <p>{vaga ? <>Recebemos sua candidatura para <b>{vaga.cargo}</b> em {vaga.cidade}.</> : <>Seu cadastro foi adicionado ao nosso <b>Banco de Talentos</b>.</>} Nossa equipe de recrutamento entrará em contato caso seu perfil seja selecionado. Boa sorte!</p>
                  <button className="pv-btn pv-btn-pri" onClick={voltarInicio}>Voltar ao início</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      </div>

      <footer className="pv-foot">
        <div className="pv-foot-in">
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div className="pv-logo" style={{ background: "rgba(255,255,255,.1)" }}><img src={arcoNascimento} alt="" /></div>
            <div className="nm">Grupo Nascimento</div>
          </div>
          <div className="cp">© {new Date().getFullYear()} Grupo Nascimento · Todos os direitos reservados</div>
        </div>
      </footer>
    </div>
  );
}

function FileMulti({ label, files, onAdd, onRemove }: { label: string; files: File[]; onAdd: (l: FileList | null) => void; onRemove: (i: number) => void }) {
  return (
    <div className="pv-fg">
      <label>{label}</label>
      {files.length < MAX_FILES && (
        <label className="pv-file">
          <input type="file" accept={ACCEPT} multiple style={{ display: "none" }} onChange={e => { onAdd(e.target.files); e.currentTarget.value = ""; }} />
          <span>Clique para <b>anexar arquivos</b> (PDF, DOC, JPG, PNG)</span>
        </label>
      )}
      {files.length > 0 && (
        <div className="pv-filelist">
          {files.map((f, i) => (
            <div key={i} className="pv-fileitem">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Paperclip size={14} color="#64748b" /> {f.name} <span style={{ color: "#94a3b8" }}>({(f.size / 1024 / 1024).toFixed(1)} MB)</span></span>
              <button type="button" onClick={() => onRemove(i)} title="Remover">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
