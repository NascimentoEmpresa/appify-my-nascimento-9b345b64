import { useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// RECRUTAMENTO › Inserir candidato MANUALMENTE (30/09/2026)
//
// "Coloca opção no recrutamento e seleção pra inserir um candidato
// MANUALMENTE, vai colocar todos os dados ali manualmente do candidato, só
// NOME COMPLETO e CPF como obrigatório." (Pablo)
//
// O candidato manual é uma linha comum em WA_CURRICULOS — a mesma tabela dos
// currículos do portal /vagas —, só que com origem = 'Manual'. Assim ele
// passa por tudo que já existe sem caminho paralelo: cruzamento de CPF com
// EMPREGADOS, lista negra do Jurídico, kanban do processo, WhatsApp e ASO.
// A gravação é direta na tabela (RLS wa_curriculos_gate: quem abre a gestão
// do Recrutamento já grava). O trigger wa_curriculos_nome_pelo_cpf troca o
// nome pelo oficial quando o CPF já está no cadastro — igual ao portal.
//
// Os campos são os mesmos que o portal pede; o currículo em arquivo é
// opcional e vai para o mesmo bucket/pasta do portal (curriculos/vaga/<id>/cv).
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const ESCOLARIDADES = [
  "Alfabetizado sem escolarização formal",
  "Ensino Fundamental incompleto", "Ensino Fundamental completo",
  "Ensino Médio incompleto", "Ensino Médio completo",
  "Ensino Técnico incompleto", "Ensino Técnico completo",
  "Ensino Superior incompleto", "Ensino Superior completo",
];
const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const digitos = (s: string) => s.replace(/\D/g, "");

/** 000.000.000-00 conforme digita. */
function mascaraCpf(v: string) {
  const d = digitos(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}
/** (00) 00000-0000 conforme digita. */
function mascaraFone(v: string) {
  const d = digitos(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
/** Dígitos verificadores do CPF (recusa também 000.000.000-00 e afins). */
export function cpfValido(v: string) {
  const d = digitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

interface Form {
  nome: string; cpf: string; telefone: string; email: string; data_nascimento: string; rg: string; pis: string;
  sexo: string; nome_mae: string; nome_pai: string; escolaridade: string; estrangeiro: boolean;
  cidade_residencia: string; estado_desejado: string; cidade_desejada: string;
  cargos_interesse: string; disponibilidade_horarios: string; disp_fim_semana: boolean; possui_cnh: boolean;
  experiencia_previa: boolean; experiencia_1: string; experiencia_2: string; experiencia_3: string; mensagem: string;
}
const VAZIO: Form = {
  nome: "", cpf: "", telefone: "", email: "", data_nascimento: "", rg: "", pis: "", sexo: "", nome_mae: "", nome_pai: "",
  escolaridade: "", estrangeiro: false, cidade_residencia: "", estado_desejado: "", cidade_desejada: "",
  cargos_interesse: "", disponibilidade_horarios: "", disp_fim_semana: false, possui_cnh: false,
  experiencia_previa: false, experiencia_1: "", experiencia_2: "", experiencia_3: "", mensagem: "",
};

const inp: CSSProperties = { width: "100%", height: 34, border: "1px solid #e2e8f0", borderRadius: 8, padding: "0 10px", fontSize: 13, outline: "none", background: "#fff", color: "#0f172a", boxSizing: "border-box" };
const lbl: CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 };

function Campo({ rotulo, obrigatorio, children, span = 1 }: { rotulo: string; obrigatorio?: boolean; children: ReactNode; span?: number }) {
  return (
    <div style={{ gridColumn: `span ${span}`, minWidth: 0 }}>
      <label style={lbl}>{rotulo}{obrigatorio && <span style={{ color: "#dc2626" }}> *</span>}</label>
      {children}
    </div>
  );
}
function Secao({ titulo }: { titulo: string }) {
  return <div style={{ gridColumn: "span 4", fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#0f3171", borderBottom: "1px solid #e2e8f0", paddingBottom: 5, marginTop: 6 }}>{titulo}</div>;
}
function Marca({ rotulo, valor, onChange }: { rotulo: string; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#0f172a", cursor: "pointer", height: 34 }}>
      <input type="checkbox" checked={valor} onChange={e => onChange(e.target.checked)} style={{ width: 15, height: 15, accentColor: "#0f3171" }} />
      {rotulo}
    </label>
  );
}

export function CandidatoManualDialog({ vagaId, cargo, autor, onFechar, onSalvo }: {
  vagaId: number; cargo?: string; autor: string;
  onFechar: () => void;
  /** `noProcesso`: já entrou no kanban (ENTRADA) — o pai registra o histórico e recarrega. */
  onSalvo: (c: { id: number; nome: string; noProcesso: boolean }) => void;
}) {
  const [f, setF] = useState<Form>(VAZIO);
  const [noProcesso, setNoProcesso] = useState(true);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }));

  const cpfOk = cpfValido(f.cpf);

  const salvar = async () => {
    setErro(null);
    const nome = f.nome.trim().replace(/\s+/g, " ");
    if (nome.split(" ").length < 2) { setErro("Informe o NOME COMPLETO (nome e sobrenome)."); return; }
    if (!cpfOk) { setErro("CPF inválido — confira os números."); return; }
    const cpfDig = digitos(f.cpf);
    setSalvando(true);
    try {
      // Mesmo CPF já nesta vaga (portal ou manual): não duplica.
      const { data: naVaga, error: e0 } = await sb.from("WA_CURRICULOS").select("id, nome, cpf, cpf_cand").eq("vaga_id", vagaId);
      if (e0) throw e0;
      const repetido = (naVaga ?? []).find((c: { cpf?: string; cpf_cand?: string }) => digitos(c.cpf ?? c.cpf_cand ?? "") === cpfDig);
      if (repetido) { setErro(`Esse CPF já tem candidatura nesta vaga (${repetido.nome || "#" + repetido.id}). Use "Selecionar dos currículos".`); return; }

      // Lista negra do Jurídico: avisa, mas quem decide é o recrutador (igual ao "Selecionar candidato").
      const { data: bl } = await sb.from("RECRUTAMENTO_CPF_BLACKLIST").select("motivo").eq("cpf_digits", cpfDig).maybeSingle();
      if (bl && !window.confirm(`Atenção: este CPF tem restrição do Jurídico.\nMotivo: ${bl.motivo || "não informado"}\n\nInserir mesmo assim?`)) return;

      let storage_path: string | null = null;
      if (arquivo) {
        const seguro = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
        const path = `vaga/${vagaId}/cv/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${seguro}`;
        const { error: eUp } = await supabase.storage.from("curriculos").upload(path, arquivo);
        if (eUp) throw new Error("Não deu para enviar o currículo: " + eUp.message);
        storage_path = path;
      }

      const txt = (s: string) => s.trim() || null;
      const agora = new Date().toISOString();
      const cpf = mascaraCpf(cpfDig);
      const { data, error } = await sb.from("WA_CURRICULOS").insert({
        vaga_id: vagaId, origem: "Manual", tipo_candidatura: "vaga",
        nome: nome.toUpperCase(), cpf, cpf_cand: cpf,
        telefone: txt(f.telefone), email: txt(f.email.toLowerCase()), data_nascimento: f.data_nascimento || null,
        rg: txt(f.rg), pis: txt(f.pis), sexo: f.sexo || null, nome_mae: txt(f.nome_mae), nome_pai: txt(f.nome_pai),
        escolaridade: f.escolaridade || null, estrangeiro: f.estrangeiro,
        cidade_residencia: txt(f.cidade_residencia), estado_desejado: f.estado_desejado || null, cidade_desejada: txt(f.cidade_desejada),
        cargos_interesse: txt(f.cargos_interesse) ?? (cargo || null), disponibilidade_horarios: txt(f.disponibilidade_horarios),
        disp_fim_semana: f.disp_fim_semana, possui_cnh: f.possui_cnh, experiencia_previa: f.experiencia_previa,
        experiencia_1: txt(f.experiencia_1), experiencia_2: txt(f.experiencia_2), experiencia_3: txt(f.experiencia_3),
        mensagem: txt(f.mensagem), storage_path,
        ...(noProcesso ? { etapa_processo: "ENTRADA", etapa_changed_at: agora, selecionado_por: autor, selecionado_em: agora } : {}),
      }).select("id, nome").single();
      if (error) {
        if (storage_path) await supabase.storage.from("curriculos").remove([storage_path]);
        throw error;
      }
      onSalvo({ id: data.id, nome: data.nome ?? nome, noProcesso });
    } catch (e) {
      setErro((e as Error).message || "Não deu para salvar o candidato.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="rec-modal-ov" style={{ zIndex: 1100 }} onClick={e => { if (e.target === e.currentTarget && !salvando) onFechar(); }}>
      <div className="rec-modal" style={{ maxWidth: 860, width: "calc(100vw - 32px)", maxHeight: "92vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "inherit", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: "relative" }}>
          <button onClick={onFechar} disabled={salvando} style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>Inserir candidato manualmente</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {cargo ? <>{cargo} · #{vagaId} — </> : null}Só <b>nome completo</b> e <b>CPF</b> são obrigatórios; o resto pode ser completado depois.
          </div>
        </div>

        <style>{`.cand-manual-grid{grid-template-columns:repeat(4,minmax(0,1fr))}@media (max-width:640px){.cand-manual-grid{grid-template-columns:minmax(0,1fr)}.cand-manual-grid>*{grid-column:1/-1!important}}`}</style>
        <div className="cand-manual-grid" style={{ flex: 1, overflowY: "auto", padding: "16px 22px", display: "grid", gap: "12px 14px", alignContent: "start" }}>
          <Secao titulo="Identificação" />
          <Campo rotulo="Nome completo" obrigatorio span={2}>
            <input autoFocus style={inp} value={f.nome} onChange={e => set("nome", e.target.value)} placeholder="Nome e sobrenome" />
          </Campo>
          <Campo rotulo="CPF" obrigatorio>
            <input style={{ ...inp, borderColor: f.cpf && digitos(f.cpf).length === 11 && !cpfOk ? "#dc2626" : "#e2e8f0" }} value={f.cpf} inputMode="numeric"
                   onChange={e => set("cpf", mascaraCpf(e.target.value))} placeholder="000.000.000-00" />
            {f.cpf && digitos(f.cpf).length === 11 && !cpfOk && <div style={{ fontSize: 10.5, color: "#dc2626", marginTop: 3 }}>CPF inválido</div>}
          </Campo>
          <Campo rotulo="Data de nascimento"><input type="date" style={inp} value={f.data_nascimento} onChange={e => set("data_nascimento", e.target.value)} /></Campo>
          <Campo rotulo="RG"><input style={inp} value={f.rg} onChange={e => set("rg", e.target.value)} /></Campo>
          <Campo rotulo="PIS"><input style={inp} value={f.pis} inputMode="numeric" onChange={e => set("pis", e.target.value)} /></Campo>
          <Campo rotulo="Sexo">
            <select style={inp} value={f.sexo} onChange={e => set("sexo", e.target.value)}>
              <option value="">—</option><option>Feminino</option><option>Masculino</option><option>Outros</option>
            </select>
          </Campo>
          <Campo rotulo="Estrangeiro"><Marca rotulo="Sim, é estrangeiro" valor={f.estrangeiro} onChange={v => set("estrangeiro", v)} /></Campo>
          <Campo rotulo="Nome da mãe" span={2}><input style={inp} value={f.nome_mae} onChange={e => set("nome_mae", e.target.value)} /></Campo>
          <Campo rotulo="Nome do pai" span={2}><input style={inp} value={f.nome_pai} onChange={e => set("nome_pai", e.target.value)} /></Campo>

          <Secao titulo="Contato e localização" />
          <Campo rotulo="Telefone / WhatsApp"><input style={inp} value={f.telefone} inputMode="tel" onChange={e => set("telefone", mascaraFone(e.target.value))} placeholder="(00) 00000-0000" /></Campo>
          <Campo rotulo="E-mail" span={2}><input type="email" style={inp} value={f.email} onChange={e => set("email", e.target.value)} /></Campo>
          <Campo rotulo="Cidade onde mora"><input style={inp} value={f.cidade_residencia} onChange={e => set("cidade_residencia", e.target.value)} /></Campo>
          <Campo rotulo="Estado desejado">
            <select style={inp} value={f.estado_desejado} onChange={e => set("estado_desejado", e.target.value)}>
              <option value="">—</option>{UFS.map(u => <option key={u}>{u}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Cidade desejada"><input style={inp} value={f.cidade_desejada} onChange={e => set("cidade_desejada", e.target.value)} /></Campo>

          <Secao titulo="Perfil profissional" />
          <Campo rotulo="Escolaridade" span={2}>
            <select style={inp} value={f.escolaridade} onChange={e => set("escolaridade", e.target.value)}>
              <option value="">—</option>{ESCOLARIDADES.map(x => <option key={x}>{x}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Cargos de interesse" span={2}><input style={inp} value={f.cargos_interesse} onChange={e => set("cargos_interesse", e.target.value)} placeholder={cargo || ""} /></Campo>
          <Campo rotulo="Disponibilidade de horários" span={2}><input style={inp} value={f.disponibilidade_horarios} onChange={e => set("disponibilidade_horarios", e.target.value)} placeholder="Ex.: manhã e tarde" /></Campo>
          <Campo rotulo="Fim de semana"><Marca rotulo="Disponível" valor={f.disp_fim_semana} onChange={v => set("disp_fim_semana", v)} /></Campo>
          <Campo rotulo="CNH"><Marca rotulo="Possui CNH" valor={f.possui_cnh} onChange={v => set("possui_cnh", v)} /></Campo>
          <Campo rotulo="Experiência"><Marca rotulo="Tem experiência prévia" valor={f.experiencia_previa} onChange={v => set("experiencia_previa", v)} /></Campo>
          <Campo rotulo="Experiência 1" span={4}><input style={inp} value={f.experiencia_1} onChange={e => set("experiencia_1", e.target.value)} placeholder="Empresa, função e período" /></Campo>
          <Campo rotulo="Experiência 2" span={4}><input style={inp} value={f.experiencia_2} onChange={e => set("experiencia_2", e.target.value)} /></Campo>
          <Campo rotulo="Experiência 3" span={4}><input style={inp} value={f.experiencia_3} onChange={e => set("experiencia_3", e.target.value)} /></Campo>

          <Secao titulo="Currículo e observações" />
          <Campo rotulo="Arquivo do currículo (PDF ou imagem, opcional)" span={2}>
            <input type="file" accept=".pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
          </Campo>
          <Campo rotulo="Observações" span={4}>
            <textarea value={f.mensagem} onChange={e => set("mensagem", e.target.value)} rows={3}
                      style={{ ...inp, height: "auto", padding: "8px 10px", resize: "vertical", fontFamily: "inherit" }} placeholder="Como chegou, indicação, anotações…" />
          </Campo>
        </div>

        <div style={{ padding: "12px 22px", borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "#0f172a", cursor: "pointer" }}>
            <input type="checkbox" checked={noProcesso} onChange={e => setNoProcesso(e.target.checked)} style={{ width: 15, height: 15, accentColor: "#16a34a" }} />
            Já colocar no processo seletivo (Triagem)
          </label>
          {erro && <div style={{ flexBasis: "100%", order: -1, fontSize: 12, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 10px" }}>{erro}</div>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={onFechar} disabled={salvando} style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={salvar} disabled={salvando || !f.nome.trim() || !cpfOk}
                    style={{ height: 34, padding: "0 16px", borderRadius: 8, border: "none", background: salvando || !f.nome.trim() || !cpfOk ? "#94a3b8" : "#16a34a", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: salvando ? "wait" : "pointer" }}>
              {salvando ? "Salvando…" : "Inserir candidato"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
