import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { parseSurveyMonkey, ImportResultado } from "@/utils/surveyMonkeyImporter";
import { useFormPerms } from "@/hooks/useFormPerms";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { FormularioAcesso } from "./FormularioAcesso";
import QRCode from "qrcode";

// =====================================================================
// CENTRAL DE SERVIÇOS - Nascimento Formulários (gestão)
// Lista os formulários, mostra as URLs públicas ATIVAS no momento,
// vigência e nº de respostas. Ações: criar, editar (builder), publicar/
// encerrar/reabrir, copiar URL, duplicar, ver respostas e excluir.
// Página pública de resposta: /formularios/<slug> (sem login).
// =====================================================================

export interface Pergunta {
  id: string; tipo: string; titulo: string; descricao?: string | null;
  obrigatoria: boolean; imagem_url?: string | null;
  opcoes: string[]; config: Record<string, any>;
}

export interface Formulario {
  id: string; created_at: string; updated_at: string;
  titulo: string; descricao?: string | null; slug: string;
  status: "rascunho" | "publicado" | "encerrado";
  inicia_em?: string | null; encerra_em?: string | null;
  max_respostas?: number | null; coleta_identificacao: boolean;
  imagem_capa_url?: string | null; criado_por_nome?: string | null;
  criado_por?: string | null; visibilidade?: "todos" | "restrita";
  perguntas?: Pergunta[];  // jsonb - ordem = posição no array
  pergunta_setor_id?: string | null;  // qual pergunta classifica a resposta (Admin/Operac.)
  pergunta_nome_id?: string | null;   // qual pergunta diz QUEM respondeu (respostas sem respondente_nome)
  setor?: string | null;   // setor-DONO do formulário (criar_setor); null = geral
  // --- Segurança do formulário (quem pode RESPONDER; vale no banco) ---
  // 'liberado' = URL pública sem login. 'restrito' = exige login, e o público
  // é a UNIÃO de setores_acesso + CS_FORM_ALVO_USUARIOS (vazio+vazio = qualquer
  // usuário logado). exige_senha = camada extra dentro de restrito.
  seguranca?: "liberado" | "restrito";
  exige_senha?: boolean;
  setores_acesso?: string[] | null;   // setores (Setor_ERP) liberados quando restrito
  // Deixa o respondente escolher enviar sem se identificar. Anônimo é anônimo
  // no banco: o trigger cs_form_resposta_guard apaga criado_por/nome/e-mail/
  // cadastro antes de gravar (migration 20260902000001).
  permite_anonimo?: boolean;
  // Intervalo mínimo entre duas respostas da MESMA pessoa (em horas; null =
  // sem limite). Só vale para quem responde logado - link liberado não tem
  // identidade p/ contar o prazo.
  intervalo_horas?: number | null;
  deleted_at?: string | null;         // soft-delete: na lixeira quando != null
  deleted_por_nome?: string | null;   // quem moveu para a lixeira
}

/** Rótulo/cor da segurança, p/ badge na lista e no editor. */
export function seguranca(f: Formulario) {
  if ((f.seguranca ?? "liberado") === "liberado") return { rotulo: "Liberado - sem login", bg: "#dcfce7", c: "#15803d", icone: "🌐" };
  const partes: string[] = [];
  const st = f.setores_acesso ?? [];
  if (st.length) partes.push(st.length === 1 ? st[0] : `${st.length} setores`);
  if (f.exige_senha) partes.push("senha");
  return {
    rotulo: `Restrito${partes.length ? " - " + partes.join(" + ") : " - login"}`,
    bg: "#fef9c3", c: "#a16207", icone: f.exige_senha ? "🔑" : "🔒",
  };
}

export const normalizaPerguntas = (v: any): Pergunta[] =>
  (Array.isArray(v) ? v : []).map((p: any) => ({ ...p, opcoes: Array.isArray(p.opcoes) ? p.opcoes : [], config: p.config ?? {} }));

// crypto.randomUUID exige contexto seguro (HTTPS/localhost); produção roda em HTTP.
export const novoUuid = (): string =>
  (crypto as any).randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });

export const fmtDt = (s?: string | null) => { if (!s) return "-"; const d = new Date(s); return isNaN(+d) ? String(s) : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
export const urlPublica = (slug: string) => `${window.location.origin}/formularios/${slug}`;
export const slugify = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) +
  "-" + Math.random().toString(36).slice(2, 6);

/** Situação efetiva considerando status + janela de vigência. */
export function situacao(f: Formulario, respostas?: number) {
  if (f.status === "rascunho")  return { chave: "rascunho",  rotulo: "Rascunho",  bg: "#f1f5f9", c: "#475569" };
  if (f.status === "encerrado") return { chave: "encerrado", rotulo: "Encerrado", bg: "#fee2e2", c: "#b91c1c" };
  const now = Date.now();
  if (f.inicia_em && now < +new Date(f.inicia_em))  return { chave: "agendado", rotulo: `Agendado p/ ${fmtDt(f.inicia_em)}`, bg: "#e0f2fe", c: "#0369a1" };
  if (f.encerra_em && now > +new Date(f.encerra_em)) return { chave: "expirado", rotulo: "Prazo encerrado", bg: "#fef9c3", c: "#a16207" };
  if (f.max_respostas != null && respostas != null && respostas >= f.max_respostas)
    return { chave: "lotado", rotulo: "Limite de respostas atingido", bg: "#fef9c3", c: "#a16207" };
  return { chave: "ativo", rotulo: "Ativo - recebendo respostas", bg: "#dcfce7", c: "#15803d" };
}

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });

export default function Formularios() {
  const nav = useNavigate();
  const { user } = useAuth();
  // Vai gravado em criado_por_nome/deleted_por_nome — ver useMeuNome.
  const meuNome = useMeuNome();
  const { can, canVerAlgumaNoForm, canNoForm, canCriarSetor, setoresCriar, setor } = useFormPerms();
  // Flag "Botão de acessos de cada formulário" (migration 20260921000003): um
  // menu de capacidade em Administração › Acesso por Usuário. O toggle de lá
  // grava visualizar+incluir+alterar de uma vez; a RLS cobra 'incluir'.
  const { data: access } = useAccessibleMenus("incluir");
  const gerenteDeAcesso = access?.codes.has("formularios_acesso_botao") ?? false;
  const meusSetores = [...setoresCriar].sort();  // setores que o usuario e dono (criar_setor)
  const [forms, setForms] = useState<Formulario[]>([]);
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoSetor, setNovoSetor] = useState("");  // setor-dono ao criar (criador de setor)
  const [importPreview, setImportPreview] = useState<ImportResultado | null>(null);
  const [importTitulo, setImportTitulo] = useState("");
  const [importando, setImportando] = useState(false);
  const [excluindo, setExcluindo] = useState<Formulario | null>(null);  // modal "digite CONFIRMAR"
  const [confirmTxt, setConfirmTxt] = useState("");
  const [qrForm, setQrForm] = useState<Formulario | null>(null);  // modal do QR Code
  const [acessoForm, setAcessoForm] = useState<Formulario | null>(null);  // modal "Acesso"
  // Lista de acesso por formulário: id -> quantas pessoas + qual o MEU papel.
  const [acessos, setAcessos] = useState<Record<string, { pessoas: number; meuPapel: string | null }>>({});
  const [qrPng, setQrPng] = useState<string>("");                 // data URL do PNG gerado
  const [lixeiraAberta, setLixeiraAberta] = useState(false);
  const [lixeira, setLixeira] = useState<Formulario[]>([]);
  const [lixeiraLoading, setLixeiraLoading] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 4200); };

  const load = useCallback(async () => {
    setLoading(true);
    const [fRes, rRes, aRes] = await Promise.all([
      (supabase as any).from("CS_FORMULARIOS").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      (supabase as any).from("CS_FORM_RESPOSTAS").select("formulario_id"),
      // Lista de acesso POR formulário (migration 20260906000004). Uma
      // consulta só para todos os cards: quantas pessoas cada formulário tem
      // e qual é o MEU papel nele. A RLS de CS_FORM_ACESSOS já libera a
      // leitura dos papéis não-dashboard, então isto não vaza nada novo.
      // Só os QUATRO papéis da lista. Desde 20260921000002 existem também
      // linhas de LEITURA por formulário (ver_tudo/ver_setor/ver_regra_form),
      // que não são lista de acesso — contá-las aqui ligaria o modo restrito
      // do formulário e tiraria todo mundo que não estivesse nelas.
      (supabase as any).from("CS_FORM_ACESSOS").select("user_id,papel,formulario_id")
        .not("formulario_id", "is", null)
        .in("papel", ["form_dono", "form_gerenciar", "form_editar", "form_ver"]),
    ]);
    setLoading(false);
    if (fRes.error) { toast("Erro ao carregar: " + fRes.error.message, "err"); return; }
    setForms(fRes.data ?? []);
    const cont: Record<string, number> = {};
    (rRes.data ?? []).forEach((r: any) => { cont[r.formulario_id] = (cont[r.formulario_id] || 0) + 1; });
    setContagens(cont);
    const mapa: Record<string, { pessoas: number; meuPapel: string | null }> = {};
    (aRes.data ?? []).forEach((r: any) => {
      const e = (mapa[r.formulario_id] ??= { pessoas: 0, meuPapel: null });
      e.pessoas += 1;
      if (r.user_id === user?.id) e.meuPapel = r.papel;
    });
    setAcessos(mapa);
  }, [user?.id]);
  useEffect(() => { load(); }, [load]);

  // Gera o PNG do QR Code (512px, margem folgada) sempre que abrir o modal.
  useEffect(() => {
    if (!qrForm) { setQrPng(""); return; }
    let vivo = true;
    QRCode.toDataURL(urlPublica(qrForm.slug), { width: 512, margin: 2, errorCorrectionLevel: "M" })
      .then(url => { if (vivo) setQrPng(url); })
      .catch(() => { if (vivo) { setQrPng(""); toast("Não foi possível gerar o QR Code.", "err"); } });
    return () => { vivo = false; };
  }, [qrForm]);

  const baixarQr = () => {
    if (!qrForm || !qrPng) return;
    const a = document.createElement("a");
    a.href = qrPng;
    a.download = `qrcode-${qrForm.slug}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Criador SÓ de setor (sem editar_criar amplo) tem que escolher/carimbar o
  // setor-dono; criador amplo pode deixar em branco (formulário geral).
  const soSetor = !can("editar_criar") && meusSetores.length > 0;
  const criar = async () => {
    const titulo = novoTitulo.trim();
    if (!titulo) { toast("Dê um título ao formulário.", "err"); return; }
    if (soSetor && !novoSetor) { toast("Escolha o setor do formulário.", "err"); return; }
    const nome = meuNome || "";
    const linha: Record<string, any> = { titulo, slug: slugify(titulo), criado_por_nome: nome };
    if (novoSetor) linha.setor = novoSetor;
    const { data, error } = await (supabase as any).from("CS_FORMULARIOS").insert(linha).select("id").single();
    if (error) { toast("Erro ao criar: " + error.message, "err"); return; }
    nav(`/app/central-servicos/formularios/${data.id}`);
  };

  const mudarStatus = async (f: Formulario, status: Formulario["status"]) => {
    const { error } = await (supabase as any).from("CS_FORMULARIOS").update({ status }).eq("id", f.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    toast(status === "publicado" ? "Formulário publicado - URL ativa." : status === "encerrado" ? "Formulário encerrado." : "Voltou para rascunho.", "ok");
    load();
  };

  const copiarUrl = async (f: Formulario) => {
    try { await navigator.clipboard.writeText(urlPublica(f.slug)); toast("URL copiada!", "ok"); }
    catch { toast(urlPublica(f.slug), "info"); }
  };

  // ── Importação do SurveyMonkey (xlsx: resumo por pergunta OU respostas) ──
  const abrirImport = async (file: File) => {
    try {
      const preview = parseSurveyMonkey(await file.arrayBuffer());
      setImportTitulo(preview.titulo);
      setImportPreview(preview);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Não foi possível ler o arquivo.", "err");
    }
  };

  const importar = async () => {
    if (!importPreview) return;
    const titulo = importTitulo.trim() || importPreview.titulo;
    setImportando(true);
    const nome = meuNome || "";
    const temIdent = importPreview.respostas.some(r => r.respondente_nome || r.respondente_email);
    const pergsNovas: Pergunta[] = importPreview.perguntas.map(p => ({
      id: novoUuid(), tipo: p.tipo, titulo: p.titulo, descricao: p.descricao ?? null,
      obrigatoria: false, imagem_url: null, opcoes: p.opcoes, config: p.config,
    }));
    // Pergunta que define o setor (p/ Administrativo × Operacional): a que se
    // chamar "setor". Cada resposta guarda o valor dessa pergunta em setor.
    const setorIdx = pergsNovas.findIndex(p => /\bsetor\b/i.test(p.titulo));
    const setorPergId = setorIdx >= 0 ? pergsNovas[setorIdx].id : null;
    const coerceSetor = (v: any) => { const x = Array.isArray(v) ? v[0] : v; const t = x == null ? "" : String(x).trim(); return t || null; };
    // Cria o formulário INTEIRO (perguntas embutidas). pergunta_setor_id é
    // enriquecimento - vai num update best-effort depois, pra não derrubar a
    // importação em bancos que ainda não têm a coluna (migration de setores).
    const { data: form, error: e1 } = await (supabase as any).from("CS_FORMULARIOS").insert({
      titulo, slug: slugify(titulo), criado_por_nome: nome, coleta_identificacao: temIdent,
      descricao: "Importado do SurveyMonkey em " + new Date().toLocaleDateString("pt-BR") + ".",
      perguntas: pergsNovas,
    }).select("id").single();
    if (e1) { setImportando(false); toast("Erro ao criar formulário: " + e1.message, "err"); return; }
    if (setorPergId) await (supabase as any).from("CS_FORMULARIOS").update({ pergunta_setor_id: setorPergId }).eq("id", form.id);  // ignora erro se a coluna não existe

    // Índice da pergunta → id, para gravar os itens das respostas.
    const idPorOrdem: Record<number, string> = {};
    pergsNovas.forEach((p, i) => { idPorOrdem[i] = p.id; });

    const colunaFaltando = (m?: string) => !!m && /column|schema cache/i.test(m);
    let importadas = 0;
    for (let i = 0; i < importPreview.respostas.length; i += 200) {
      const slice = importPreview.respostas.slice(i, i + 200);
      const base = slice.map(r => ({
        formulario_id: form.id,
        enviado_em: r.enviado_em ?? new Date().toISOString(),
        respondente_nome: r.respondente_nome ?? null,
        respondente_email: r.respondente_email ?? null,
        itens: Object.fromEntries(Object.entries(r.itens).map(([idx, v]) => [idPorOrdem[Number(idx)], v]).filter(([k]) => k)),
      }));
      // Tenta com setor + criado_por (dono nulo p/ importadas); se essas colunas
      // ainda não existem no banco, reenvia só as respostas (sem enriquecimento).
      const lote = base.map((row, j) => ({ ...row, setor: setorIdx >= 0 ? coerceSetor(slice[j].itens[setorIdx]) : null, criado_por: null }));
      let { error: e3 } = await (supabase as any).from("CS_FORM_RESPOSTAS").insert(lote);
      if (colunaFaltando(e3?.message)) ({ error: e3 } = await (supabase as any).from("CS_FORM_RESPOSTAS").insert(base));
      if (e3) { setImportando(false); toast(`Erro nas respostas (${importadas} importadas): ` + e3.message, "err"); load(); return; }
      importadas += lote.length;
    }

    setImportando(false);
    setImportPreview(null);
    toast(`Importado: ${importPreview.perguntas.length} pergunta(s)${importadas ? ` e ${importadas} resposta(s)` : ""}. Revise e publique quando quiser.`, "ok");
    nav(`/app/central-servicos/formularios/${form.id}`);
  };

  const duplicar = async (f: Formulario) => {
    const nome = meuNome || "";
    const base = {
      titulo: f.titulo + " (cópia)", descricao: f.descricao, slug: slugify(f.titulo),
      inicia_em: f.inicia_em, encerra_em: f.encerra_em, max_respostas: f.max_respostas,
      coleta_identificacao: f.coleta_identificacao, imagem_capa_url: f.imagem_capa_url, criado_por_nome: nome,
      setor: f.setor ?? null,  // mantém o setor-dono (RLS de insert exige p/ criador de setor)
      perguntas: normalizaPerguntas(f.perguntas).map(p => ({ ...p, id: novoUuid() })),
    };
    // Anonimato e intervalo entre respostas acompanham a cópia (uma pesquisa
    // que se repete todo mês não deve perder as regras). Banco sem as colunas
    // novas: reenvia sem elas em vez de falhar a duplicação.
    let { error } = await (supabase as any).from("CS_FORMULARIOS")
      .insert({ ...base, permite_anonimo: !!f.permite_anonimo, intervalo_horas: f.intervalo_horas ?? null })
      .select("id").single();
    if (error && /column|schema cache/i.test(error.message))
      ({ error } = await (supabase as any).from("CS_FORMULARIOS").insert(base).select("id").single());
    if (error) { toast("Erro ao duplicar: " + error.message, "err"); return; }
    toast("Formulário duplicado (como rascunho).", "ok");
    load();
  };

  // Excluir = soft-delete (vai p/ lixeira 30 dias). Exige digitar CONFIRMAR.
  const confirmarExcluir = async () => {
    if (!excluindo) return;
    if (confirmTxt.trim().toUpperCase() !== "CONFIRMAR") { toast('Digite CONFIRMAR para excluir.', "err"); return; }
    const nome = meuNome || "";
    const quando = new Date().toISOString();
    // grava quem apagou; se a coluna ainda não existir no banco, reenvia só a data.
    let { error } = await (supabase as any).from("CS_FORMULARIOS").update({ deleted_at: quando, deleted_por_nome: nome }).eq("id", excluindo.id);
    if (error && /deleted_por_nome|column|schema cache/i.test(error.message || "")) {
      ({ error } = await (supabase as any).from("CS_FORMULARIOS").update({ deleted_at: quando }).eq("id", excluindo.id));
    }
    if (error) { toast("Erro ao excluir: " + error.message, "err"); return; }
    toast("Formulário movido para a lixeira (30 dias para restaurar).", "ok");
    setExcluindo(null); setConfirmTxt("");
    load();
  };

  // ── Lixeira ──────────────────────────────────────────────────────────
  const abrirLixeira = async () => {
    setLixeiraAberta(true); setLixeiraLoading(true);
    await (supabase as any).rpc("cs_form_purgar_lixeira");  // purga os > 30 dias (best-effort)
    const { data, error } = await (supabase as any).from("CS_FORMULARIOS")
      .select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    setLixeiraLoading(false);
    if (error) { toast("Erro ao abrir lixeira: " + error.message, "err"); return; }
    setLixeira(data ?? []);
  };
  const restaurar = async (f: Formulario) => {
    const { error } = await (supabase as any).from("CS_FORMULARIOS").update({ deleted_at: null }).eq("id", f.id);
    if (error) { toast("Erro ao restaurar: " + error.message, "err"); return; }
    toast("Formulário restaurado.", "ok");
    setLixeira(xs => xs.filter(x => x.id !== f.id));
    load();
  };
  // dias que faltam p/ o apagado ser removido de vez (30 dias após deleted_at).
  const diasRestantes = (f: Formulario) => {
    const d = f.deleted_at ? new Date(f.deleted_at) : null;
    if (!d) return 0;
    return Math.max(0, 30 - Math.floor((Date.now() - d.getTime()) / 86400000));
  };

  // Formulário restrito a setores (setores_acesso) só aparece para esse setor;
  // quem gerencia (editar/encerrar/ver tudo) enxerga todos.
  const podeVerTodos = can("editar_criar") || can("encerrar_excluir") || can("ver_tudo");
  // Gestão do formulário: quem cria/encerra amplamente OU é dono do setor dele.
  const podeCriar = can("editar_criar") || meusSetores.length > 0;

  // ── Acesso POR formulário (migration 20260906000004) ──────────────────
  // Espelha public.cs_form_pode. A autoridade é a RLS; aqui é só para não
  // desenhar botão que o banco vai recusar.
  //
  // A lista, quando existe, RESTRINGE: quem não está nela perde o
  // formulário mesmo tendo permissão global. Formulário sem lista se
  // comporta exatamente como antes desta migration.
  const meuPapel = (f: Formulario) => acessos[f.id]?.meuPapel ?? null;
  const temLista = (f: Formulario) => (acessos[f.id]?.pessoas ?? 0) > 0;
  const listaExclui = (f: Formulario) => temLista(f) && !meuPapel(f);
  const papelPermite = (f: Formulario, papeis: string[]) => papeis.includes(meuPapel(f) ?? "");

  const podeEditar = (f: Formulario) =>
    ((can("editar_criar") || canCriarSetor(f.setor)) && !listaExclui(f))
    || papelPermite(f, ["form_dono", "form_gerenciar", "form_editar"]);
  const podeEncerrar = (f: Formulario) =>
    ((can("encerrar_excluir") || canCriarSetor(f.setor)) && !listaExclui(f))
    || papelPermite(f, ["form_dono", "form_gerenciar"]);
  const podeExcluir = (f: Formulario) =>
    (can("encerrar_excluir") && !listaExclui(f)) || papelPermite(f, ["form_dono"]);
  // 'ver_tudo' é a chave-mestra: sempre consegue reabrir a lista (é a saída
  // para dono desligado da empresa). Sem lista ainda, quem administra hoje
  // cria a primeira — senão o botão nasceria útil para ninguém.
  // 'formularios_acesso_botao' (migration 20260921000003) é o flag de
  // Administração › Acesso por Usuário que abre este botão em QUALQUER
  // formulário, sem precisar ser dono dele. Espelha cs_form_gerente_de_acesso.
  const podeAcesso = (f: Formulario) =>
    can("ver_tudo")
    || gerenteDeAcesso
    || papelPermite(f, ["form_dono", "form_gerenciar"])
    || (!temLista(f) && (can("editar_criar") || can("encerrar_excluir")));
  // A regra PRÓPRIA do formulário manda aqui também: quem tem "ver tudo" no
  // geral mas uma regra vazia neste formulário não vê as respostas dele — e o
  // botão não pode prometer uma tela que a RLS devolve em branco. Espelha
  // cs_form_cap_ver + cs_form_pode(_,'ver') da migration 20260921000002.
  const podeVerRespostas = (f: Formulario) =>
    (canVerAlgumaNoForm(f.id) && (!listaExclui(f) || canNoForm(f.id, "ver_tudo")))
    || papelPermite(f, ["form_dono", "form_gerenciar", "form_editar", "form_ver"]);
  // Gestor só de setor vê apenas os formulários do(s) seu(s) setor(es).
  const soGestorSetor = !podeVerTodos && meusSetores.length > 0;
  const visiveis = forms.filter(f => {
    // Formulário com lista some da GESTÃO de quem a lista deixou de fora: se
    // não dá para editar, nem encerrar, nem ler as respostas, o card só serve
    // para o botão dar "sem permissão". Isto é interface — quem está no
    // público-alvo continua abrindo o link e respondendo normalmente (a RLS de
    // CS_FORMULARIOS não foi podada, ver 20260921000004).
    // A poda só vale quando NADA sobrou para a pessoa: a chave-mestra
    // 'ver_tudo', o gerente de acesso e quem tem regra PRÓPRIA de leitura
    // neste formulário (que fura a exclusão da lista, via cs_form_cap_ver)
    // continuam vendo o card — são justamente quem precisa achá-lo.
    if (listaExclui(f) && !podeVerRespostas(f) && !podeAcesso(f) && !podeEditar(f)) return false;
    if (soGestorSetor) return canCriarSetor(f.setor);
    const restr = f.setores_acesso ?? [];
    return restr.length === 0 || podeVerTodos || (!!setor && restr.includes(setor));
  });
  const termo = busca.trim().toLowerCase();
  const filtrados = !termo ? visiveis : visiveis.filter(f => [f.titulo, f.descricao, f.slug].some(v => String(v ?? "").toLowerCase().includes(termo)));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .nf-card { transition: transform .28s cubic-bezier(.4,0,.2,1), box-shadow .28s cubic-bezier(.4,0,.2,1); will-change: transform; }
        .nf-card:hover { transform: translateY(-5px); box-shadow: 0 20px 44px rgba(15,23,42,.15); border-color: #c7d2fe; }
        .nf-cover { transition: transform .55s cubic-bezier(.4,0,.2,1); }
        .nf-card:hover .nf-cover { transform: scale(1.07); }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>📋 Nascimento Formulários</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Crie formulários e pesquisas, publique numa URL e acompanhe as respostas.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Sempre visíveis. `canVerAlguma` só enxerga as capacidades GERAIS,
              e desde a regra por formulário (20260921000002) dá para ver tudo
              de UM formulário sem ter capacidade geral nenhuma — o botão sumia
              justamente para quem acabou de ganhar acesso. Quem não pode ver
              nada entra e encontra o painel vazio: o recorte é da RLS e do
              `podeVer` lá dentro, não de esconder a porta. */}
          <button onClick={() => nav("/app/central-servicos/formularios/dashboard")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>📊 Dashboard</button>
          <button onClick={() => nav("/app/central-servicos/formularios/painel")} style={btn("#0f3171")}>📈 Painel Gerencial</button>
          {/* "Líderes por setor" foi centralizado na Administração → Módulos & Menus →
              Acesso por Usuário (regra geral por setor). */}
          {can("ver_lixeira") && <button onClick={abrirLixeira} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>🗑 Lixeira</button>}
          {podeCriar && <>
            {can("editar_criar") && <>
              <button onClick={() => importRef.current?.click()} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬆ Importar SurveyMonkey</button>
              <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) abrirImport(f); e.target.value = ""; }} />
            </>}
            <button onClick={() => { setNovoTitulo(""); setNovoSetor(meusSetores.length === 1 ? meusSetores[0] : ""); setCriando(true); }} style={btn("#0f3171")}>+ Novo formulário</button>
          </>}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
        <input placeholder="Buscar formulário..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 12, padding: "9px 12px", outline: "none", width: "100%", maxWidth: 420, marginBottom: 14, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }} />

        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Nenhum formulário ainda. Clique em <b>+ Novo formulário</b> para começar.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14, alignItems: "start" }}>
            {filtrados.map(f => {
              const sit = situacao(f, contagens[f.id] || 0);
              const seg = seguranca(f);
              const n = contagens[f.id] || 0;
              return (
                <div key={f.id} className="nf-card" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
                  {f.imagem_capa_url && (
                    <div style={{ height: 128, background: "linear-gradient(135deg,#f8fbff 0%,#eef2ff 100%)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <img src={f.imagem_capa_url} alt="" className="nf-cover" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                    </div>
                  )}
                  <div style={{ height: 3, background: sit.chave === "ativo" ? "#16a34a" : sit.chave === "rascunho" ? "#94a3b8" : "#f59e0b" }} />
                  <div style={{ padding: "13px 15px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{f.titulo}</div>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: sit.bg, color: sit.c, whiteSpace: "nowrap" }}>{sit.rotulo}</span>
                    </div>
                    {f.descricao && <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{f.descricao}</div>}
                    <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span>📬 <b style={{ color: "#0f172a" }}>{n}</b> resposta(s){f.max_respostas != null ? ` · limite ${f.max_respostas}` : ""}</span>
                      <span title="Quem pode responder este formulário">
                        {seg.icone} <b style={{ color: seg.c }}>{seg.rotulo}</b>
                      </span>
                      <span>🗓 {f.inicia_em || f.encerra_em ? `${f.inicia_em ? "de " + fmtDt(f.inicia_em) : ""} ${f.encerra_em ? "até " + fmtDt(f.encerra_em) : ""}` : "sem prazo definido"}</span>
                      {f.permite_anonimo && <span title="O respondente escolhe enviar sem se identificar">🕶 Aceita resposta anônima</span>}
                      {f.intervalo_horas != null && (
                        <span title="Intervalo mínimo entre duas respostas da mesma pessoa (só p/ quem responde logado)">
                          ⏱ 1 resposta a cada <b style={{ color: "#0f172a" }}>{f.intervalo_horas % 24 === 0 ? `${f.intervalo_horas / 24} dia(s)` : `${f.intervalo_horas} hora(s)`}</b>
                        </span>
                      )}
                      {f.setor && <span>🏷️ Setor: <b style={{ color: "#4338ca" }}>{f.setor}</b></span>}
                      <span>por {f.criado_por_nome || "-"} · criado em {fmtDt(f.created_at)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
                      {can("responder") && <a href={urlPublica(f.slug)} target="_blank" rel="noopener noreferrer" style={{ ...btn("#16a34a"), textDecoration: "none", display: "inline-block" }}>↗ Abrir</a>}
                      {podeEditar(f) && <button onClick={() => nav(`/app/central-servicos/formularios/${f.id}`)} style={btn("#0f3171")}>✏️ Editar</button>}
                      {podeVerRespostas(f) && <button onClick={() => nav(`/app/central-servicos/formularios/${f.id}/respostas`)} style={btn("rgba(59,130,246,.1)", "#2563eb", "1px solid rgba(59,130,246,.3)")}>📊 Respostas</button>}
                      {podeAcesso(f) && (
                        <button onClick={() => setAcessoForm(f)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>
                          {temLista(f) ? `🔒 Acesso (${acessos[f.id].pessoas})` : "🔓 Acesso"}
                        </button>
                      )}
                      {podeEncerrar(f) && f.status !== "publicado" && <button onClick={() => mudarStatus(f, "publicado")} style={btn("#16a34a")}>Publicar</button>}
                      {f.status === "publicado" && <>
                        <button onClick={() => copiarUrl(f)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>🔗 Copiar URL</button>
                        <button onClick={() => setQrForm(f)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>⬛ QR Code</button>
                        {podeEncerrar(f) && <button onClick={() => mudarStatus(f, "encerrado")} style={btn("rgba(220,38,38,.08)", "#dc2626", "1px solid rgba(220,38,38,.25)")}>Encerrar</button>}
                      </>}
                      {podeEncerrar(f) && f.status === "encerrado" && <button onClick={() => mudarStatus(f, "publicado")} style={btn("#16a34a")}>Reabrir</button>}
                      {podeEditar(f) && <button onClick={() => duplicar(f)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Duplicar</button>}
                      {podeExcluir(f) && <button onClick={() => { setExcluindo(f); setConfirmTxt(""); }} style={btn("transparent", "#94a3b8")}>Excluir</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: acesso por formulário */}
      {acessoForm && (
        <FormularioAcesso
          formulario={acessoForm}
          onFechar={() => setAcessoForm(null)}
          onSalvo={load}
          toast={toast}
        />
      )}

      {/* Modal: novo formulário */}
      {criando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900 }} onClick={() => setCriando(false)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 440, maxWidth: "92vw", position: "relative" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Novo formulário</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>Dê um título - você monta as perguntas na próxima tela.</div>
            <input autoFocus placeholder="Ex.: Pesquisa de Clima 2026" value={novoTitulo} onChange={e => setNovoTitulo(e.target.value)}
              onKeyDown={e => e.key === "Enter" && criar()}
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, outline: "none" }} />
            {meusSetores.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>Setor do formulário{soSetor ? " *" : ""}</label>
                <select value={novoSetor} onChange={e => setNovoSetor(e.target.value)}
                  style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, outline: "none", background: "#fff", color: "#0f172a", fontFamily: "inherit" }}>
                  {!soSetor && <option value="">Geral (sem setor)</option>}
                  {soSetor && <option value="">Escolha o setor...</option>}
                  {meusSetores.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>As respostas ficam visíveis a quem gerencia esse setor.</div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setCriando(false)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
              <button onClick={criar} style={btn("#0f3171")}>Criar e montar →</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: importar do SurveyMonkey */}
      {importPreview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 }} onClick={() => !importando && setImportPreview(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 640, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", position: "relative" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Importar do SurveyMonkey</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
              {importPreview.formato === "respostas"
                ? `Export de respostas individuais: ${importPreview.perguntas.length} pergunta(s) e ${importPreview.respostas.length} resposta(s).`
                : `Export de resumo por pergunta: ${importPreview.perguntas.length} pergunta(s) - o formulário será replicado.`}
            </div>
            {importPreview.avisos.map((a, i) => (
              <div key={i} style={{ fontSize: 12, background: "#fffbeb", border: "1px solid #fde68a", color: "#a16207", borderRadius: 9, padding: "8px 10px", marginBottom: 10 }}>⚠️ {a}</div>
            ))}
            <label style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>Título do formulário</label>
            <input value={importTitulo} onChange={e => setImportTitulo(e.target.value)}
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", fontSize: 13.5, outline: "none", marginBottom: 12 }} />
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, maxHeight: 300, overflowY: "auto" }}>
              {importPreview.perguntas.map((p, i) => (
                <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", flexShrink: 0 }}>#{i + 1}</span>
                  <span style={{ fontSize: 12.5, color: "#0f172a", flex: 1 }}>{p.titulo}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {({ texto_curto: "Texto curto", texto_longo: "Texto longo", multipla_escolha: "Múltipla escolha", caixas_selecao: "Caixas de seleção", lista_suspensa: "Lista", escala: "Escala", data: "Data", numero: "Número" } as Record<string, string>)[p.tipo] ?? p.tipo}
                    {p.opcoes.length ? ` · ${p.opcoes.length} opções` : ""}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setImportPreview(null)} disabled={importando} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
              <button onClick={importar} disabled={importando} style={btn(importando ? "#94a3b8" : "#16a34a")}>
                {importando ? "Importando..." : `✓ Importar${importPreview.respostas.length ? ` (${importPreview.respostas.length} respostas)` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: excluir formulário (digitar CONFIRMAR) */}
      {excluindo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 }} onClick={() => { setExcluindo(null); setConfirmTxt(""); }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 460, maxWidth: "92vw", position: "relative" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: "#b91c1c" }}>Excluir formulário</div>
            <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}>
              Você vai excluir <b>"{excluindo.titulo}"</b>{(contagens[excluindo.id] || 0) > 0 ? <> — que tem <b>{contagens[excluindo.id]}</b> resposta(s)</> : null}.
            </div>
            <div style={{ fontSize: 12.5, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", marginBottom: 12 }}>
              Ele vai para a <b>lixeira por 30 dias</b> e pode ser restaurado. Depois disso é apagado de vez.
            </div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>Digite <b style={{ color: "#b91c1c" }}>CONFIRMAR</b> para excluir</label>
            <input autoFocus value={confirmTxt} onChange={e => setConfirmTxt(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirmarExcluir()} placeholder="CONFIRMAR"
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, outline: "none", textTransform: "uppercase" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => { setExcluindo(null); setConfirmTxt(""); }} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
              <button onClick={confirmarExcluir} disabled={confirmTxt.trim().toUpperCase() !== "CONFIRMAR"}
                style={{ ...btn(confirmTxt.trim().toUpperCase() === "CONFIRMAR" ? "#dc2626" : "#fca5a5"), cursor: confirmTxt.trim().toUpperCase() === "CONFIRMAR" ? "pointer" : "not-allowed" }}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: QR Code do formulário (link público → PNG exportável) */}
      {qrForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 }} onClick={() => setQrForm(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 380, maxWidth: "92vw", position: "relative", textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>QR Code do formulário</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 14 }}>Aponte a câmera para abrir <b style={{ color: "#0f172a" }}>{qrForm.titulo}</b>.</div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              {qrPng
                ? <img src={qrPng} alt={`QR Code de ${qrForm.titulo}`} style={{ width: 240, height: 240, border: "1px solid #e2e8f0", borderRadius: 12, padding: 8, background: "#fff" }} />
                : <div style={{ width: 240, height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", border: "1px dashed #cbd5e1", borderRadius: 12 }}>Gerando…</div>}
            </div>
            <div style={{ fontSize: 11.5, color: "#94a3b8", wordBreak: "break-all", marginBottom: 14 }}>{urlPublica(qrForm.slug)}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => copiarUrl(qrForm)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>🔗 Copiar URL</button>
              <button onClick={baixarQr} disabled={!qrPng} style={btn(qrPng ? "#0f3171" : "#94a3b8")}>⬇ Baixar PNG</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setQrForm(null)} style={btn("transparent", "#94a3b8")}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: lixeira (formulários apagados, restauráveis 30 dias) */}
      {lixeiraAberta && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 }} onClick={() => setLixeiraAberta(false)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 620, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", position: "relative" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>🗑 Lixeira</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>Formulários apagados ficam aqui por 30 dias e podem ser restaurados. Depois disso são removidos automaticamente.</div>
            {lixeiraLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
            ) : lixeira.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>A lixeira está vazia.</div>
            ) : (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                {lixeira.map(f => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.titulo}</div>
                      <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
                        Apagado em {fmtDt(f.deleted_at)}{f.deleted_por_nome ? ` por ${f.deleted_por_nome}` : ""} · restam <b style={{ color: diasRestantes(f) <= 5 ? "#dc2626" : "#475569" }}>{diasRestantes(f)} dia(s)</b>
                        {f.setor ? ` · setor ${f.setor}` : ""}
                      </div>
                    </div>
                    <button onClick={() => restaurar(f)} style={btn("#16a34a")}>↩ Restaurar</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setLixeiraAberta(false)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Fechar</button>
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
