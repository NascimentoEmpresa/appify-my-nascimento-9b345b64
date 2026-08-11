import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { Formulario, Pergunta, fmtDt, urlPublica, situacao, normalizaPerguntas, novoUuid } from "./Formularios";

// Teto de upload de anexo (criador e respondente): 25MB.
export const MAX_ANEXO = 25 * 1024 * 1024;
// Tipos de arquivo aceitos como anexo (amplo — PDF, Office, imagens, zip…).
export const ACCEPT_ANEXO = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*";

// =====================================================================
// NASCIMENTO FORMULÁRIOS - Builder (editor de formulário)
// Monta o formulário: título/descrição/capa, configurações (vigência,
// limite de respostas, identificação do respondente) e as perguntas -
// vários tipos, com imagem por pergunta, opções e obrigatoriedade.
// Salvar = 1 update: perguntas vivem em CS_FORMULARIOS.perguntas (jsonb),
// com ids estáveis p/ não órfãr respostas.
// =====================================================================

export const TIPOS: { valor: string; rotulo: string; temOpcoes: boolean }[] = [
  { valor: "texto_curto",      rotulo: "Texto curto",              temOpcoes: false },
  { valor: "texto_longo",      rotulo: "Texto longo (parágrafo)",  temOpcoes: false },
  { valor: "texto_info",       rotulo: "Texto informativo (só leitura)", temOpcoes: false },
  { valor: "colaborador",      rotulo: "Selecionar colaborador (cadastro)", temOpcoes: false },
  { valor: "contrato",         rotulo: "Selecionar contrato (cadastro)", temOpcoes: false },
  { valor: "escala_trabalho",  rotulo: "Escala de trabalho (turno)", temOpcoes: false },
  { valor: "multipla_escolha", rotulo: "Múltipla escolha (1 opção)", temOpcoes: true },
  { valor: "caixas_selecao",   rotulo: "Caixas de seleção (várias)", temOpcoes: true },
  { valor: "lista_suspensa",   rotulo: "Lista suspensa",           temOpcoes: true },
  { valor: "escala",           rotulo: "Escala (nota)",            temOpcoes: false },
  { valor: "data",             rotulo: "Data",                     temOpcoes: false },
  { valor: "numero",           rotulo: "Número",                   temOpcoes: false },
];

// Cores predefinidas para o texto informativo (o valor "" = cor padrão).
export const CORES_TEXTO: { nome: string; valor: string }[] = [
  { nome: "Padrão",   valor: "" },
  { nome: "Vermelho", valor: "#dc2626" },
  { nome: "Laranja",  valor: "#ea580c" },
  { nome: "Amarelo",  valor: "#ca8a04" },
  { nome: "Verde",    valor: "#16a34a" },
  { nome: "Azul",     valor: "#0f3171" },
  { nome: "Roxo",     valor: "#7c3aed" },
];

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "#fff" };
const lbl: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 };

/** datetime-local <-> ISO */
const paraLocal = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(+d)) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const paraIso = (local: string) => (local ? new Date(local).toISOString() : null);

/** textarea que cresce sozinho conforme o texto (sem precisar arrastar). */
function AutoTextarea({ value, onChange, placeholder, style, minRows = 2 }: { value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={minRows}
    style={{ ...style, overflow: "hidden", resize: "none" }} />;
}

// ── Segurança do formulário ─────────────────────────────────────────────
// Liberado = URL pública sem login. Restrito = exige login; responde a UNIÃO
// de (setores) + (pessoas a dedo); vazio dos dois = qualquer usuário logado.
// Senha é uma camada a mais dentro de restrito.
export interface UsuarioErp { id: string; display_name: string | null; email: string | null }

function Seguranca({ form, mudaForm, setoresErp, usuarios, alvo, setAlvo, senha, setSenha, querSenha, setQuerSenha }: {
  form: Formulario; mudaForm: (p: Partial<Formulario>) => void; setoresErp: string[];
  usuarios: UsuarioErp[];
  alvo: string[]; setAlvo: (v: string[]) => void;
  senha: string | null; setSenha: (v: string | null) => void;
  querSenha: boolean; setQuerSenha: (v: boolean) => void;
}) {
  const [busca, setBusca] = useState("");
  const restrito = (form.seguranca ?? "liberado") === "restrito";

  const porId = Object.fromEntries(usuarios.map(u => [u.id, u]));
  const termo = busca.trim().toLowerCase();
  const achados = termo.length < 2 ? [] : usuarios
    .filter(u => !alvo.includes(u.id))
    .filter(u => `${u.display_name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(termo))
    .slice(0, 8);

  const opcao = (val: "liberado" | "restrito", titulo: string, desc: string) => {
    const on = restrito === (val === "restrito");
    return (
      <div onClick={() => mudaForm({ seguranca: val })} style={{ flex: 1, minWidth: 210, cursor: "pointer", display: "flex", gap: 9, padding: "10px 12px", borderRadius: 11, border: on ? "1.5px solid #0f3171" : "1px solid #e2e8f0", background: on ? "rgba(15,49,113,.04)" : "#fff" }}>
        <div style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, marginTop: 2, border: on ? "4.5px solid #0f3171" : "1.5px solid #cbd5e1", background: "#fff" }} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: on ? "#0f3171" : "#0f172a" }}>{titulo}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{desc}</div>
        </div>
      </div>
    );
  };

  return (
    <>
      <label style={lbl}>Segurança - quem pode responder</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {opcao("liberado", "🌐 Liberado", "Qualquer um com o link. Sem login.")}
        {opcao("restrito", "🔒 Restrito", "Exige entrar no ERP p/ responder.")}
      </div>

      {restrito && (
        <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Setores */}
          <div>
            <label style={lbl}>Setores liberados</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {setoresErp.length === 0 && <span style={{ fontSize: 12, color: "#94a3b8" }}>Carregando setores…</span>}
              {setoresErp.map(s => {
                const on = (form.setores_acesso ?? []).includes(s);
                return (
                  <span key={s} onClick={() => { const set = new Set(form.setores_acesso ?? []); on ? set.delete(s) : set.add(s); mudaForm({ setores_acesso: set.size ? [...set] : null }); }}
                    style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: on ? "1px solid #0f3171" : "1px solid #e2e8f0", background: on ? "#0f3171" : "#fff", color: on ? "#fff" : "#64748b" }}>{s}</span>
                );
              })}
            </div>
          </div>

          {/* Pessoas específicas (usuários do ERP) */}
          <div>
            <label style={lbl}>Pessoas liberadas (além dos setores)</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: alvo.length ? 6 : 0 }}>
              {alvo.map(uid => (
                <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: "#0f3171", color: "#fff" }}>
                  {porId[uid]?.display_name || porId[uid]?.email || "Usuário removido"}
                  <button onClick={() => setAlvo(alvo.filter(x => x !== uid))} title="Tirar"
                    style={{ border: "none", background: "rgba(255,255,255,.2)", color: "#fff", borderRadius: "50%", width: 16, height: 16, lineHeight: "14px", cursor: "pointer", fontSize: 11 }}>×</button>
                </span>
              ))}
            </div>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar usuário do ERP por nome ou e-mail…" style={{ ...inp, width: "100%" }} />
            {achados.length > 0 && (
              <div style={{ marginTop: 5, border: "1px solid #e2e8f0", borderRadius: 9, background: "#fff", overflow: "hidden" }}>
                {achados.map(u => (
                  <div key={u.id} onClick={() => { setAlvo([...alvo, u.id]); setBusca(""); }}
                    style={{ padding: "7px 10px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{u.display_name || "(sem nome)"}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{u.email}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Senha. senha===null = "não mexeu" (mantém a do banco); "" = remover. */}
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", marginBottom: querSenha ? 6 : 0 }}>
              <input type="checkbox" checked={querSenha}
                onChange={e => { const on = e.target.checked; setQuerSenha(on); setSenha(on && form.exige_senha ? null : ""); }}
                style={{ width: 15, height: 15, accentColor: "#0f3171" }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>🔑 Exigir também uma senha do formulário</span>
            </label>
            {querSenha && (
              <>
                <input type="text" value={senha ?? ""} onChange={e => setSenha(e.target.value)}
                  placeholder={form.exige_senha && senha === null ? "Senha já definida — digite p/ trocar" : "Digite a senha do formulário"}
                  style={{ ...inp, width: "100%", maxWidth: 320 }} />
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  Guardada com hash — nunca volta pra tela.{form.exige_senha && senha === null ? " Deixe como está p/ manter a senha atual." : ""}
                </div>
              </>
            )}
          </div>

          <div style={{ fontSize: 11, color: "#64748b", background: "#eef6ff", border: "1px solid #dbeafe", borderRadius: 9, padding: "7px 10px" }}>
            {(form.setores_acesso?.length || alvo.length)
              ? <>Responde quem for <b>de um dos setores</b> acima <b>ou</b> estiver na lista de pessoas{querSenha ? <> — e souber a <b>senha</b></> : null}.</>
              : <>Sem setor nem pessoa marcada: responde <b>qualquer usuário logado</b> do ERP{querSenha ? <> que saiba a <b>senha</b></> : null}.</>}
          </div>
        </div>
      )}
    </>
  );
}

export default function FormularioEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState<Formulario | null>(null);
  const [pergs, setPergs] = useState<Pergunta[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const capaRef = useRef<HTMLInputElement>(null);
  const [setoresErp, setSetoresErp] = useState<string[]>([]);   // setores distintos de EMPREGADOS
  const [usuarios, setUsuarios] = useState<UsuarioErp[]>([]);   // usuarios do ERP (profiles) p/ acesso por pessoa
  const [mostrarEncerra, setMostrarEncerra] = useState(false);
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const [massaOpen, setMassaOpen] = useState(false);   // adicionar perguntas em massa
  const [massaTexto, setMassaTexto] = useState("");
  // Segurança: pessoas liberadas (user_id do ERP) e senha. senha === null =>
  // "não mexeu" (não toca no que está no banco); "" => remover a senha.
  const [alvo, setAlvo] = useState<string[]>([]);
  const [senha, setSenha] = useState<string | null>(null);
  const [querSenha, setQuerSenha] = useState(false);
  const toast = (msg: string, t = "info") => { const tid = Date.now() + Math.random(); setToasts(x => [...x, { id: tid, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== tid)), 4200); };

  const load = useCallback(async () => {
    setLoading(true);
    const fRes = await (supabase as any).from("CS_FORMULARIOS").select("*").eq("id", id).single();
    setLoading(false);
    if (fRes.error) { toast("Formulário não encontrado.", "err"); nav("/app/central-servicos/formularios"); return; }
    setForm(fRes.data);
    setPergs(normalizaPerguntas(fRes.data.perguntas));
    if (fRes.data.encerra_em) setMostrarEncerra(true);
    // Pessoas liberadas a dedo. Best-effort: banco sem a tabela nova não trava o editor.
    try {
      const { data } = await (supabase as any).from("CS_FORM_ALVO_USUARIOS").select("user_id").eq("formulario_id", id);
      setAlvo((data ?? []).map((r: any) => r.user_id));
    } catch { setAlvo([]); }
    setSenha(null);  // a senha nunca volta do banco (só o hash existe lá)
    setQuerSenha(!!fRes.data.exige_senha);
    setSujo(false);
  }, [id, nav]);
  useEffect(() => { load(); }, [load]);

  // Setores do cadastro (EMPREGADOS.Setor_ERP) - para "Acesso" e visibilidade por setor.
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("EMPREGADOS").select('"Setor_ERP"').limit(20000);
      setSetoresErp([...new Set((data ?? []).map((r: any) => String(r["Setor_ERP"] ?? "").trim()).filter(Boolean))].sort() as string[]);
    })();
  }, []);

  // Usuários do ERP: acesso por pessoa (no formulário e por pergunta). Uma
  // carga só, compartilhada com todos os cards de pergunta.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, display_name, email").order("display_name");
      setUsuarios((data ?? []) as any);
    })();
  }, []);

  const mudaForm = (patch: Partial<Formulario>) => { setForm(f => f ? { ...f, ...patch } : f); setSujo(true); };
  const mudaPerg = (i: number, patch: Partial<Pergunta>) => { setPergs(ps => ps.map((p, j) => j === i ? { ...p, ...patch } : p)); setSujo(true); };

  const addPergunta = () => { setPergs(ps => [...ps, { id: novoUuid(), tipo: "texto_curto", titulo: "", obrigatoria: false, opcoes: [], config: {} }]); setSujo(true); };
  const addEmMassa = () => {
    const linhas = massaTexto.split("\n").map(l => l.trim()).filter(Boolean);
    if (!linhas.length) { setMassaOpen(false); return; }
    setPergs(ps => [...ps, ...linhas.map(t => ({ id: novoUuid(), tipo: "texto_curto", titulo: t, obrigatoria: false, opcoes: [] as string[], config: {} as Record<string, any> }))]);
    setMassaTexto(""); setMassaOpen(false); setSujo(true);
  };
  const insertPergunta = (i: number) => { setPergs(ps => { const a = [...ps]; a.splice(i + 1, 0, { id: novoUuid(), tipo: "texto_curto", titulo: "", obrigatoria: false, opcoes: [], config: {} }); return a; }); setSujo(true); };
  const removePergunta = (i: number) => { setPergs(ps => ps.filter((_, j) => j !== i)); setSujo(true); };
  // Excluir pergunta com confirmação; avisa se ela já tem respostas gravadas.
  const [apagarPerg, setApagarPerg] = useState<{ i: number; p: Pergunta } | null>(null);
  const [apagarPergN, setApagarPergN] = useState<number | null>(null);  // null = contando
  const pedirRemoverPergunta = async (i: number) => {
    const p = pergs[i];
    setApagarPerg({ i, p }); setApagarPergN(null);
    const { data } = await (supabase as any).rpc("cs_form_pergunta_respostas", { _form_id: id, _perg: p.id });
    setApagarPergN(typeof data === "number" ? data : 0);
  };
  const confirmarRemoverPergunta = () => { if (apagarPerg) removePergunta(apagarPerg.i); setApagarPerg(null); setApagarPergN(null); };
  const move = (i: number, dir: -1 | 1) => {
    setPergs(ps => { const a = [...ps]; const j = i + dir; if (j < 0 || j >= a.length) return ps; [a[i], a[j]] = [a[j], a[i]]; return a; });
    setSujo(true);
  };

  // Arrastar p/ reordenar (alça ⠿ no card). distance:6 = não vira drag num clique.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPergs(ps => {
      const oldI = ps.findIndex(p => p.id === active.id);
      const newI = ps.findIndex(p => p.id === over.id);
      if (oldI < 0 || newI < 0) return ps;
      return arrayMove(ps, oldI, newI);
    });
    setSujo(true);
  };

  // Marcar/desmarcar TODAS como obrigatórias (texto informativo não conta).
  const respondiveis = pergs.filter(p => p.tipo !== "texto_info");
  const todasObrig = respondiveis.length > 0 && respondiveis.every(p => p.obrigatoria);
  const toggleTodasObrigatorias = () => {
    setPergs(ps => ps.map(p => p.tipo === "texto_info" ? p : { ...p, obrigatoria: !todasObrig }));
    setSujo(true);
  };

  const upload = async (file: File, prefixo: string): Promise<string | null> => {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${form?.id ?? "geral"}/${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from("cs-formularios").upload(path, file, { upsert: false });
    if (error) { toast("Erro no upload: " + error.message, "err"); return null; }
    return supabase.storage.from("cs-formularios").getPublicUrl(path).data.publicUrl;
  };

  const salvar = async (novoStatus?: Formulario["status"]) => {
    if (!form) return;
    if (!form.titulo.trim()) { toast("O formulário precisa de um título.", "err"); return; }
    if (novoStatus === "publicado" && pergs.filter(p => p.titulo.trim()).length === 0) { toast("Adicione ao menos 1 pergunta antes de publicar.", "err"); return; }
    // Pediu senha mas não tem nenhuma definida e não digitou: barra, senão o
    // "exigir senha" ficaria marcado na tela sem senha nenhuma no banco.
    if ((form.seguranca ?? "liberado") === "restrito" && querSenha && !form.exige_senha && !senha?.trim()) {
      toast("Digite a senha do formulário ou desmarque a opção.", "err"); return;
    }
    setSalvando(true);
    // Colunas garantidas (base) x colunas novas de setor/acesso (extra). Se o
    // banco ainda não tem as novas, reenvia só a base - o save não trava.
    const base: any = {
      titulo: form.titulo.trim(), descricao: form.descricao || null,
      inicia_em: form.inicia_em || null, encerra_em: form.encerra_em || null,
      max_respostas: form.max_respostas || null, coleta_identificacao: form.coleta_identificacao,
      imagem_capa_url: form.imagem_capa_url || null,
      perguntas: pergs.filter(p => p.titulo.trim()).map(p => ({
        id: p.id, tipo: p.tipo, titulo: p.titulo.trim(), descricao: p.descricao || null,
        obrigatoria: p.obrigatoria, imagem_url: p.imagem_url || null,
        opcoes: p.opcoes.filter(o => o.trim()), config: p.config,
      })),
      ...(novoStatus ? { status: novoStatus } : {}),
    };
    const restrito = (form.seguranca ?? "liberado") === "restrito";
    const extra = {
      pergunta_setor_id: form.pergunta_setor_id || null,
      pergunta_nome_id: form.pergunta_nome_id || null,
      seguranca: form.seguranca ?? "liberado",
      // Liberado zera os filtros: não deixa restrição órfã no banco.
      setores_acesso: restrito ? (form.setores_acesso?.length ? form.setores_acesso : null) : null,
    };
    let { error: e1 } = await (supabase as any).from("CS_FORMULARIOS").update({ ...base, ...extra }).eq("id", form.id);
    if (e1 && /column|schema cache/i.test(e1.message)) ({ error: e1 } = await (supabase as any).from("CS_FORMULARIOS").update(base).eq("id", form.id));
    if (e1) { setSalvando(false); toast("Erro ao salvar: " + e1.message, "err"); return; }

    // Pessoas liberadas: troca o conjunto inteiro (liberado = ninguém a dedo).
    const alvoFinal = restrito ? alvo : [];
    const { error: e2 } = await (supabase as any).from("CS_FORM_ALVO_USUARIOS").delete().eq("formulario_id", form.id);
    if (!e2 && alvoFinal.length) {
      await (supabase as any).from("CS_FORM_ALVO_USUARIOS")
        .insert(alvoFinal.map(u => ({ formulario_id: form.id, user_id: u })));
    }

    // Senha: só chama a RPC se mexeram nela (senha !== null). A RPC hasheia e
    // acerta o exige_senha. Virou liberado com senha antiga => remove.
    const senhaNova = restrito ? senha : (form.exige_senha ? "" : null);
    if (senhaNova !== null) {
      const { error: e3 } = await (supabase as any).rpc("cs_form_definir_senha", { _form_id: form.id, _senha: senhaNova || null });
      if (e3) { setSalvando(false); toast("Salvou o formulário, mas a senha falhou: " + e3.message, "err"); load(); return; }
    }
    setSalvando(false);
    toast(novoStatus === "publicado" ? "Publicado! URL ativa - copie na lista." : "Salvo.", "ok");
    load();
  };

  if (loading || !form) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Carregando...</div>;
  const sit = situacao(form);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={() => nav("/app/central-servicos/formularios")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>← Voltar</button>
        <div style={{ flex: 1, minWidth: 220, fontSize: 16, fontWeight: 800, color: form.titulo ? "#0f3171" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{form.titulo || "Sem título"}</div>
        {form.setor && <span title="Setor-dono deste formulário (definido na criação)" style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>🏷️ {form.setor}</span>}
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: sit.bg, color: sit.c }}>{sit.rotulo}</span>
        {form.status === "publicado" && <a href={urlPublica(form.slug)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#0369a1", fontWeight: 700 }}>Abrir URL ↗</a>}
        <button onClick={() => salvar()} disabled={salvando} style={btn(sujo ? "#0f3171" : "#94a3b8")}>{salvando ? "Salvando..." : "💾 Salvar"}</button>
        {form.status !== "publicado"
          ? <button onClick={() => salvar("publicado")} disabled={salvando} style={btn("#16a34a")}>🚀 Publicar</button>
          : <button onClick={() => salvar("encerrado")} disabled={salvando} style={btn("rgba(220,38,38,.08)", "#dc2626", "1px solid rgba(220,38,38,.25)")}>Encerrar</button>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Criar Formulário */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px 18px", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>🗂 Criar Formulário</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Título do formulário</label>
                <input value={form.titulo} onChange={e => mudaForm({ titulo: e.target.value })} style={{ ...inp, width: "100%", fontSize: 14, fontWeight: 700, color: "#0f172a" }} placeholder="Ex.: Feedback Guiado 2026" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Descrição do formulário (aparece no topo)</label>
                <AutoTextarea value={form.descricao ?? ""} onChange={v => mudaForm({ descricao: v })} minRows={2} placeholder="Explique o objetivo do formulário..." style={{ ...inp, width: "100%" }} />
              </div>
              <div>
                <label style={lbl}>Data de criação</label>
                <div style={{ ...inp, width: "100%", background: "#f8fafc", color: "#475569", fontWeight: 600 }}>{fmtDt(form.created_at)}</div>
              </div>
              <div>
                <label style={lbl}>Encerramento automático</label>
                {form.encerra_em || mostrarEncerra ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="datetime-local" value={paraLocal(form.encerra_em)} onChange={e => mudaForm({ encerra_em: paraIso(e.target.value) })} style={{ ...inp, flex: 1 }} />
                    <button onClick={() => { mudaForm({ encerra_em: null }); setMostrarEncerra(false); }} style={btn("#fff", "#dc2626", "1px solid rgba(220,38,38,.25)")}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setMostrarEncerra(true)} style={{ ...btn("#fff", "#0f3171", "1px dashed #cbd5e1"), width: "100%", padding: "8px" }}>+ Adicionar encerramento automático</button>
                )}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Seguranca form={form} mudaForm={mudaForm} setoresErp={setoresErp} usuarios={usuarios}
                  alvo={alvo} setAlvo={vs => { setAlvo(vs); setSujo(true); }}
                  senha={senha} setSenha={v => { setSenha(v); setSujo(true); }}
                  querSenha={querSenha} setQuerSenha={setQuerSenha} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Imagem de capa (opcional)</label>
                {form.imagem_capa_url
                  ? <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <img src={form.imagem_capa_url} alt="capa" style={{ height: 64, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                      <button onClick={() => mudaForm({ imagem_capa_url: null })} style={btn("#fff", "#dc2626", "1px solid rgba(220,38,38,.25)")}>Remover</button>
                    </div>
                  : <>
                      <button onClick={() => capaRef.current?.click()} style={btn("#fff", "#0f3171", "1px dashed #cbd5e1")}>🖼 Enviar imagem de capa</button>
                      <input ref={capaRef} type="file" accept="image/*" style={{ display: "none" }}
                        onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await upload(f, "capa"); if (url) mudaForm({ imagem_capa_url: url }); e.target.value = ""; }} />
                    </>}
              </div>

              {/* Mais opções - abre em, limite, identificação, pergunta de setor */}
              <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
                <button onClick={() => setMaisOpcoes(v => !v)} style={{ background: "none", border: "none", color: "#0f3171", fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0 }}>Mais opções {maisOpcoes ? "▴" : "▾"}</button>
              </div>
              {maisOpcoes && <>
                <div>
                  <label style={lbl}>Abre em (opcional)</label>
                  <input type="datetime-local" value={paraLocal(form.inicia_em)} onChange={e => mudaForm({ inicia_em: paraIso(e.target.value) })} style={{ ...inp, width: "100%" }} />
                </div>
                <div>
                  <label style={lbl}>Limite de respostas (opcional)</label>
                  <input type="number" min={1} value={form.max_respostas ?? ""} onChange={e => mudaForm({ max_respostas: e.target.value ? Number(e.target.value) : null })} style={{ ...inp, width: "100%" }} placeholder="Sem limite" />
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center" }}>
                  <label style={{ fontSize: 12.5, color: "#0f172a", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600 }}>
                    <input type="checkbox" checked={form.coleta_identificacao} onChange={e => mudaForm({ coleta_identificacao: e.target.checked })} style={{ width: 15, height: 15 }} />
                    Pedir nome e e-mail (quando o respondente não está logado)
                  </label>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>Pergunta que define o setor (fallback do cadastro, p/ Admin × Operacional)</label>
                  <select value={form.pergunta_setor_id ?? ""} onChange={e => mudaForm({ pergunta_setor_id: e.target.value || null })} style={{ ...inp, width: "100%", maxWidth: 420, textOverflow: "ellipsis" }}>
                    <option value="">- Nenhuma (usa o setor do cadastro do respondente) -</option>
                    {pergs.filter(p => p.titulo.trim()).map(p => <option key={p.id} value={p.id}>{p.titulo.length > 60 ? p.titulo.slice(0, 60) + "…" : p.titulo}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>Pergunta que identifica o respondente (quem respondeu)</label>
                  <select value={form.pergunta_nome_id ?? ""} onChange={e => mudaForm({ pergunta_nome_id: e.target.value || null })} style={{ ...inp, width: "100%", maxWidth: 420, textOverflow: "ellipsis" }}>
                    <option value="">- Nenhuma (usa o cadastro / identificação do respondente) -</option>
                    {pergs.filter(p => p.titulo.trim()).map(p => <option key={p.id} value={p.id}>{p.titulo.length > 60 ? p.titulo.slice(0, 60) + "…" : p.titulo}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Usada quando a resposta não tem nome (ex.: importadas) — vira o nome em Respostas e no filtro.</div>
                </div>
              </>}
            </div>
            {form.status === "publicado" && (
              <div style={{ marginTop: 12, fontSize: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", borderRadius: 9, padding: "8px 10px", wordBreak: "break-all" }}>
                🔗 URL pública: <b>{urlPublica(form.slug)}</b>{form.encerra_em ? ` · encerra ${fmtDt(form.encerra_em)}` : ""}
              </div>
            )}
          </div>

          {/* Perguntas — arrastáveis pela alça ⠿ */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pergs.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {pergs.map((p, i) => (
                <SortablePergunta key={p.id} id={p.id}>
                  {(handleProps) => (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <PerguntaCard p={p} i={i} total={pergs.length} muda={mudaPerg} move={move} remove={pedirRemoverPergunta} upload={upload} setores={setoresErp} usuarios={usuarios} handleProps={handleProps} />
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <button onClick={() => insertPergunta(i)} title="Inserir pergunta abaixo"
                          style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #cbd5e1", background: "#fff", color: "#0f3171", fontSize: 18, fontWeight: 700, cursor: "pointer", lineHeight: 1, boxShadow: "0 2px 6px rgba(15,23,42,.08)" }}>+</button>
                      </div>
                    </div>
                  )}
                </SortablePergunta>
              ))}
            </SortableContext>
          </DndContext>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={addPergunta} style={{ ...btn("#fff", "#0f3171", "2px dashed #cbd5e1"), flex: 1, minWidth: 200, padding: "14px", fontSize: 13.5, borderRadius: 14 }}>+ Adicionar pergunta</button>
            <button onClick={() => setMassaOpen(v => !v)} style={{ ...btn(massaOpen ? "#0f3171" : "#fff", massaOpen ? "#fff" : "#0f3171", "2px dashed #cbd5e1"), padding: "14px", fontSize: 13.5, borderRadius: 14 }}>➕ Adicionar em massa</button>
            {respondiveis.length > 0 && (
              <button onClick={toggleTodasObrigatorias} title="Marca/desmarca todas as perguntas como obrigatórias"
                style={{ ...btn(todasObrig ? "#dc2626" : "#fff", todasObrig ? "#fff" : "#dc2626", "2px dashed rgba(220,38,38,.4)"), padding: "14px", fontSize: 13.5, borderRadius: 14 }}>
                {todasObrig ? "✖ Desmarcar todas obrigatórias" : "✔️ Marcar todas obrigatórias"}
              </button>
            )}
          </div>

          {massaOpen && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px 18px", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f3171", marginBottom: 4 }}>Adicionar várias perguntas de uma vez</div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 8 }}>Uma pergunta por linha. Entram como “Texto curto” - depois é só ajustar o tipo de cada uma.</div>
              <textarea value={massaTexto} onChange={e => setMassaTexto(e.target.value)} rows={7} placeholder={"Pergunta 1\nPergunta 2\nPergunta 3\nPergunta 4\nPergunta 5"} style={{ ...inp, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                <button onClick={() => { setMassaOpen(false); setMassaTexto(""); }} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
                <button onClick={addEmMassa} style={btn("#0f3171")}>Adicionar {massaTexto.split("\n").map(l => l.trim()).filter(Boolean).length} pergunta(s)</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmar exclusão de pergunta (avisa se já tem respostas) */}
      {apagarPerg && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 950, padding: 16 }} onClick={() => { setApagarPerg(null); setApagarPergN(null); }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 440, maxWidth: "92vw" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, color: "#b91c1c" }}>Excluir pergunta</div>
            <div style={{ fontSize: 13.5, color: "#334155" }}>
              Tem certeza que deseja apagar esta pergunta{apagarPerg.p.titulo ? <> — <b>"{apagarPerg.p.titulo}"</b></> : null}?
            </div>
            {apagarPergN === null ? (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>Verificando respostas…</div>
            ) : apagarPergN > 0 ? (
              <div style={{ fontSize: 12.5, color: "#a16207", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "9px 11px", marginTop: 10 }}>
                ⚠️ Essa pergunta já tem <b>{apagarPergN}</b> resposta(s). Apagá-la esconde essas respostas dos relatórios.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>Esta pergunta ainda não tem respostas.</div>
            )}
            <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 8 }}>A exclusão só é gravada quando você salvar o formulário.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => { setApagarPerg(null); setApagarPergN(null); }} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
              <button onClick={confirmarRemoverPergunta} style={btn("#dc2626")}>Apagar pergunta</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 18, right: 18, display: "flex", flexDirection: "column", gap: 8, zIndex: 999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: t.t === "err" ? "#fee2e2" : t.t === "ok" ? "#dcfce7" : "#e0f2fe", color: t.t === "err" ? "#b91c1c" : t.t === "ok" ? "#15803d" : "#0369a1", padding: "10px 16px", borderRadius: 12, fontSize: 12.5, fontWeight: 700, boxShadow: "0 8px 24px rgba(15,23,42,.15)", maxWidth: 380 }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// Wrapper de arraste: dá a alça (handleProps) pro card e move o item no DnD.
function SortablePergunta({ id, children }: { id: string; children: (handleProps: any) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, position: "relative", zIndex: isDragging ? 10 : undefined };
  return <div ref={setNodeRef} style={style}>{children({ ...attributes, ...listeners })}</div>;
}

function PerguntaCard({ p, i, total, muda, move, remove, upload, setores, usuarios, handleProps }: {
  p: Pergunta; i: number; total: number;
  muda: (i: number, patch: Partial<Pergunta>) => void;
  move: (i: number, dir: -1 | 1) => void;
  remove: (i: number) => void;
  upload: (f: File, prefixo: string) => Promise<string | null>;
  setores: string[];
  usuarios: UsuarioErp[];
  handleProps?: any;
}) {
  const imgRef = useRef<HTMLInputElement>(null);
  const arqRef = useRef<HTMLInputElement>(null);
  const [mostrarSetor, setMostrarSetor] = useState(false);
  const [buscaP, setBuscaP] = useState("");
  const tipo = TIPOS.find(t => t.valor === p.tipo);
  // Visibilidade da pergunta: UNIÃO de config.setores + config.pessoas (user_id
  // do ERP). Vazio nos dois = todos veem/respondem.
  const setoresVis: string[] = Array.isArray(p.config.setores) ? p.config.setores : [];
  const pessoasVis: string[] = Array.isArray(p.config.pessoas) ? p.config.pessoas : [];
  const restrita = setoresVis.length > 0 || pessoasVis.length > 0;
  const verbo = p.tipo === "texto_info" ? "veem" : "respondem";
  const setPessoas = (v: string[]) => muda(i, { config: { ...p.config, pessoas: v.length ? v : undefined } });
  const termoP = buscaP.trim().toLowerCase();
  const achadosP = termoP.length < 2 ? [] : usuarios
    .filter(u => !pessoasVis.includes(u.id))
    .filter(u => `${u.display_name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(termoP))
    .slice(0, 6);
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
        <span {...(handleProps ?? {})} title="Arraste para reordenar" aria-label="Arraste para reordenar"
          style={{ flexShrink: 0, paddingTop: 6, fontSize: 15, color: "#cbd5e1", cursor: "grab", touchAction: "none", userSelect: "none", lineHeight: 1 }}>⠿</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", flexShrink: 0, paddingTop: 8 }}>#{i + 1}</span>
        <AutoTextarea value={p.titulo} onChange={v => muda(i, { titulo: v })} minRows={1} placeholder="Escreva a pergunta..."
          style={{ border: "none", borderBottom: "2px solid #e2e8f0", padding: "6px 2px", fontSize: 14.5, fontWeight: 700, color: "#0f172a", outline: "none", flex: 1, background: "transparent", lineHeight: 1.4 }} />
        <select value={p.tipo} onChange={e => muda(i, { tipo: e.target.value, opcoes: TIPOS.find(t => t.valor === e.target.value)?.temOpcoes && p.opcoes.length === 0 ? ["Opção 1"] : p.opcoes })}
          style={{ border: "1px solid #e2e8f0", borderRadius: 9, padding: "7px 8px", fontSize: 12, outline: "none", background: "#fff", fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
          {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
        </select>
      </div>

      {/* Tipo de gráfico do painel (opcional) — só para perguntas que viram gráfico */}
      {["multipla_escolha", "caixas_selecao", "lista_suspensa", "escala", "escala_trabalho", "contrato"].includes(p.tipo) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b" }}>📊 Gráfico no painel</span>
          <select value={p.config.grafico ?? "barras"} onChange={e => muda(i, { config: { ...p.config, grafico: e.target.value } })}
            style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 9px", fontSize: 12, outline: "none", background: "#fff", fontWeight: 600 }}>
            <option value="barras">Barras</option>
            <option value="colunas">Colunas</option>
            <option value="pizza">Pizza</option>
            <option value="rosca">Rosca</option>
          </select>
          <span style={{ fontSize: 10.5, color: "#cbd5e1" }}>(opcional)</span>
        </div>
      )}

      {/* Um contrato ou vários. Desligado = escolhe um só, que é o caso comum;
          ligado, a resposta vira lista e o painel conta cada contrato. */}
      {p.tipo === "contrato" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={!!p.config.multiplos}
            onChange={e => muda(i, { config: { ...p.config, multiplos: e.target.checked || undefined } })}
            style={{ width: 15, height: 15 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>Permitir selecionar mais de um contrato</span>
          <span style={{ fontSize: 10.5, color: "#cbd5e1" }}>(a lista mostra só contratos ativos)</span>
        </label>
      )}

      {p.tipo === "texto_info" ? (
        <div style={{ marginBottom: 10 }}>
          <AutoTextarea value={p.descricao ?? ""} onChange={v => muda(i, { descricao: v })} minRows={3} placeholder="Texto que o colaborador vai ler (o título fica em destaque acima)"
            style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: p.config.cor || "#334155", fontWeight: p.config.cor ? 600 : 400, outline: "none", width: "100%", background: "#fff", fontFamily: "inherit" }} />
          <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Cor do texto</span>
            {CORES_TEXTO.map(c => {
              const on = (p.config.cor || "") === c.valor;
              return (
                <button key={c.nome} title={c.nome} onClick={() => muda(i, { config: { ...p.config, cor: c.valor || undefined } })}
                  style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", padding: 0,
                    background: c.valor || "#64748b",
                    border: on ? "2px solid #0f172a" : "2px solid #fff",
                    boxShadow: on ? "0 0 0 2px #0f172a" : "0 0 0 1px #e2e8f0" }} />
              );
            })}
          </div>
        </div>
      ) : (
        <input value={p.descricao ?? ""} onChange={e => muda(i, { descricao: e.target.value })} placeholder="Descrição / ajuda - aparece abaixo do título (opcional)"
          style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 9px", fontSize: 12, color: "#64748b", outline: "none", width: "100%", marginBottom: 10, background: "#fafbfc" }} />
      )}

      {p.imagem_url && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <img src={p.imagem_url} alt="" style={{ maxHeight: 110, borderRadius: 10, border: "1px solid #e2e8f0" }} />
          <button onClick={() => muda(i, { imagem_url: null })} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(220,38,38,.25)", background: "#fff", color: "#dc2626", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Remover imagem</button>
        </div>
      )}

      {p.config.arquivo_url && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "8px 11px" }}>
          <a href={p.config.arquivo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: "#0369a1", textDecoration: "none", flex: 1, wordBreak: "break-all" }}>📎 {p.config.arquivo_nome || "arquivo anexado"}</a>
          <button onClick={() => muda(i, { config: { ...p.config, arquivo_url: undefined, arquivo_nome: undefined } })} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(220,38,38,.25)", background: "#fff", color: "#dc2626", fontSize: 11.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Remover</button>
        </div>
      )}

      {tipo?.temOpcoes && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {p.opcoes.map((o, oi) => (
            <div key={oi} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: "#cbd5e1", fontSize: 13 }}>{p.tipo === "caixas_selecao" ? "☐" : p.tipo === "lista_suspensa" ? `${oi + 1}.` : "◯"}</span>
              <input value={o} onChange={e => muda(i, { opcoes: p.opcoes.map((x, xi) => xi === oi ? e.target.value : x) })}
                style={{ border: "none", borderBottom: "1px solid #e2e8f0", padding: "4px 2px", fontSize: 13, outline: "none", flex: 1, maxWidth: 420 }} />
              <button onClick={() => muda(i, { opcoes: p.opcoes.filter((_, xi) => xi !== oi) })} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
          ))}
          <button onClick={() => muda(i, { opcoes: [...p.opcoes, `Opção ${p.opcoes.length + 1}`] })}
            style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#0369a1", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "2px 0" }}>+ Adicionar opção</button>
          <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, color: "#0f172a", marginTop: 4 }}>
            <input type="checkbox" checked={!!p.config.outro} onChange={e => muda(i, { config: { ...p.config, outro: e.target.checked } })} style={{ width: 14, height: 14 }} />
            Permitir opção “Outro” - o respondente descreve
          </label>
        </div>
      )}

      {p.tipo === "escala" && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 10, flexWrap: "wrap" }}>
          <div><label style={lbl}>De</label>
            <select value={p.config.min ?? 1} onChange={e => muda(i, { config: { ...p.config, min: Number(e.target.value) } })} style={{ ...inp, padding: "6px 8px" }}>{[0, 1].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          <div><label style={lbl}>Até</label>
            <select value={p.config.max ?? 5} onChange={e => muda(i, { config: { ...p.config, max: Number(e.target.value) } })} style={{ ...inp, padding: "6px 8px" }}>{[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 140 }}><label style={lbl}>Rótulo inicial (opcional)</label>
            <input value={p.config.rotulo_min ?? ""} onChange={e => muda(i, { config: { ...p.config, rotulo_min: e.target.value } })} style={{ ...inp, width: "100%", padding: "6px 8px" }} placeholder="Ex.: Péssimo" /></div>
          <div style={{ flex: 1, minWidth: 140 }}><label style={lbl}>Rótulo final (opcional)</label>
            <input value={p.config.rotulo_max ?? ""} onChange={e => muda(i, { config: { ...p.config, rotulo_max: e.target.value } })} style={{ ...inp, width: "100%", padding: "6px 8px" }} placeholder="Ex.: Excelente" /></div>
        </div>
      )}

      {setores.length > 0 && (
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 8, marginBottom: 4 }}>
          <button onClick={() => setMostrarSetor(v => !v)} style={{ background: "none", border: "none", color: restrita ? "#0f3171" : "#94a3b8", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            👁 {restrita
              ? `Só ${[setoresVis.length ? `${setoresVis.length} setor(es)` : "", pessoasVis.length ? `${pessoasVis.length} pessoa(s)` : ""].filter(Boolean).join(" + ")} ${verbo}`
              : `Todos ${verbo}`} {mostrarSetor ? "▴" : "▾"}
          </button>
          {mostrarSetor && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <span style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                  {p.tipo === "texto_info" ? "Só quem estiver aqui vê este texto" : "Só quem estiver aqui responde esta pergunta"} — vazio dos dois = todos.
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {setores.map(s => {
                    const on = setoresVis.includes(s);
                    return <span key={s} onClick={() => { const set = new Set(setoresVis); on ? set.delete(s) : set.add(s); muda(i, { config: { ...p.config, setores: set.size ? [...set] : undefined } }); }}
                      style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", border: on ? "1px solid #0f3171" : "1px solid #e2e8f0", background: on ? "#0f3171" : "#fff", color: on ? "#fff" : "#64748b" }}>{s}</span>;
                  })}
                </div>
              </div>
              {/* Pessoas específicas (usuários do ERP) — união com os setores acima */}
              <div>
                <span style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Pessoas específicas (além dos setores):</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: pessoasVis.length ? 5 : 0 }}>
                  {pessoasVis.map(uid => (
                    <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 5px 3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#0f3171", color: "#fff" }}>
                      {usuarios.find(u => u.id === uid)?.display_name || usuarios.find(u => u.id === uid)?.email || "Usuário"}
                      <button onClick={() => setPessoas(pessoasVis.filter(x => x !== uid))}
                        style={{ border: "none", background: "rgba(255,255,255,.2)", color: "#fff", borderRadius: "50%", width: 15, height: 15, lineHeight: "13px", cursor: "pointer", fontSize: 10 }}>×</button>
                    </span>
                  ))}
                </div>
                <input value={buscaP} onChange={e => setBuscaP(e.target.value)} placeholder="Buscar usuário do ERP…"
                  style={{ ...inp, width: "100%", maxWidth: 300, padding: "6px 8px", fontSize: 12 }} />
                {achadosP.length > 0 && (
                  <div style={{ marginTop: 4, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", maxWidth: 300, overflow: "hidden" }}>
                    {achadosP.map(u => (
                      <div key={u.id} onClick={() => { setPessoas([...pessoasVis, u.id]); setBuscaP(""); }}
                        style={{ padding: "6px 9px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{u.display_name || "(sem nome)"}</div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{u.email}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: 10, flexWrap: "wrap" }}>
        {p.tipo !== "texto_info" && (
          <label style={{ fontSize: 12, color: "#0f172a", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }}>
            <input type="checkbox" checked={p.obrigatoria} onChange={e => muda(i, { obrigatoria: e.target.checked })} style={{ width: 14, height: 14, accentColor: "#dc2626" }} />
            Obrigatória
          </label>
        )}
        {p.tipo === "texto_info" && <span style={{ fontSize: 11.5, color: "#94a3b8", fontWeight: 700 }}>📄 Só leitura - o colaborador não responde</span>}
        {p.tipo !== "texto_info" && (
          <label style={{ fontSize: 12, color: "#0f172a", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }} title="Deixa o respondente enviar um PDF/arquivo (até 25MB) junto da resposta">
            <input type="checkbox" checked={!!p.config.anexo_resp} onChange={e => muda(i, { config: { ...p.config, anexo_resp: e.target.checked || undefined } })} style={{ width: 14, height: 14, accentColor: "#0f3171" }} />
            📎 Permitir anexo do respondente
          </label>
        )}
        <button onClick={() => imgRef.current?.click()} style={{ background: "none", border: "none", color: "#0369a1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🖼 {p.imagem_url ? "Trocar" : "Adicionar"} imagem</button>
        <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await upload(f, `perg-${i + 1}`); if (url) muda(i, { imagem_url: url }); e.target.value = ""; }} />
        <button onClick={() => arqRef.current?.click()} style={{ background: "none", border: "none", color: "#0369a1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📎 {p.config.arquivo_url ? "Trocar" : "Anexar"} arquivo</button>
        <input ref={arqRef} type="file" accept={ACCEPT_ANEXO} style={{ display: "none" }}
          onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.size > MAX_ANEXO) { alert("Arquivo muito grande — limite de 25MB."); return; } const url = await upload(f, `arq-${i + 1}`); if (url) muda(i, { config: { ...p.config, arquivo_url: url, arquivo_nome: f.name } }); }} />
        <div style={{ flex: 1 }} />
        <button onClick={() => move(i, -1)} disabled={i === 0} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 7, width: 26, height: 26, cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#e2e8f0" : "#475569" }}>↑</button>
        <button onClick={() => move(i, 1)} disabled={i === total - 1} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 7, width: 26, height: 26, cursor: i === total - 1 ? "default" : "pointer", color: i === total - 1 ? "#e2e8f0" : "#475569" }}>↓</button>
        <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>🗑 Excluir</button>
      </div>
    </div>
  );
}
