import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import logoNascimento from "@/assets/logo-nascimento-icon.png";

// =====================================================================
// NASCIMENTO FORMULÁRIOS - página PÚBLICA de resposta (/formularios/:slug)
// Sem login. A RLS só entrega formulário PUBLICADO; janela de vigência e
// limite de respostas são validados aqui (UX) e reforçados na policy do
// INSERT (autoridade final - fora da regra o insert é rejeitado).
// =====================================================================

interface Form {
  id: string; titulo: string; descricao?: string | null; slug: string;
  status: string; inicia_em?: string | null; encerra_em?: string | null;
  coleta_identificacao: boolean; imagem_capa_url?: string | null;
  pergunta_setor_id?: string | null; pergunta_nome_id?: string | null; setores_acesso?: string[] | null;
  seguranca?: "liberado" | "restrito"; exige_senha?: boolean;
  permite_anonimo?: boolean; intervalo_horas?: number | null;
}
/**
 * O `config` jsonb da pergunta. Cada tipo usa um punhado destas chaves e
 * ignora o resto — daí serem todas opcionais. Estão listadas em vez de um
 * `Record<string, any>` para o editor avisar quando um lado escrever
 * `multiplo` e o outro ler `multiplos`, que é o erro que o jsonb solto
 * deixa passar até alguém abrir o formulário.
 */
interface ConfigPerg {
  cor?: string;
  multiplos?: boolean;
  outro?: boolean;
  arquivo_url?: string; arquivo_nome?: string; anexo_resp?: boolean;
  min?: number; max?: number; rotulo_min?: string; rotulo_max?: string;
  // Público-alvo da pergunta (união de setores e pessoas).
  setores?: string[]; pessoas?: string[];
  // Pergunta "colegas".
  escala_max?: number; min_colegas?: number; max_colegas?: number;
  setores_distintos?: boolean; excluir_proprio?: boolean;
  nota_obrigatoria?: boolean;
  comentario_rotulo?: string; comentario_desc?: string;
  comentario_placeholder?: string; comentario_obrigatorio?: boolean;
}

interface Perg {
  id: string; tipo: string; titulo: string; descricao?: string | null;
  obrigatoria: boolean; imagem_url?: string | null; opcoes: string[]; config: ConfigPerg;
}

// Escalas de trabalho (enum posto_jornada do banco).
const ESCALAS_TRABALHO = ["12x36", "8 horas", "6 horas", "4 horas", "Escala 5x2", "Escala 6x1", "Outra"];
// Tipos aceitos como anexo do respondente (mesmo conjunto do editor).
const ACCEPT_ANEXO = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*";

const fmtDt = (s?: string | null) => { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
/** "24" horas vira "1 dia"; 36 vira "36 horas" - só arredonda o que é redondo. */
const fmtIntervalo = (h?: number | null) => {
  if (!h) return "período";
  if (h % 24 === 0) { const d = h / 24; return d === 1 ? "1 dia" : `${d} dias`; }
  return h === 1 ? "1 hora" : `${h} horas`;
};
/** Nome comparável (sem acento, sem caixa, sem espaço sobrando). */
const normNome = (s?: string | null) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 20px", boxShadow: "0 10px 30px rgba(15,23,42,.07)" };
const inp: React.CSSProperties = { border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", fontFamily: "inherit", width: "100%", background: "#fff" };

// Animações e micro-interações da página pública (auto-contido, sem libs).
function AnimStyles() {
  return <style>{`
    @keyframes fpFadeUp { from { opacity:0; transform: translateY(20px); } to { opacity:1; transform:none; } }
    @keyframes fpBlob { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(34px,-26px) scale(1.12); } 66% { transform: translate(-24px,22px) scale(.94); } }
    @keyframes fpCheck { to { stroke-dashoffset: 0; } }
    @keyframes fpShimmer { 0% { transform: translateX(-130%); } 100% { transform: translateX(260%); } }
    @keyframes fpSpin { to { transform: rotate(360deg); } }
    @keyframes fpFloatY { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-20px) rotate(4deg); } }
    @keyframes fpRise { 0% { transform: translateY(0) scale(.5); opacity:0; } 12% { opacity:.45; } 88% { opacity:.45; } 100% { transform: translateY(-105vh) scale(1); opacity:0; } }
    .fp-bg { background: radial-gradient(1200px 600px at 15% -10%, #e7efff 0%, transparent 55%), radial-gradient(1000px 500px at 100% 0%, #eef2ff 0%, transparent 50%), #eef2fb; position: relative; }
    .fp-blob { position: fixed; border-radius: 50%; filter: blur(64px); opacity:.45; z-index:0; pointer-events:none; animation: fpBlob 20s ease-in-out infinite; }
    .fp-side { position: fixed; top: 34%; width: 108px; opacity:.07; z-index:0; pointer-events:none; user-select:none; animation: fpFloatY 9s ease-in-out infinite; }
    .fp-side-l { left: 2.5%; }
    .fp-side-r { right: 2.5%; animation-delay: -4.5s; }
    .fp-particle { position: fixed; bottom: -12px; border-radius: 50%; opacity:0; z-index:0; pointer-events:none; background: radial-gradient(circle at 30% 30%, #f59e0b, #0f3171); animation: fpRise linear infinite; }
    @media (max-width: 920px) { .fp-side { display:none; } }
    .fp-scope { position: relative; z-index: 1; }
    .fp-in { opacity:0; animation: fpFadeUp .6s cubic-bezier(.22,1,.36,1) forwards; }
    .fp-card-h { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
    .fp-card-h:hover { transform: translateY(-3px); box-shadow: 0 18px 40px rgba(15,23,42,.12); border-color: #c7d2fe; }
    /* Card com autocomplete aberto sobe acima dos vizinhos e não faz o hover-lift
       (senão a lista de sugestões fica atrás do card seguinte). */
    .fp-card-h:has(.fp-open) { position: relative; z-index: 40; }
    .fp-card-h:has(.fp-open):hover { transform: none; }
    .fp-scope input:not([type=radio]):not([type=checkbox]):focus, .fp-scope textarea:focus, .fp-scope select:focus { border-color:#0f3171 !important; box-shadow: 0 0 0 4px rgba(15,49,113,.13); }
    .fp-scope input, .fp-scope textarea, .fp-scope select { transition: border-color .18s ease, box-shadow .18s ease; }
    .fp-submit { position: relative; overflow: hidden; transition: transform .2s ease, box-shadow .2s ease, filter .2s ease; }
    .fp-submit:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(15,49,113,.42); filter: brightness(1.07); }
    .fp-submit:not(:disabled):active { transform: translateY(0); }
    .fp-submit::after { content:""; position:absolute; top:0; left:0; width:38%; height:100%; background: linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent); transform: translateX(-130%); }
    .fp-submit:not(:disabled):hover::after { animation: fpShimmer 1s ease; }
    .fp-scale-btn { transition: transform .15s ease, background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease; }
    .fp-scale-btn:hover { transform: translateY(-3px); box-shadow: 0 8px 18px rgba(15,49,113,.18); }
    .fp-spin { animation: fpSpin .8s linear infinite; display:inline-block; }
    /* Pergunta "colegas": tabela no desktop, cartões empilhados no celular. */
    /* setor · colega · avaliação · comentário · lixeira */
    .fp-cg { --cg: minmax(130px,1fr) minmax(170px,1.35fr) auto minmax(170px,1.4fr) 26px; }
    .fp-cg-head { display:grid; grid-template-columns: var(--cg); gap:10px; align-items:end; padding-bottom:7px; border-bottom:1px solid #e2e8f0; }
    .fp-cg-th { font-size:11px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:.4px; }
    .fp-cg-row { display:grid; grid-template-columns: var(--cg); gap:10px; align-items:start; padding:11px 0; border-bottom:1px solid #f1f5f9; }
    .fp-cg-lbl { display:none; }
    .fp-star { transition: transform .12s ease; }
    .fp-cg button:hover .fp-star { transform: scale(1.18); }
    @media (max-width: 760px) {
      .fp-cg-head { display:none; }
      .fp-cg-row { grid-template-columns: 1fr; gap:9px; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:10px; }
      .fp-cg-lbl { display:block; font-size:10.5px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.4px; margin-bottom:4px; }
    }
    @media (prefers-reduced-motion: reduce) { .fp-in,.fp-blob,.fp-side,.fp-particle,.fp-submit::after { animation: none !important; } .fp-in { opacity:1 !important; } .fp-particle { display:none; } }
  `}</style>;
}

// Fundo decorativo: manchas suaves, partículas subindo e a logo Nascimento
// de cada lado com uma leve flutuação. Tudo pointer-events:none e z-index 0.
function Blobs() {
  const particulas = [
    { left: "6%", size: 9, dur: "13s", delay: "0s" },
    { left: "20%", size: 6, dur: "17s", delay: "3s" },
    { left: "38%", size: 11, dur: "15s", delay: "6s" },
    { left: "58%", size: 7, dur: "19s", delay: "2s" },
    { left: "74%", size: 9, dur: "14s", delay: "8s" },
    { left: "90%", size: 6, dur: "18s", delay: "5s" },
  ];
  return (
    <>
      <div className="fp-blob" style={{ width: 340, height: 340, background: "#bfdbfe", top: "6%", left: "8%" }} />
      <div className="fp-blob" style={{ width: 300, height: 300, background: "#ddd6fe", bottom: "6%", right: "8%", animationDelay: "-7s" }} />
      <img src={logoNascimento} alt="" className="fp-side fp-side-l" />
      <img src={logoNascimento} alt="" className="fp-side fp-side-r" />
      {particulas.map((p, i) => (
        <span key={i} className="fp-particle" style={{ left: p.left, width: p.size, height: p.size, animationDuration: p.dur, animationDelay: p.delay }} />
      ))}
    </>
  );
}

function Aviso({ emoji, titulo, texto, acao, children }: {
  emoji: string; titulo: string; texto: string;
  acao?: { rotulo: string; href: string }; children?: React.ReactNode;
}) {
  return (
    <div className="fp-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "hidden" }}>
      <AnimStyles /><Blobs />
      <div className="fp-in fp-scope" style={{ ...card, maxWidth: 460, textAlign: "center", padding: "32px 26px" }}>
        <div style={{ fontSize: 44 }}>{emoji}</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#0f172a", marginTop: 10 }}>{titulo}</div>
        <div style={{ fontSize: 13.5, color: "#64748b", marginTop: 6, lineHeight: 1.6 }}>{texto}</div>
        {children}
        {acao && (
          <a href={acao.href} className="fp-submit" style={{ display: "inline-block", marginTop: 16, padding: "11px 20px", borderRadius: 11, background: "#0f3171", color: "#fff", fontSize: 14, fontWeight: 800, textDecoration: "none" }}>
            {acao.rotulo}
          </a>
        )}
      </div>
    </div>
  );
}

function SuccessScreen() {
  return (
    <div className="fp-bg" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "hidden" }}>
      <AnimStyles /><Blobs />
      <div className="fp-in fp-scope" style={{ ...card, maxWidth: 460, textAlign: "center", padding: "38px 28px" }}>
        <svg width="86" height="86" viewBox="0 0 52 52" style={{ display: "block", margin: "0 auto" }}>
          <circle cx="26" cy="26" r="24" fill="none" stroke="#16a34a" strokeWidth="3"
            style={{ strokeDasharray: 151, strokeDashoffset: 151, animation: "fpCheck .7s cubic-bezier(.65,0,.45,1) forwards" }} />
          <path d="M15 27 l7.5 7.5 L38 18" fill="none" stroke="#16a34a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
            style={{ strokeDasharray: 48, strokeDashoffset: 48, animation: "fpCheck .5s .55s cubic-bezier(.65,0,.45,1) forwards" }} />
        </svg>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 16 }}>Resposta enviada!</div>
        <div style={{ fontSize: 14, color: "#64748b", marginTop: 8, lineHeight: 1.6 }}>Muito obrigado por responder. 💙<br />Você já pode fechar esta página.</div>
        <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 22 }}>Nascimento Formulários · Grupo Nascimento</div>
      </div>
    </div>
  );
}

// Pergunta "contrato": escolhe um contrato ativo, ou vários quando a pergunta
// foi marcada com `config.multiplos`.
//
// Lê public.contratos direto, pedindo só id/nome/cliente — o PostgREST faz a
// projeção no servidor, então as colunas fiscais (issqn_pct, conta_pagamento,
// email_envio_nf...) não chegam ao navegador.
//
// A RLS da tabela manda no resto: SELECT só para authenticated e ainda
// recortado por empresa_id ∈ user_empresa do usuário. Consequência a conhecer
// — no formulário PÚBLICO (anon) a lista vem vazia, e um usuário sem empresa
// vinculada também não vê nada. Não é erro de consulta; é a policy.
//
// Valor gravado = o NOME do contrato (lista de nomes quando múltiplo), igual
// ao que a pergunta "colaborador" faz — mantém Respostas e painéis legíveis
// sem precisar resolver id.
//
// A primeira opção é sempre "ADMINISTRATIVO", pra quem responde não está
// lotado em contrato nenhum (escritório/sede). Ela é sintética, do formulário
// — de propósito NÃO existe como linha em `contratos`: aquela tabela é do
// Suprimentos/Financeiro e um registro falso lá apareceria em emissão de NF,
// malote e planilha de custo. Como o valor gravado é o nome, "ADMINISTRATIVO"
// chega em Respostas igual a qualquer outro.
/** O que a pergunta usa de um contrato — o resto das colunas nem é lido. */
type OpcaoContrato = { id: string; nome: string; cliente: string | null };

const CONTRATO_ADMINISTRATIVO: OpcaoContrato =
  { id: "__administrativo__", nome: "ADMINISTRATIVO", cliente: null };

// `contratos` NÃO está no types.ts gerado pelo Lovable, então o client tipado
// trata a tabela como inexistente e reclama de toda coluna ("id" não é
// atribuível a never). Mesmo escape do useContratosERP, só que pelo tipo do
// próprio SDK em vez de `as any` — o client continua o mesmo, o que cai é só
// o conhecimento do schema.
const sbSemSchema = supabase as unknown as SupabaseClient;

function ContratoSelect({ value, multiplos, onChange }: {
  value: string | string[] | null;
  multiplos: boolean;
  onChange: (v: string | string[]) => void;
}) {
  const [contratos, setContratos] = useState<OpcaoContrato[]>([]);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await sbSemSchema
        .from("contratos")
        .select("id,nome,cliente")
        .eq("status", "ativo")
        .order("nome");
      if (error) { setEstado("erro"); return; }
      // Deduplica por nome: a resposta gravada é o nome e a marcação compara
      // por nome, então dois contratos homônimos ficariam marcados juntos.
      const vistos = new Set<string>();
      setContratos((data ?? [])
        .map((r): OpcaoContrato => ({ id: String(r.id), nome: String(r.nome ?? "").trim(), cliente: r.cliente ?? null }))
        .filter((c) => c.nome && !vistos.has(c.nome) && vistos.add(c.nome)));
      setEstado("ok");
    })();
  }, []);

  if (estado === "carregando") return <div style={{ fontSize: 13, color: "#94a3b8" }}>Carregando contratos…</div>;
  if (estado === "erro") return <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 700 }}>Não foi possível carregar os contratos.</div>;
  if (contratos.length === 0) return <div style={{ fontSize: 13, color: "#94a3b8" }}>Nenhum contrato disponível para o seu acesso.</div>;

  // ADMINISTRATIVO na frente da lista. O filtro evita duplicar caso um dia
  // exista um contrato ativo com esse mesmo nome (a resposta é o nome, então
  // dois itens homônimos marcariam junto — mesmo motivo da dedup lá em cima).
  const opcoes = [
    CONTRATO_ADMINISTRATIVO,
    ...contratos.filter(c => c.nome.toUpperCase() !== CONTRATO_ADMINISTRATIVO.nome),
  ];

  // Um só: select nativo. São poucas dezenas de contratos ativos, então não
  // precisa de busca — e o nativo já é acessível e funciona bem no celular.
  if (!multiplos) {
    return (
      <select value={value ?? ""} onChange={e => onChange(e.target.value)} style={{ ...inp, maxWidth: 420 }}>
        <option value="">Selecione o contrato…</option>
        {opcoes.map(c => <option key={c.id} value={c.nome}>{c.cliente ? `${c.nome} · ${c.cliente}` : c.nome}</option>)}
      </select>
    );
  }

  const sel: string[] = Array.isArray(value) ? value : [];
  const termo = busca.trim().toLowerCase();
  const lista = termo ? opcoes.filter(c => `${c.nome} ${c.cliente ?? ""}`.toLowerCase().includes(termo)) : opcoes;
  const alterna = (nome: string) =>
    onChange(sel.includes(nome) ? sel.filter(x => x !== nome) : [...sel, nome]);

  return (
    <div style={{ maxWidth: 480 }}>
      {sel.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {sel.map(nome => (
            <span key={nome} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eff6ff", border: "1px solid #dbeafe", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
              {nome}
              <button type="button" onClick={() => alterna(nome)} aria-label={`Remover ${nome}`}
                style={{ border: "none", background: "transparent", color: "#1d4ed8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Filtrar contratos…" style={{ ...inp, marginBottom: 6 }} />
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, maxHeight: 240, overflowY: "auto", background: "#fff" }}>
        {lista.length === 0 && <div style={{ padding: "8px 11px", fontSize: 12, color: "#94a3b8" }}>Nenhum contrato encontrado.</div>}
        {lista.map(c => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={sel.includes(c.nome)} onChange={() => alterna(c.nome)} style={{ width: 15, height: 15, flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 700, color: "#0f172a" }}>{c.nome}</span>
              {c.cliente && <span style={{ color: "#94a3b8" }}> · {c.cliente}</span>}
            </span>
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 5 }}>
        {sel.length === 0 ? "Marque um ou mais contratos." : `${sel.length} contrato${sel.length > 1 ? "s" : ""} selecionado${sel.length > 1 ? "s" : ""}.`}
      </div>
    </div>
  );
}

// Pergunta "colaborador": busca no EMPREGADOS por nome (acha qualquer um);
// exclui SÓ quem tem Situacao demitido. Valor da resposta = o nome escolhido.
function ColaboradorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<{ id: number; nome: string; setor?: string; cargo?: string }[]>([]);
  const [aberto, setAberto] = useState(false);
  // Cada busca ganha um número crescente; quando a resposta volta, só aplica se
  // ainda for a última disparada. Sem isso a consulta SEM filtro do onFocus
  // (a maior/mais lenta) chegava DEPOIS da consulta filtrada e sobrescrevia o
  // resultado — o campo mostrava "pablo" mas a lista trazia a fila alfabética.
  const seq = useRef(0);
  const buscar = async (texto: string) => {
    setBusca(texto); setAberto(true);
    const meu = ++seq.current;
    const termo = texto.trim();
    // Rota pública (sem login) — usa a view sem colunas sensíveis (sem CPF/
    // salário/PIS). A tabela EMPREGADOS completa exige acesso por menu (ver
    // migration 20260717190010) e não é lida por anon, então NÃO usar aqui.
    let query = (supabase as any).from("VW_EMPREGADOS_BASICO")
      .select('"ID","Nome","Setor_ERP","Título do Cargo","Situação"')
      .order('"Nome"').limit(40);
    // Busca por PALAVRA: cada palavra (≥2 letras) precisa aparecer no nome, em
    // qualquer ordem — "helena nasciment" acha "HELENA SILVA NASCIMENTO".
    if (termo.length >= 2) {
      const palavras = termo.split(/\s+/).map(w => w.replace(/[%_\\]/g, "")).filter(w => w.length >= 2);
      for (const w of palavras) query = query.ilike("Nome", `%${w}%`);
    }
    const { data } = await query;
    if (meu !== seq.current) return;  // chegou uma busca mais nova primeiro — descarta esta
    setResultados((data ?? [])
      .filter((r: any) => !/demitid/i.test(String(r["Situação"] ?? "")))  // só demitido fica de fora
      .map((r: any) => ({ id: r["ID"], nome: r["Nome"] ?? "", setor: r["Setor_ERP"], cargo: r["Título do Cargo"] }))
      .filter((x: any) => x.nome));
  };
  return (
    <div className={aberto ? "fp-open" : undefined} style={{ position: "relative", maxWidth: 420, zIndex: aberto ? 40 : "auto" }}>
      <input value={aberto ? busca : (value || "")} onFocus={() => buscar("")} onBlur={() => setTimeout(() => setAberto(false), 150)} onChange={e => buscar(e.target.value)}
        placeholder="Digite o nome do colaborador..." style={inp} />
      {aberto && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginTop: 4, boxShadow: "0 12px 28px rgba(15,23,42,.14)", zIndex: 40, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
          {resultados.length === 0 && <div style={{ padding: "8px 11px", fontSize: 12, color: "#94a3b8" }}>{busca.trim().length < 2 ? "Digite ao menos 2 letras..." : "Nenhum colaborador encontrado."}</div>}
          {resultados.map(r => (
            <div key={r.id} onMouseDown={() => { onChange(r.nome); setAberto(false); }} style={{ padding: "8px 11px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{r.nome}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{[r.setor, r.cargo].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Pergunta "colegas": uma linha por colega indicado — colega + setor +
// nota + comentário. As regras vêm da config da pergunta (min/max, 1 por
// setor, não pode ser você) e são as MESMAS que o trigger do banco aplica
// no INSERT: aqui elas guiam, lá elas decidem.
// =====================================================================
interface LinhaColega { colaborador?: string; setor?: string; nota?: number | null; comentario?: string }

/** Linhas efetivamente preenchidas (a que tem colega escolhido). */
const linhasColegas = (v: any): LinhaColega[] =>
  (Array.isArray(v) ? v : []).filter((l: any) => l && String(l?.colaborador ?? "").trim() !== "");

/** Pergunta respondida? A de colegas conta LINHAS preenchidas — o array dela
 *  nasce com linhas em branco na tela e "tem array" não quer dizer respondida. */
const respondida = (p: { tipo: string }, v: any) =>
  p.tipo === "colegas"
    ? linhasColegas(v).length > 0
    : !(v == null || v === "" || (Array.isArray(v) && v.length === 0));

/** Setores do cadastro (RPC cs_form_setores). Uma carga por sessão.
 *
 *  Por que RPC e não ler a view: o DISTINCT tem que sair do BANCO. Lendo a
 *  VW_EMPREGADOS_BASICO e distinguindo aqui, o PostgREST cortava a resposta
 *  (max-rows) e, como um setor sozinho tem centenas de pessoas, sobravam 6
 *  dos 14 setores — os pequenos (SISTEMAS, JURIDICO, SST…) sumiam da lista. */
let setoresPromise: Promise<string[]> | null = null;
const carregarSetores = (): Promise<string[]> => {
  if (!setoresPromise) setoresPromise = (async () => {
    const { data, error } = await (supabase as any).rpc("cs_form_setores");
    if (!error && Array.isArray(data)) return data.map((r: any) => String(r.setor ?? "").trim()).filter(Boolean);
    // Banco sem a RPC ainda: volta pro jeito antigo (sujeito ao corte acima).
    const { data: linhas } = await (supabase as any).from("VW_EMPREGADOS_BASICO").select('"Setor_ERP","Situação"').limit(20000);
    const set = new Set<string>();
    (linhas ?? []).forEach((r: any) => {
      if (/demitid/i.test(String(r["Situação"] ?? ""))) return;
      const s = String(r["Setor_ERP"] ?? "").trim();
      if (s) set.add(s);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  })().catch(() => []);
  return setoresPromise;
};

/** Colegas de um setor (RPC cs_form_colegas). Cache por setor — trocar de
 *  linha ou reabrir o mesmo setor não bate no banco de novo. */
export interface Colega { id: number; nome: string; setor: string; cargo: string }
const colegasCache = new Map<string, Promise<Colega[]>>();
const carregarColegas = (setor: string): Promise<Colega[]> => {
  const chave = normNome(setor);
  let p = colegasCache.get(chave);
  if (!p) {
    p = (async () => {
      const { data, error } = await (supabase as any).rpc("cs_form_colegas", { _setor: setor });
      if (!error && Array.isArray(data)) {
        return data.map((r: any) => ({ id: Number(r.id), nome: String(r.nome ?? "").trim(), setor: String(r.setor ?? "").trim(), cargo: String(r.cargo ?? "").trim() }))
          .filter((c: Colega) => c.nome);
      }
      // Banco sem a RPC: lê a view filtrando pelo setor (resultado pequeno).
      const { data: linhas } = await (supabase as any).from("VW_EMPREGADOS_BASICO")
        .select('"ID","Nome","Setor_ERP","Título do Cargo","Situação"').eq("Setor_ERP", setor).order('"Nome"').limit(1000);
      return (linhas ?? [])
        .filter((r: any) => !/demitid/i.test(String(r["Situação"] ?? "")))
        .map((r: any) => ({ id: Number(r["ID"]), nome: String(r["Nome"] ?? "").trim(), setor: String(r["Setor_ERP"] ?? "").trim(), cargo: String(r["Título do Cargo"] ?? "").trim() }))
        .filter((c: Colega) => c.nome);
    })().catch(() => [] as Colega[]);
    colegasCache.set(chave, p);
  }
  return p;
};

/** Lista de colegas DO SETOR escolhido. O setor vem primeiro justamente para
 *  esta lista existir: sem ele não há quem listar. Já sai com os vetos —
 *  fora o próprio respondente e quem foi indicado em outra linha. */
function ColegaSelect({ value, setor, vetados, onChange }: {
  value: string; setor: string; vetados: Set<string>;
  onChange: (nome: string) => void;
}) {
  const [colegas, setColegas] = useState<Colega[] | null>(null);

  useEffect(() => {
    if (!setor) { setColegas(null); return; }
    let vivo = true;
    setColegas(null);
    carregarColegas(setor).then(cs => { if (vivo) setColegas(cs); });
    return () => { vivo = false; };
  }, [setor]);

  const disponiveis = (colegas ?? []).filter(c => !vetados.has(normNome(c.nome)) || normNome(c.nome) === normNome(value));
  const carregando = !!setor && colegas === null;

  return (
    <select value={value || ""} disabled={!setor || carregando} onChange={e => onChange(e.target.value)}
      style={{ ...inp, padding: "9px 11px", fontSize: 13.5, background: setor ? "#fff" : "#f8fafc", color: setor ? "#0f172a" : "#94a3b8" }}>
      <option value="">
        {!setor ? "Escolha o setor primeiro…"
          : carregando ? "Carregando colegas…"
            : disponiveis.length === 0 ? "Nenhum colega disponível neste setor"
              : "Selecione um colega…"}
      </option>
      {disponiveis.map(c => (
        <option key={c.id} value={c.nome}>{c.cargo ? `${c.nome} — ${c.cargo}` : c.nome}</option>
      ))}
    </select>
  );
}

/** Estrelas de 1 a `max`. Clicar na nota já marcada limpa (dá p/ desfazer). */
function Estrelas({ nota, max, onChange }: { nota?: number | null; max: number; onChange: (n: number | null) => void }) {
  const ns: number[] = []; for (let n = 1; n <= max; n++) ns.push(n);
  return (
    <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      {ns.map(n => {
        const on = (nota ?? 0) >= n;
        return (
          <button key={n} type="button" onClick={() => onChange(nota === n ? null : n)} title={`Nota ${n}`}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
            <span className="fp-star" style={{ fontSize: 21, color: on ? "#f59e0b" : "#cbd5e1" }}>{on ? "★" : "☆"}</span>
            <span style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 1 }}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function ColegasGrid({ p, valor, onChange, meuNome }: {
  p: Perg; valor: any; onChange: (linhas: LinhaColega[]) => void; meuNome: string;
}) {
  const [setores, setSetores] = useState<string[]>([]);
  useEffect(() => { let vivo = true; carregarSetores().then(s => { if (vivo) setSetores(s); }); return () => { vivo = false; }; }, []);

  const cfg = p.config ?? {};
  const escalaMax = Math.max(2, Number(cfg.escala_max ?? 5));
  const min = Math.max(0, Number(cfg.min_colegas ?? 0));
  const max = Math.max(0, Number(cfg.max_colegas ?? 0));
  const umPorSetor = !!cfg.setores_distintos;
  const excluirProprio = cfg.excluir_proprio !== false;
  const rotComentario = cfg.comentario_rotulo || "Comentário";
  const descComentario = cfg.comentario_desc || "";
  const phComentario = cfg.comentario_placeholder || "Escreva aqui (opcional)…";

  // Sempre pelo menos 1 linha na tela (e o mínimo pedido, quando houver).
  const guardadas: LinhaColega[] = Array.isArray(valor) ? valor : [];
  const linhas = guardadas.length ? guardadas : Array.from({ length: Math.max(1, min) }, () => ({} as LinhaColega));

  const mudaLinha = (i: number, patch: Partial<LinhaColega>) =>
    onChange(linhas.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLinha = (i: number) => {
    const restante = linhas.filter((_, j) => j !== i);
    onChange(restante.length ? restante : [{}]);
  };
  const addLinha = () => onChange([...linhas, {}]);

  const preenchidas = linhasColegas(linhas).length;
  const noTeto = max > 0 && linhas.length >= max;

  return (
    <div className="fp-cg">
      <div className="fp-cg-head">
        {/* Setor primeiro: é ele que define de quem é a lista de colegas. */}
        <span className="fp-cg-th">Setor</span>
        <span className="fp-cg-th">Colega</span>
        <span className="fp-cg-th">
          Avaliação
          {(cfg.rotulo_min || cfg.rotulo_max) && (
            <span style={{ display: "block", fontWeight: 500, color: "#94a3b8", textTransform: "none", letterSpacing: 0, fontSize: 10.5 }}>
              1 ({cfg.rotulo_min || "baixo"}) a {escalaMax} ({cfg.rotulo_max || "excelente"})
            </span>
          )}
        </span>
        <span className="fp-cg-th">
          {rotComentario} {!cfg.comentario_obrigatorio && <span style={{ fontWeight: 500, color: "#94a3b8" }}>(opcional)</span>}
          {descComentario && <span style={{ display: "block", fontWeight: 500, color: "#94a3b8", textTransform: "none", letterSpacing: 0, fontSize: 10.5 }}>{descComentario}</span>}
        </span>
        <span />
      </div>

      {linhas.map((l, i) => {
        // Vetos desta linha: eu mesmo, os colegas já escolhidos nas outras
        // linhas e, com "1 por setor", os setores que as outras já ocuparam.
        const vetados = new Set<string>();
        if (excluirProprio && meuNome) vetados.add(normNome(meuNome));
        linhas.forEach((o, j) => { if (j !== i && o.colaborador) vetados.add(normNome(o.colaborador)); });
        const setoresVetados = new Set<string>();
        if (umPorSetor) linhas.forEach((o, j) => { if (j !== i && o.setor) setoresVetados.add(normNome(o.setor)); });
        const setoresLivres = setores.filter(s => !setoresVetados.has(normNome(s)));
        return (
          <div key={i} className="fp-cg-row">
            <div>
              <span className="fp-cg-lbl">Setor</span>
              <select value={l.setor ?? ""}
                onChange={e => {
                  // Trocar o setor limpa o colega: ele era de outro setor.
                  mudaLinha(i, { setor: e.target.value, colaborador: "" });
                }}
                style={{ ...inp, padding: "9px 11px", fontSize: 13.5 }}>
                <option value="">{setores.length ? "Selecione o setor…" : "Carregando setores…"}</option>
                {/* o setor já escolhido nesta linha continua na lista (senão o
                    próprio veto de "1 por setor" apagaria a escolha dela) */}
                {[...new Set([...(l.setor ? [l.setor] : []), ...setoresLivres])]
                  .sort((a, b) => a.localeCompare(b, "pt-BR"))
                  .map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <span className="fp-cg-lbl">Colega</span>
              <ColegaSelect value={l.colaborador ?? ""} setor={l.setor ?? ""} vetados={vetados}
                onChange={nome => mudaLinha(i, { colaborador: nome })} />
            </div>
            <div>
              <span className="fp-cg-lbl">Avaliação</span>
              <Estrelas nota={l.nota} max={escalaMax} onChange={n => mudaLinha(i, { nota: n })} />
            </div>
            <div>
              <span className="fp-cg-lbl">{rotComentario}</span>
              <textarea value={l.comentario ?? ""} onChange={e => mudaLinha(i, { comentario: e.target.value })}
                rows={2} placeholder={phComentario} style={{ ...inp, padding: "8px 10px", fontSize: 13, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => removeLinha(i)} title="Remover esta linha"
                style={{ background: "none", border: "none", color: "#dc2626", fontSize: 16, cursor: "pointer", padding: 4 }}>🗑</button>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" onClick={addLinha} disabled={noTeto}
          style={{ padding: "8px 14px", borderRadius: 10, border: "1px dashed #93c5fd", background: noTeto ? "#f8fafc" : "#f0f7ff", color: noTeto ? "#cbd5e1" : "#0f3171", fontSize: 12.5, fontWeight: 700, cursor: noTeto ? "default" : "pointer" }}>
          + Adicionar outro colega
        </button>
        <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
          {preenchidas} indicado(s){min ? ` · mínimo ${min}` : ""}{max ? ` · máximo ${max}` : ""}
        </span>
      </div>

      {(umPorSetor || (excluirProprio && meuNome)) && (
        <div style={{ fontSize: 11.5, color: "#0369a1", background: "#f0f7ff", border: "1px solid #dbeafe", borderRadius: 9, padding: "7px 10px", marginTop: 8 }}>
          ℹ️ {[umPorSetor ? "Cada setor pode receber apenas 1 indicação" : "", excluirProprio && meuNome ? "você não aparece na lista" : ""].filter(Boolean).join(" · ")}.
        </div>
      )}
    </div>
  );
}

export default function FormularioPublico() {
  const { slug } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { empregado, loading: vinculoLoading } = useVinculoEmpregado();  // cadastro do respondente logado (null se anônimo)
  const abertoEm = useRef(Date.now());  // p/ tempo de conclusão
  // Porta: metadados de segurança que o anon pode ver antes de entrar.
  const [porta, setPorta] = useState<{ existe: boolean; seguranca?: string; exige_senha?: boolean; publicado?: boolean } | null>(null);
  const [podeResponder, setPodeResponder] = useState<boolean | null>(null); // veredito do banco (cs_form_alvo)
  const [senhaOk, setSenhaOk] = useState(false);
  const [senhaTxt, setSenhaTxt] = useState("");
  const [senhaErro, setSenhaErro] = useState("");
  const [conferindo, setConferindo] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [pergs, setPergs] = useState<Perg[]>([]);
  const [loading, setLoading] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [valores, setValores] = useState<Record<string, any>>({});
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  // "Outro": quando o respondente escolhe Outro, descreve num texto livre.
  const [outroOn, setOutroOn] = useState<Record<string, boolean>>({});
  const [outroTxt, setOutroTxt] = useState<Record<string, string>>({});
  const [faltando, setFaltando] = useState<Set<string>>(new Set());  // obrigatórias vazias no envio
  const [anexando, setAnexando] = useState<Record<string, boolean>>({});  // upload de anexo em curso
  const [anonimo, setAnonimo] = useState(false);   // escolha do respondente (só se o form permite)
  // Intervalo entre respostas (cs_form_prazo): quando já respondeu há pouco, a
  // tela explica quando libera - a trava de verdade é a policy de INSERT.
  const [prazo, setPrazo] = useState<{ pode: boolean; proxima_em?: string | null; intervalo_horas?: number | null } | null>(null);

  // Upload de anexo do respondente (bucket cs-formularios; anon liberado pela
  // migration). Devolve a URL pública ou null (com aviso).
  const MAX_ANEXO = 25 * 1024 * 1024;
  const uploadResp = async (pid: string, file: File) => {
    if (file.size > MAX_ANEXO) { setErro(`O anexo "${file.name}" passa de 25MB. Envie um arquivo menor.`); return; }
    setAnexando(x => ({ ...x, [pid]: true }));
    const ext = (file.name.split(".").pop() || "dat").toLowerCase();
    const path = `${form?.id ?? "geral"}/resp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from("cs-formularios").upload(path, file, { upsert: false });
    setAnexando(x => ({ ...x, [pid]: false }));
    if (error) { setErro("Não foi possível anexar o arquivo: " + error.message); return; }
    const url = supabase.storage.from("cs-formularios").getPublicUrl(path).data.publicUrl;
    setValores(x => ({ ...x, [`${pid}__anexo`]: url, [`${pid}__anexo_nome`]: file.name }));
    setErro("");
  };
  const removerAnexo = (pid: string) => setValores(x => { const n = { ...x }; delete n[`${pid}__anexo`]; delete n[`${pid}__anexo_nome`]; return n; });

  const load = useCallback(async () => {
    if (authLoading) return;
    setLoading(true);

    // 1. Portaria (SECURITY DEFINER): existe? é restrito? pede senha? Sem isto
    //    um restrito daria "não encontrado" pro anon, em vez de mandar ao login.
    let p: any = null;
    try { ({ data: p } = await (supabase as any).rpc("cs_form_porta", { _slug: slug })); } catch { /* banco antigo */ }
    // Banco sem a RPC ainda: segue o fluxo antigo (tudo liberado).
    const pt = p ?? { existe: true, seguranca: "liberado", exige_senha: false, publicado: true };
    setPorta(pt);
    if (!pt.existe) { setLoading(false); setNaoEncontrado(true); return; }

    // 2. Restrito sem login: para aqui, a tela manda entrar no ERP.
    if (pt.seguranca === "restrito" && !user) { setLoading(false); return; }

    // 3. Lê o formulário (a RLS entrega: liberado p/ anon, e logado p/ quem tem
    //    a visibilidade de gestão).
    const { data: f } = await (supabase as any).from("CS_FORMULARIOS").select("*").eq("slug", slug).maybeSingle();
    if (!f) { setLoading(false); setNaoEncontrado(true); return; }
    setForm(f);
    setPergs((Array.isArray(f.perguntas) ? f.perguntas : []).map((p2: any) => ({ ...p2, opcoes: Array.isArray(p2.opcoes) ? p2.opcoes : [], config: p2.config ?? {} })));

    // 4. Veredito de acesso e senha: as MESMAS funções que a policy de INSERT
    //    usa — a tela nunca promete o que o banco vai negar.
    if (pt.seguranca === "restrito") {
      try {
        const { data: ok } = await (supabase as any).rpc("cs_form_alvo", { _form_id: f.id });
        setPodeResponder(ok !== false);
      } catch { setPodeResponder(true); }
      if (pt.exige_senha) {
        try {
          const { data: sok } = await (supabase as any).rpc("cs_form_senha_ok", { _form_id: f.id });
          setSenhaOk(sok === true);
        } catch { setSenhaOk(false); }
      } else setSenhaOk(true);
    } else { setPodeResponder(true); setSenhaOk(true); }

    // 5. Intervalo entre respostas: só faz sentido para quem está logado (é o
    //    login que identifica quem já respondeu). Banco antigo sem a RPC =
    //    segue sem limite.
    if (user) {
      try {
        const { data: pz } = await (supabase as any).rpc("cs_form_prazo", { _form_id: f.id });
        setPrazo(pz ?? null);
      } catch { setPrazo(null); }
    } else setPrazo(null);
    setLoading(false);
  }, [slug, user, authLoading]);
  useEffect(() => { load(); }, [load]);

  const conferirSenha = async () => {
    if (!senhaTxt.trim()) return;
    setConferindo(true); setSenhaErro("");
    const { data, error } = await (supabase as any).rpc("cs_form_conferir_senha", { _slug: slug, _senha: senhaTxt });
    setConferindo(false);
    if (error) { setSenhaErro("Erro ao conferir: " + error.message); return; }
    if (data === true) { setSenhaOk(true); setSenhaTxt(""); } else setSenhaErro("Senha incorreta.");
  };

  if (loading || vinculoLoading || authLoading) return <Aviso emoji="⏳" titulo="Carregando..." texto="Um instante." />;

  // Restrito e sem login: manda entrar e volta direto pra cá (?next=).
  if (porta?.existe && porta.seguranca === "restrito" && !user) {
    const next = encodeURIComponent(`/formularios/${slug}`);
    return (
      <Aviso emoji="🔒" titulo="Formulário restrito"
        texto="Este formulário é só para usuários do ERP. Entre com o seu usuário — você volta direto pra cá."
        acao={{ rotulo: "Entrar no ERP →", href: `/login?next=${next}` }} />
    );
  }
  if (naoEncontrado || !form) return <Aviso emoji="🔍" titulo="Formulário não encontrado" texto="O link pode estar errado ou o formulário não está mais disponível." />;

  const now = Date.now();
  if (form.inicia_em && now < +new Date(form.inicia_em))
    return <Aviso emoji="🗓" titulo="Ainda não abriu" texto={`Este formulário abre em ${fmtDt(form.inicia_em)}. Volte depois!`} />;
  if (form.encerra_em && now > +new Date(form.encerra_em))
    return <Aviso emoji="⛔" titulo="Formulário encerrado" texto={`O prazo para responder terminou em ${fmtDt(form.encerra_em)}.`} />;
  // Público-alvo: veredito do banco (cs_form_alvo) — o mesmo que a policy de
  // INSERT aplica. Aqui é só p/ explicar; a trava de verdade é a RLS.
  if (podeResponder === false) {
    const st = form.setores_acesso ?? [];
    return <Aviso emoji="🔒" titulo="Sem acesso"
      texto={st.length
        ? `Este formulário é só para os setores: ${st.join(", ")} (ou pessoas escolhidas). O seu${empregado?.setor ? ` (${empregado.setor})` : ""} não está liberado.`
        : "Você não está na lista de quem pode responder este formulário."} />;
  }
  // Senha do formulário: já logado e no alvo, falta a senha.
  if (porta?.exige_senha && !senhaOk) {
    return (
      <Aviso emoji="🔑" titulo="Este formulário pede uma senha"
        texto="Peça a senha a quem te enviou o formulário.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          <input type="password" autoFocus value={senhaTxt} onChange={e => { setSenhaTxt(e.target.value); setSenhaErro(""); }}
            onKeyDown={e => { if (e.key === "Enter") conferirSenha(); }}
            placeholder="Senha do formulário" style={{ ...inp, textAlign: "center" }} />
          {senhaErro && <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 700 }}>{senhaErro}</div>}
          <button onClick={conferirSenha} disabled={conferindo || !senhaTxt.trim()}
            style={{ padding: "11px 16px", borderRadius: 11, border: "none", cursor: conferindo || !senhaTxt.trim() ? "default" : "pointer", background: conferindo || !senhaTxt.trim() ? "#94a3b8" : "#0f3171", color: "#fff", fontSize: 14, fontWeight: 800 }}>
            {conferindo ? "Conferindo…" : "Abrir formulário"}
          </button>
        </div>
      </Aviso>
    );
  }
  // Já respondeu e o formulário tem intervalo mínimo: mostra quando libera.
  if (prazo && prazo.pode === false) {
    const quando = prazo.proxima_em ? fmtDt(prazo.proxima_em) : "";
    return <Aviso emoji="⏱" titulo="Você já respondeu este formulário"
      texto={quando
        ? `Este formulário aceita uma resposta a cada ${fmtIntervalo(prazo.intervalo_horas)}. Você poderá responder de novo a partir de ${quando}.`
        : `Este formulário aceita uma resposta a cada ${fmtIntervalo(prazo.intervalo_horas)}.`} />;
  }
  if (enviado) return <SuccessScreen />;

  const setVal = (pid: string, v: any) => {
    setValores(x => ({ ...x, [pid]: v }));
    setErro("");
    setFaltando(s => { if (!s.has(pid)) return s; const n = new Set(s); n.delete(pid); return n; });  // preencheu → tira o destaque
  };

  // Perguntas visíveis ao respondente: uma pergunta pode ser limitada a setores
  // (config.setores) e/ou a pessoas (config.pessoas = user_id do ERP), em UNIÃO.
  // Vazio nos dois = todos veem. Anônimo não passa em nenhuma das duas.
  const perguntaVisivel = (p: Perg) => {
    const s: string[] = Array.isArray(p.config?.setores) ? p.config.setores : [];
    const u: string[] = Array.isArray(p.config?.pessoas) ? p.config.pessoas : [];
    if (s.length === 0 && u.length === 0) return true;
    return (!!empregado && s.includes(empregado.setor)) || (!!user && u.includes(user.id));
  };
  const pergsVisiveis = pergs.filter(perguntaVisivel);

  // Erro da pergunta de colegas, na ordem em que a pessoa entende: primeiro o
  // que falta, depois o que está repetido. As mesmas regras rodam no banco -
  // aqui é para não deixar o envio falhar com a mensagem crua do Postgres.
  const erroColegas = (p: Perg): string | null => {
    const cfg = p.config ?? {};
    const linhas = linhasColegas(valores[p.id]);
    const min = Math.max(0, Number(cfg.min_colegas ?? 0));
    const max = Math.max(0, Number(cfg.max_colegas ?? 0));
    const nome0 = `"${p.titulo}"`;
    if (linhas.length < min) return `Em ${nome0}: indique pelo menos ${min} colega(s). Você indicou ${linhas.length}.`;
    if (max > 0 && linhas.length > max) return `Em ${nome0}: no máximo ${max} colega(s).`;
    if (cfg.excluir_proprio !== false && empregado?.nome && linhas.some(l => normNome(l.colaborador) === normNome(empregado.nome)))
      return `Em ${nome0}: você não pode indicar a si mesmo.`;
    const nomes = linhas.map(l => normNome(l.colaborador));
    const repetido = nomes.find((n, i) => nomes.indexOf(n) !== i);
    if (repetido) return `Em ${nome0}: ${linhas.find(l => normNome(l.colaborador) === repetido)?.colaborador} foi indicado(a) mais de uma vez.`;
    if (cfg.setores_distintos) {
      // Sem setor não dá para garantir "1 por setor" - aí ele passa a ser
      // obrigatório (fora dessa regra, colega sem setor no cadastro passa).
      const semSetor = linhas.find(l => !String(l.setor ?? "").trim());
      if (semSetor) return `Em ${nome0}: informe o setor de ${semSetor.colaborador}.`;
      const setores = linhas.map(l => normNome(l.setor));
      const set2 = setores.find((s, i) => setores.indexOf(s) !== i);
      if (set2) return `Em ${nome0}: só é possível indicar 1 colega por setor (${linhas.find(l => normNome(l.setor) === set2)?.setor} repetido).`;
    }
    if (cfg.nota_obrigatoria) {
      const semNota = linhas.find(l => l.nota == null);
      if (semNota) return `Em ${nome0}: dê uma nota para ${semNota.colaborador}.`;
    }
    if (cfg.comentario_obrigatorio) {
      const semCom = linhas.find(l => !String(l.comentario ?? "").trim());
      if (semCom) return `Em ${nome0}: escreva o comentário sobre ${semCom.colaborador}.`;
    }
    return null;
  };

  const enviar = async () => {
    // Junta TODAS as obrigatórias vazias p/ destacar de uma vez e levar à primeira.
    const faltantes = pergsVisiveis.filter(p => {
      if (p.tipo === "texto_info" || !p.obrigatoria) return false;
      return !respondida(p, valores[p.id]);
    });
    if (faltantes.length) {
      setFaltando(new Set(faltantes.map(p => p.id)));
      setErro("Você precisa responder todas as perguntas obrigatórias para concluir.");
      document.getElementById(`perg-${faltantes[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Regras das perguntas de colegas (mínimo, 1 por setor, não pode ser você…).
    for (const p of pergsVisiveis.filter(p => p.tipo === "colegas")) {
      const msg = erroColegas(p);
      if (msg) {
        setFaltando(new Set([p.id]));
        setErro(msg);
        document.getElementById(`perg-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (form.coleta_identificacao && !empregado && !anonimo && !nome.trim()) { setErro("Informe seu nome."); return; }
    setEnviando(true);
    // Perguntas de colegas: guarda só as linhas preenchidas, já limpas (as
    // linhas em branco da tela não viram resposta).
    const itens: Record<string, any> = { ...valores };
    pergsVisiveis.filter(p => p.tipo === "colegas").forEach(p => {
      if (itens[p.id] === undefined) return;
      itens[p.id] = linhasColegas(itens[p.id]).map(l => ({
        colaborador: String(l.colaborador ?? "").trim(),
        setor: String(l.setor ?? "").trim() || null,
        nota: l.nota ?? null,
        comentario: String(l.comentario ?? "").trim() || null,
      }));
    });
    // Cadastro do respondente (logado): puxa nome/setor/cargo/... do EMPREGADOS
    // e anexa como snapshot - o botão "Detalhes" na tela de respostas mostra tudo.
    const cadastroCompleto = empregado ? {
      id: empregado.id, nome: empregado.nome, cpf: empregado.cpf, cargo: empregado.cargo,
      setor: empregado.setor, perfil: empregado.perfil, lider: empregado.lider,
      situacao: empregado.situacao, admissao: empregado.admissao,
      empresa: empregado.empresa, filial: empregado.filial, email: empregado.email,
    } : null;
    // Escolheu anônimo: nada que identifique vai junto. O banco reforça isso
    // (o trigger apaga criado_por/nome/e-mail/cadastro), mas nem enviar a gente
    // envia. O SETOR continua indo — é dele que vivem os painéis e ele não
    // aponta para ninguém.
    const cadastro = anonimo ? null : cadastroCompleto;
    // Setor (p/ Administrativo × Operacional): cadastro tem prioridade; senão o
    // valor da pergunta de setor indicada no formulário.
    const setorRaw = form.pergunta_setor_id ? valores[form.pergunta_setor_id] : null;
    const setorPergunta = Array.isArray(setorRaw) ? (setorRaw[0] ? String(setorRaw[0]).trim() : null) : (setorRaw != null && setorRaw !== "" ? String(setorRaw).trim() : null);
    const setor = (cadastroCompleto?.setor?.trim() || setorPergunta) || null;
    // Nome de quem respondeu: cadastro > campo de identificação > pergunta que
    // identifica o respondente (pergunta_nome_id) — senão fica anônimo.
    const nomeRaw = form.pergunta_nome_id ? valores[form.pergunta_nome_id] : null;
    const nomePergunta = Array.isArray(nomeRaw) ? (nomeRaw[0] ? String(nomeRaw[0]).trim() : "") : (nomeRaw != null ? String(nomeRaw).trim() : "");
    const nomeResp = anonimo ? null : (cadastro?.nome?.trim() || (form.coleta_identificacao ? nome.trim() : "") || nomePergunta || null);
    const emailResp = anonimo ? null : (cadastro?.email?.trim() || (form.coleta_identificacao ? email.trim() : "") || null);
    // criado_por é carimbado pelo default do banco (auth.uid()) quando quem envia
    // está logado; anônimo (link público sem login) fica sem dono. Quem não bate
    // por criado_por é reconhecido pela identidade do cadastro na leitura das
    // respostas (cs_form_minha_resposta), então não precisa setar aqui.
    const duracao_seg = Math.max(0, Math.round((Date.now() - abertoEm.current) / 1000));  // tempo de conclusão
    const base = { formulario_id: form.id, respondente_nome: nomeResp, respondente_email: emailResp, itens };
    let { error } = await (supabase as any).from("CS_FORM_RESPOSTAS").insert({ ...base, setor, respondente_cadastro: cadastro, duracao_seg, anonimo });
    // Banco ainda sem as colunas novas (setor/cadastro/duração/anônimo): reenvia só o básico.
    if (error && /column|schema cache/i.test(error.message)) ({ error } = await (supabase as any).from("CS_FORM_RESPOSTAS").insert(base));
    setEnviando(false);
    if (error) {
      // As regras do banco (trigger) já falam português — mostra a mensagem
      // como veio em vez de "Erro ao enviar: ...".
      const daRegra = /^(Em "|Este formulário não aceita)/.test(error.message ?? "");
      setErro(daRegra ? error.message
        : /row-level security/i.test(error.message)
          ? "Este formulário não está aceitando a sua resposta agora (prazo, limite de respostas ou intervalo entre respostas)."
          : "Erro ao enviar: " + error.message);
      return;
    }
    setEnviado(true);
  };

  // Progresso: quantas perguntas (fora as informativas) já foram respondidas.
  const perguntasContaveis = pergsVisiveis.filter(p => p.tipo !== "texto_info");
  const respondidas = perguntasContaveis.filter(p => respondida(p, valores[p.id])).length;
  const pct = perguntasContaveis.length ? Math.round((respondidas / perguntasContaveis.length) * 100) : 0;

  return (
    <div className="fp-bg" style={{ minHeight: "100vh", padding: "28px 16px 60px", overflow: "hidden" }}>
      <AnimStyles /><Blobs />
      {/* Barra de progresso fixa no topo */}
      {perguntasContaveis.length > 0 && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 4, background: "rgba(15,49,113,.10)", zIndex: 50 }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#0f3171,#3b6fd4)", borderRadius: "0 4px 4px 0", transition: "width .45s cubic-bezier(.22,1,.36,1)" }} />
        </div>
      )}
      <div className="fp-scope" style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Capa e cabeçalho */}
        <div className="fp-in fp-card-h" style={{ ...card, padding: 0, overflow: "hidden" }}>
          {form.imagem_capa_url && (
            <div style={{ background: "linear-gradient(135deg,#f8fbff 0%,#eef2ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
              <img src={form.imagem_capa_url} alt="" style={{ maxWidth: "100%", maxHeight: 210, objectFit: "contain", display: "block", filter: "drop-shadow(0 10px 22px rgba(15,49,113,.14))" }} />
            </div>
          )}
          <div style={{ height: 5, background: "linear-gradient(90deg,#0f3171,#3b6fd4,#0f3171)" }} />
          <div style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-.4px" }}>{form.titulo}</div>
            {form.descricao && <div style={{ fontSize: 14, color: "#475569", marginTop: 7, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{form.descricao}</div>}
            {form.encerra_em && <div style={{ display: "inline-block", fontSize: 12, color: "#a16207", background: "#fef9c3", borderRadius: 8, padding: "4px 10px", marginTop: 10 }}>🗓 Aberto até {fmtDt(form.encerra_em)}</div>}
          </div>
        </div>

        {/* Identificação - cadastro puxado automaticamente quando logado */}
        {empregado ? (
          <div className="fp-in fp-card-h" style={{ ...card, borderLeft: "4px solid #0f3171", animationDelay: ".08s" }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f3171" }}>👤 Respondendo como {empregado.nome}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {[["Setor", empregado.setor], ["Cargo", empregado.cargo], ["Filial", empregado.filial]].map(([k, v]) => v ? (
                <span key={k} style={{ fontSize: 12, background: "#f1f5f9", borderRadius: 8, padding: "4px 10px", color: "#334155" }}>
                  <b style={{ color: "#94a3b8", fontWeight: 700 }}>{k}:</b> {v}
                </span>
              ) : null)}
            </div>
            <div style={{ fontSize: 11.5, color: anonimo ? "#a16207" : "#94a3b8", marginTop: 8 }}>
              {anonimo
                ? "Você escolheu responder de forma anônima: nada disso será enviado junto da resposta."
                : "Seus dados de cadastro são anexados automaticamente à resposta - não precisa preencher de novo."}
            </div>
          </div>
        ) : form.coleta_identificacao && !anonimo ? (
          <div className="fp-in fp-card-h" style={{ ...card, animationDelay: ".08s" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Sua identificação <span style={{ color: "#dc2626" }}>*</span></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input placeholder="Nome completo *" value={nome} onChange={e => setNome(e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
              <input placeholder="E-mail (opcional)" type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
            </div>
          </div>
        ) : null}

        {/* Identificado × anônimo. Só aparece se o formulário permitir; a
            escolha vale no banco (o trigger apaga a identidade da resposta
            anônima antes de gravar). */}
        {form.permite_anonimo && (
          <div className="fp-in fp-card-h" style={{ ...card, animationDelay: ".1s" }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0f172a", marginBottom: 11 }}>👤 Como você gostaria de enviar esta pesquisa?</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {([
                { on: false, titulo: "Identificado", desc: "Sua identificação será conhecida apenas pela gestão e usada para fins de melhoria." },
                { on: true, titulo: "Anônimo", desc: "Sua identidade não será revelada. Sua resposta será contabilizada de forma anônima." },
              ]).map(o => {
                const sel = anonimo === o.on;
                return (
                  <div key={o.titulo} onClick={() => setAnonimo(o.on)}
                    style={{ flex: 1, minWidth: 230, cursor: "pointer", display: "flex", gap: 10, padding: "12px 14px", borderRadius: 12, border: sel ? "1.5px solid #0f3171" : "1px solid #e2e8f0", background: sel ? "rgba(15,49,113,.04)" : "#fff" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 2, border: sel ? "5px solid #0f3171" : "1.5px solid #cbd5e1", background: "#fff" }} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: sel ? "#0f3171" : "#0f172a" }}>{o.titulo}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.5 }}>{o.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "#0369a1", background: "#f0f7ff", border: "1px solid #dbeafe", borderRadius: 9, padding: "7px 10px", marginTop: 10 }}>
              ℹ️ Você pode escolher como deseja participar. Essa escolha não poderá ser alterada após o envio.
            </div>
          </div>
        )}

        {/* Perguntas (só as visíveis para o setor do respondente) */}
        {(() => { let nq = 0; return pergsVisiveis.map((p, idx) => {
          const delay = `${0.14 + idx * 0.05}s`;
          // Texto informativo: só leitura, sem número, sem input, sem validação.
          if (p.tipo === "texto_info") return (
            <div key={p.id} className="fp-in fp-card-h" style={{ ...card, background: "#f8fafc", borderLeft: `4px solid ${p.config?.cor || "#0f3171"}`, animationDelay: delay }}>
              {p.titulo && <div style={{ fontSize: 15, fontWeight: 800, color: p.config?.cor || "#0f3171" }}>{p.titulo}</div>}
              {p.descricao && <div style={{ fontSize: 14, color: p.config?.cor || "#334155", marginTop: p.titulo ? 6 : 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{p.descricao}</div>}
              {p.imagem_url && <img src={p.imagem_url} alt="" style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 10, marginTop: 10, border: "1px solid #f1f5f9" }} />}
            </div>
          );
          nq++;
          const falta = faltando.has(p.id);
          return (
          <div key={p.id} id={`perg-${p.id}`} className="fp-in fp-card-h" style={{ ...card, animationDelay: delay, border: falta ? "1.5px solid #dc2626" : card.border, boxShadow: falta ? "0 0 0 3px rgba(220,38,38,.12)" : card.boxShadow }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              {nq}. {p.titulo} {p.obrigatoria && <span style={{ color: "#dc2626" }}>*</span>}
            </div>
            {p.descricao && <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 3 }}>{p.descricao}</div>}
            {falta && <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 700, marginTop: 6 }}>⚠️ Esta pergunta é obrigatória.</div>}
            {p.imagem_url && <img src={p.imagem_url} alt="" style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 10, marginTop: 10, border: "1px solid #f1f5f9" }} />}
            {p.config?.arquivo_url && (
              <a href={p.config.arquivo_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13, fontWeight: 700, color: "#0369a1", textDecoration: "none", background: "#f0f7ff", border: "1px solid #dbeafe", borderRadius: 9, padding: "7px 11px" }}>📎 Baixar {p.config.arquivo_nome || "arquivo"}</a>
            )}
            <div style={{ marginTop: 12 }}>
              {p.tipo === "texto_curto" && <input value={valores[p.id] ?? ""} onChange={e => setVal(p.id, e.target.value)} style={inp} placeholder="Sua resposta" />}
              {p.tipo === "texto_longo" && <textarea value={valores[p.id] ?? ""} onChange={e => setVal(p.id, e.target.value)} rows={4} style={{ ...inp, resize: "vertical" }} placeholder="Sua resposta" />}
              {p.tipo === "colaborador" && <ColaboradorSelect value={valores[p.id] ?? ""} onChange={v => setVal(p.id, v)} />}
              {p.tipo === "colegas" && (
                <ColegasGrid p={p} valor={valores[p.id]} meuNome={empregado?.nome ?? ""}
                  onChange={linhas => setVal(p.id, linhas)} />
              )}
              {p.tipo === "contrato" && (
                <ContratoSelect
                  value={valores[p.id] ?? (p.config?.multiplos ? [] : "")}
                  multiplos={!!p.config?.multiplos}
                  onChange={v => setVal(p.id, v)}
                />
              )}
              {p.tipo === "escala_trabalho" && (
                <select value={valores[p.id] ?? ""} onChange={e => setVal(p.id, e.target.value)} style={{ ...inp, maxWidth: 300 }}>
                  <option value="">Selecione a escala…</option>
                  {ESCALAS_TRABALHO.map(esc => <option key={esc} value={esc}>{esc}</option>)}
                </select>
              )}
              {p.tipo === "numero" && <input type="number" value={valores[p.id] ?? ""} onChange={e => setVal(p.id, e.target.value === "" ? "" : Number(e.target.value))} style={{ ...inp, maxWidth: 220 }} placeholder="0" />}
              {p.tipo === "data" && <input type="date" value={valores[p.id] ?? ""} onChange={e => setVal(p.id, e.target.value)} style={{ ...inp, maxWidth: 220 }} />}
              {p.tipo === "lista_suspensa" && (() => {
                const on = !!outroOn[p.id];
                return (
                  <div>
                    <select value={on ? "__outro__" : (valores[p.id] ?? "")}
                      onChange={e => { const v = e.target.value; if (v === "__outro__") { setOutroOn(x => ({ ...x, [p.id]: true })); setVal(p.id, outroTxt[p.id] ?? ""); } else { setOutroOn(x => ({ ...x, [p.id]: false })); setVal(p.id, v); } }}
                      style={{ ...inp, maxWidth: 380 }}>
                      <option value="">Selecione...</option>
                      {p.opcoes.map((o, oi) => <option key={oi} value={o}>{o}</option>)}
                      {p.config.outro && <option value="__outro__">Outro…</option>}
                    </select>
                    {on && <input value={outroTxt[p.id] ?? ""} onChange={e => { const t = e.target.value; setOutroTxt(x => ({ ...x, [p.id]: t })); setVal(p.id, t); }} placeholder="Descreva…" style={{ ...inp, maxWidth: 380, marginTop: 8 }} />}
                  </div>
                );
              })()}
              {p.tipo === "multipla_escolha" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.opcoes.map((o, oi) => (
                    <label key={oi} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "#0f172a", cursor: "pointer" }}>
                      <input type="radio" name={p.id} checked={!outroOn[p.id] && valores[p.id] === o} onChange={() => { setOutroOn(x => ({ ...x, [p.id]: false })); setVal(p.id, o); }} style={{ width: 16, height: 16 }} />
                      {o}
                    </label>
                  ))}
                  {p.config.outro && (
                    <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "#0f172a", cursor: "pointer", flexWrap: "wrap" }}>
                      <input type="radio" name={p.id} checked={!!outroOn[p.id]} onChange={() => { setOutroOn(x => ({ ...x, [p.id]: true })); setVal(p.id, outroTxt[p.id] ?? ""); }} style={{ width: 16, height: 16 }} />
                      Outro:
                      <input value={outroTxt[p.id] ?? ""} disabled={!outroOn[p.id]} onChange={e => { const t = e.target.value; setOutroTxt(x => ({ ...x, [p.id]: t })); setVal(p.id, t); }} placeholder="descreva…" style={{ ...inp, flex: 1, minWidth: 180, opacity: outroOn[p.id] ? 1 : .5 }} />
                    </label>
                  )}
                </div>
              )}
              {p.tipo === "caixas_selecao" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(() => {
                    const arr: string[] = Array.isArray(valores[p.id]) ? valores[p.id] : [];
                    const fixedSel = arr.filter(x => p.opcoes.includes(x));
                    const oOn = !!outroOn[p.id];
                    const oTxt = outroTxt[p.id] ?? "";
                    const rebuild = (fixed: string[], on: boolean, txt: string) => setVal(p.id, [...fixed, ...(on && txt.trim() ? [txt.trim()] : [])]);
                    return (
                      <>
                        {p.opcoes.map((o, oi) => (
                          <label key={oi} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "#0f172a", cursor: "pointer" }}>
                            <input type="checkbox" checked={fixedSel.includes(o)} onChange={e => rebuild(e.target.checked ? [...fixedSel, o] : fixedSel.filter(x => x !== o), oOn, oTxt)} style={{ width: 16, height: 16 }} />
                            {o}
                          </label>
                        ))}
                        {p.config.outro && (
                          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "#0f172a", cursor: "pointer", flexWrap: "wrap" }}>
                            <input type="checkbox" checked={oOn} onChange={e => { setOutroOn(x => ({ ...x, [p.id]: e.target.checked })); rebuild(fixedSel, e.target.checked, oTxt); }} style={{ width: 16, height: 16 }} />
                            Outro:
                            <input value={oTxt} disabled={!oOn} onChange={e => { const t = e.target.value; setOutroTxt(x => ({ ...x, [p.id]: t })); rebuild(fixedSel, oOn, t); }} placeholder="descreva…" style={{ ...inp, flex: 1, minWidth: 180, opacity: oOn ? 1 : .5 }} />
                          </label>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
              {p.tipo === "escala" && (() => {
                const min = p.config.min ?? 1, max = p.config.max ?? 5;
                const ns: number[] = []; for (let n = min; n <= max; n++) ns.push(n);
                return (
                  <div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ns.map(n => (
                        <button key={n} onClick={() => setVal(p.id, n)} className="fp-scale-btn"
                          style={{ width: 42, height: 42, borderRadius: 10, border: valores[p.id] === n ? "2px solid #0f3171" : "1px solid #cbd5e1", background: valores[p.id] === n ? "#0f3171" : "#fff", color: valores[p.id] === n ? "#fff" : "#0f172a", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: valores[p.id] === n ? "0 8px 18px rgba(15,49,113,.30)" : "none" }}>{n}</button>
                      ))}
                    </div>
                    {(p.config.rotulo_min || p.config.rotulo_max) && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#94a3b8", marginTop: 6, maxWidth: (42 + 8) * ns.length }}>
                        <span>{p.config.rotulo_min ?? ""}</span><span>{p.config.rotulo_max ?? ""}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {p.config?.anexo_resp && (() => {
              const anexoUrl = valores[`${p.id}__anexo`];
              const anexoNome = valores[`${p.id}__anexo_nome`];
              const carregando = !!anexando[p.id];
              return (
                <div style={{ marginTop: 12, borderTop: "1px dashed #e2e8f0", paddingTop: 12 }}>
                  {anexoUrl ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "8px 11px" }}>
                      <a href={anexoUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: "#15803d", textDecoration: "none", flex: 1, wordBreak: "break-all" }}>📎 {anexoNome || "arquivo anexado"}</a>
                      <button type="button" onClick={() => removerAnexo(p.id)} style={{ padding: "4px 9px", borderRadius: 8, border: "1px solid rgba(220,38,38,.25)", background: "#fff", color: "#dc2626", fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Remover</button>
                    </div>
                  ) : (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: carregando ? "default" : "pointer", fontSize: 13, fontWeight: 700, color: "#0f3171", background: "#f0f7ff", border: "1px dashed #93c5fd", borderRadius: 10, padding: "9px 13px" }}>
                      {carregando ? "Enviando anexo…" : "📎 Anexar arquivo (PDF/arquivo até 25MB)"}
                      <input type="file" accept={ACCEPT_ANEXO} disabled={carregando} style={{ display: "none" }}
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadResp(p.id, f); }} />
                    </label>
                  )}
                </div>
              );
            })()}
          </div>
          );
        }); })()}

        {erro && (
          <div className="fp-in" style={{ display: "flex", alignItems: "center", gap: 10, background: "#fef2f2", color: "#b91c1c", border: "1.5px solid #fecaca", padding: "13px 16px", borderRadius: 13, fontSize: 13.5, fontWeight: 700, boxShadow: "0 8px 22px rgba(220,38,38,.12)" }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span> {erro}
          </div>
        )}

        <button onClick={enviar} disabled={enviando} className="fp-submit"
          style={{ padding: "14px", borderRadius: 13, border: "none", background: enviando ? "#94a3b8" : "linear-gradient(135deg,#0f3171 0%,#1e4fa3 100%)", color: "#fff", fontSize: 15, fontWeight: 800, cursor: enviando ? "default" : "pointer", boxShadow: "0 10px 26px rgba(15,49,113,.32)", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
          {enviando ? <><span className="fp-spin" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%" }} /> Enviando...</> : "Enviar resposta →"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#94a3b8" }}>Nascimento Formulários · Grupo Nascimento</div>
      </div>
    </div>
  );
}
