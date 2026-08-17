import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useFormPerms } from "@/hooks/useFormPerms";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { Formulario, Pergunta, fmtDt, situacao, normalizaPerguntas } from "./Formularios";
import EmpregadoDetalheModal, { normNome, carregarVinculos, prewarmFichas, invalidarFichas } from "./EmpregadoDetalheModal";

// =====================================================================
// NASCIMENTO FORMULÁRIOS - Respostas
// Resumo agregado por pergunta (contagem/percentual em barras para
// escolhas/escala; média para número; lista para texto), tabela de
// respostas individuais e exportação CSV.
// =====================================================================

interface Resposta {
  id: string; enviado_em: string;
  respondente_nome?: string | null; respondente_email?: string | null;
  setor?: string | null; respondente_cadastro?: Record<string, any> | null;
  duracao_seg?: number | null; criado_por?: string | null;
  anonimo?: boolean | null;   // enviada sem identificação (nada aqui aponta p/ quem respondeu)
  itens: Record<string, any>;
}

// Linha da pergunta "colegas": {colaborador, setor, nota, comentario}.
const ehLinhaColega = (v: any): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) && "colaborador" in v;
const textoLinhaColega = (l: any): string =>
  [String(l?.colaborador ?? "").trim(), l?.setor ? `(${l.setor})` : "",
   l?.nota != null ? `nota ${l.nota}` : "", String(l?.comentario ?? "").trim()]
    .filter(Boolean).join(" · ");

const fmtDur = (s?: number | null) => { if (s == null) return "-"; const m = Math.floor(s / 60), ss = s % 60; return m ? `${m}m ${ss}s` : `${ss}s`; };

// Rótulos amigáveis do snapshot de cadastro (respondente_cadastro).
const CADASTRO_CAMPOS: { k: string; rotulo: string }[] = [
  { k: "nome", rotulo: "Nome" }, { k: "cpf", rotulo: "CPF" }, { k: "cargo", rotulo: "Cargo" },
  { k: "setor", rotulo: "Setor" }, { k: "perfil", rotulo: "Perfil" }, { k: "lider", rotulo: "Líder" },
  { k: "situacao", rotulo: "Situação" }, { k: "admissao", rotulo: "Admissão" },
  { k: "empresa", rotulo: "Empresa" }, { k: "filial", rotulo: "Filial" }, { k: "email", rotulo: "E-mail" },
];

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "15px 17px", boxShadow: "0 8px 24px rgba(15,23,42,.06)" };
const valorTexto = (v: any): string =>
  v == null || v === "" ? "-"
  : Array.isArray(v) ? (v.length ? v.map(x => (ehLinhaColega(x) ? textoLinhaColega(x) : String(x))).join("; ") : "-")
  : ehLinhaColega(v) ? textoLinhaColega(v)
  : String(v);

// Texto solto de resposta: itálico, peso normal.
const valorFonte: React.CSSProperties = { fontSize: 12.5, fontStyle: "italic", fontWeight: 500, color: "#0f172a" };
// Nome de gente casado com o cadastro: destaca do texto comum - reto, negrito
// e caixa alta (é assim que o nome vive na EMPREGADOS).
const nomeFonte: React.CSSProperties = { fontSize: 12.5, fontStyle: "normal", fontWeight: 800, color: "#0f172a", textTransform: "uppercase" };
const btnMini = (bg: string, c: string, border: string): React.CSSProperties =>
  ({ padding: "3px 9px", borderRadius: 7, border, background: bg, color: c, fontSize: 10.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 });
const rotFiltro: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: "#94a3b8", marginBottom: 4 };
const selFiltro: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 10px", fontSize: 12.5, outline: "none", fontFamily: "inherit", background: "#fff", color: "#0f172a" };

// Como um texto de resposta deve aparecer: se é pessoa (bate com o cadastro ou
// foi vinculado à mão) e sob que nome. O vínculo manual troca o texto da
// resposta pelo nome completo do empregado ("Gerência Sistemas" vira
// "IURY DE JESUS SILVA"); `original` é sempre o que veio na resposta e é ele
// que abre a ficha (a ficha resolve o vínculo pelo texto original).
// `podeAbrirFicha`: a pergunta declara que ali vai nome de gente, então o texto
// abre a ficha mesmo sem casar com o cadastro - é de lá que se corrige o nome.
interface Pessoa { ehPessoa: boolean; exibir: string; original: string; podeAbrirFicha?: boolean }
type Resolver = (v: any) => Pessoa;

// Só a pergunta de IDENTIFICAÇÃO traz gente na resposta. Em toda outra, o que
// existe é alternativa ("Alto", "Muito comprometido") — tratar isso como nome
// fazia alternativa virar link de ficha e, pior, casar com lixo do cadastro
// (nomes de uma letra), trocando o rótulo da opção pelo nome de um empregado.
const SEM_PESSOA = (v: any): Pessoa => { const t = valorTexto(v); return { ehPessoa: false, exibir: t, original: t }; };

// Qual resolvedor vale em cada pergunta:
//   • a que diz QUEM respondeu → identidade da PRÓPRIA resposta. Quem envia
//     logado já chega carimbado com o cadastro (respondente_cadastro), então
//     não há o que adivinhar pelo texto digitado;
//   • tipo "colaborador"/"colegas" → nome de terceiro, resolvido só pelo
//     vínculo manual;
//   • qualquer outra → texto puro, sem tratamento de gente.
// Nas duas primeiras o texto abre a ficha mesmo sem estar vinculado: é de lá
// que se faz o vínculo à mão, o único jeito de amarrar um nome solto agora.
const resolverDaPergunta = (p: Pergunta, perguntaNomeId: string | null, ident: Resolver, vinculo: Resolver): Resolver => {
  const base = p.id === perguntaNomeId ? ident : (p.tipo === "colaborador" || p.tipo === "colegas") ? vinculo : null;
  return base ? (v => ({ ...base(v), podeAbrirFicha: true })) : SEM_PESSOA;
};

// Nome de empregado numa resposta. Vinculado de verdade (identidade da resposta
// ou de-para manual) aparece com 👤 e em caixa alta — é uma afirmação de que
// aquilo é aquela pessoa. Sem vínculo, fica o texto como foi digitado: continua
// clicável p/ abrir a ficha e vincular à mão, mas sem fingir que reconheceu.
function NomeLink({ texto, resolve, onPessoa }: { texto: string; resolve: Resolver; onPessoa: (n: string) => void }) {
  const { ehPessoa, exibir, original, podeAbrirFicha } = resolve(texto);
  if (!ehPessoa && !podeAbrirFicha) return <span style={valorFonte}>{texto}</span>;
  return (
    <button onClick={() => onPessoa(original)}
      title={!ehPessoa ? "Sem vínculo com o cadastro — abrir para vincular à mão"
        : exibir !== original ? `Respondeu "${original}" — vinculado a ${exibir}` : "Ver ficha do colaborador"}
      style={{ ...(ehPessoa ? nomeFonte : valorFonte), background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>
      {ehPessoa ? `👤 ${exibir}` : exibir}
    </button>
  );
}

// Bloco pergunta → resposta da aba Individuais. Enunciado em cima como rótulo
// discreto, resposta embaixo com destaque: na mesma linha (o formato antigo),
// pergunta e resposta viravam um parágrafo só - os enunciados daqui têm
// parágrafos inteiros de instrução.
// Resposta da pergunta "colegas": uma linha por colega indicado. O nome abre a
// ficha (é gente de verdade, vinda do cadastro); a nota vira estrelas e o
// comentário fica embaixo, para o texto não brigar com a tabela.
function BlocoColegas({ titulo, linhas, resolve, onPessoa }: {
  titulo: string; linhas: any[]; resolve: Resolver; onPessoa: (n: string) => void;
}) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "9px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", lineHeight: 1.45, marginBottom: 6 }}>{titulo}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {linhas.map((l, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #f1f5f9", borderRadius: 9, padding: "7px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <NomeLink texto={String(l?.colaborador ?? "")} resolve={resolve} onPessoa={onPessoa} />
              {l?.setor && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>{l.setor}</span>}
              {l?.nota != null && <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 800 }}>{"★".repeat(Number(l.nota) || 0)}<span style={{ color: "#94a3b8", fontWeight: 700 }}> {l.nota}</span></span>}
            </div>
            {String(l?.comentario ?? "").trim() && (
              <div style={{ ...valorFonte, marginTop: 4 }}>{String(l.comentario).trim()}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BlocoResposta({ titulo, valor, resolve, onPessoa }: {
  titulo: string; valor: any; resolve: Resolver; onPessoa: (n: string) => void;
}) {
  const itens = Array.isArray(valor) ? valor.filter(v => v != null && v !== "") : [];
  if (itens.length && itens.every(ehLinhaColega))
    return <BlocoColegas titulo={titulo} linhas={itens} resolve={resolve} onPessoa={onPessoa} />;
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "9px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", lineHeight: 1.45, marginBottom: 4 }}>{titulo}</div>
      {itens.length > 1 ? (
        // Caixas de seleção: um item por linha, senão vira uma parede de ";".
        <ul style={{ margin: 0, paddingLeft: 15, display: "flex", flexDirection: "column", gap: 3 }}>
          {itens.map((v, i) => <li key={i} style={{ color: "#cbd5e1" }}><NomeLink texto={valorTexto(v)} resolve={resolve} onPessoa={onPessoa} /></li>)}
        </ul>
      ) : (
        <NomeLink texto={valorTexto(itens.length === 1 ? itens[0] : valor)} resolve={resolve} onPessoa={onPessoa} />
      )}
    </div>
  );
}

// O botão "Vincular"/"Detalhes" que ficava em cada linha SAIU. Ele aparecia em
// toda resposta de texto (e-mail, "creio que não"...) oferecendo amarrar aquilo
// a um empregado — ruído em 99% das linhas. Quem respondeu logado já vem
// identificado pela própria resposta, e nome de terceiro continua clicável no
// próprio texto (NomeLink), que é por onde se chega à ficha e ao vínculo.

// Um valor do resumo já agrupado: o mesmo nome citado por N respostas vira uma
// linha só com "(N respostas)". "Ver todos" abre as ocorrências mostrando QUEM
// respondeu e quando - o texto é igual, o que muda é a origem.
function GrupoValor({ texto, itens, resolve, resolveQuem, onPessoa, quem, onVerRespostas }: {
  texto: string; itens: { v: any; r: Resposta }[];
  resolve: Resolver; resolveQuem: Resolver; onPessoa: (n: string) => void; quem: (r: Resposta) => string;
  onVerRespostas: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const n = itens.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 10px" }}>
        <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <NomeLink texto={texto} resolve={resolve} onPessoa={onPessoa} />
          {n > 1 && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca", flexShrink: 0 }}>{n} respostas</span>}
        </div>
        {n > 1 && (
          <button onClick={() => setAberto(v => !v)} style={btnMini("#fff", "#0f3171", "1px solid rgba(15,49,113,.25)")}>
            {aberto ? "Ocultar" : "Ver todos"}
          </button>
        )}
      </div>
      {aberto && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 12 }}>
          {itens.map((o, oi) => {
            const nomeQuem = quem(o.r);
            return (
              <div key={oi} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#64748b", background: "#fff", border: "1px solid #f1f5f9", borderRadius: 7, padding: "4px 9px" }}>
                {/* resolveQuem, não `resolve`: aqui o texto é o NOME DE QUEM RESPONDEU,
                    que nada tem a ver com o tipo da pergunta — usando o resolvedor da
                    pergunta, quem respondeu a uma pergunta de texto virava texto cru. */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <NomeLink texto={nomeQuem} resolve={resolveQuem} onPessoa={onPessoa} />
                  <span style={{ color: "#94a3b8" }}>{fmtDt(o.r.enviado_em)}</span>
                </div>
                {nomeQuem !== "Anônimo" && (
                  <button onClick={() => onVerRespostas(nomeQuem)} title="Abrir a aba Individuais filtrada neste participante"
                    style={btnMini("#fff", "#0f3171", "1px solid rgba(15,49,113,.25)")}>Ver respostas</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Barra de filtros - larga, alinhada com o cabeçalho (não com os cards, que
// são estreitos). Filtra Resumo, Individuais e o CSV de uma vez só.
export function FiltrosRespostas({ fResp, setFResp, opcoesResp, fSetor, setFSetor, opcoesSetor, fDe, setFDe, fAte, setFAte, filtrando, onLimpar }: {
  fResp: string; setFResp: (v: string) => void; opcoesResp: string[];
  fSetor: string; setFSetor: (v: string) => void; opcoesSetor: string[];
  fDe: string; setFDe: (v: string) => void; fAte: string; setFAte: (v: string) => void;
  filtrando: boolean; onLimpar: () => void;
}) {
  return (
    <div style={{ ...card, display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap", padding: "12px 16px", margin: "14px 24px 0", borderRadius: 18, flexShrink: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", paddingBottom: 9 }}>Filtros:</span>
      <div style={{ flex: "1 1 190px", minWidth: 165 }}>
        <label style={rotFiltro}>Respondente</label>
        <select value={fResp} onChange={e => setFResp(e.target.value)} style={selFiltro}>
          <option value="">Todos os respondentes</option>
          {opcoesResp.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ flex: "1 1 190px", minWidth: 165 }}>
        <label style={rotFiltro}>Setor</label>
        <select value={fSetor} onChange={e => setFSetor(e.target.value)} style={selFiltro}>
          <option value="">Todos os setores</option>
          {opcoesSetor.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label style={rotFiltro}>Data de criação</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="date" value={fDe} max={fAte || undefined} onChange={e => setFDe(e.target.value)} style={{ ...selFiltro, width: 148 }} />
          <span style={{ fontSize: 12.5, color: "#64748b", fontWeight: 600 }}>até</span>
          <input type="date" value={fAte} min={fDe || undefined} onChange={e => setFAte(e.target.value)} style={{ ...selFiltro, width: 148 }} />
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onLimpar} disabled={!filtrando}
        style={{ ...btn("#fff", filtrando ? "#475569" : "#cbd5e1", "1px solid #e2e8f0"), cursor: filtrando ? "pointer" : "default", padding: "8px 14px" }}>
        ▽ Limpar filtros
      </button>
    </div>
  );
}

export default function FormularioRespostas() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { can, canVerSetor, canCriarSetor, soProprias, loading: permsLoading } = useFormPerms();
  const { empregado, loading: vincLoading } = useVinculoEmpregado();
  const [form, setForm] = useState<Formulario | null>(null);
  // Todas as perguntas como estão hoje no formulário (inclusive os blocos de
  // texto). `pergs` é a lista que a tela percorre; `pergsTodas` existe p/ saber
  // quais chaves de `itens` ainda TÊM pergunta — o resto é resposta órfã.
  const [pergsTodas, setPergsTodas] = useState<Pergunta[]>([]);
  const pergs = useMemo(() => pergsTodas.filter(p => p.tipo !== "texto_info"), [pergsTodas]);
  const [resps, setResps] = useState<Resposta[]>([]);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<"resumo" | "individuais">("resumo");
  const [fResp, setFResp] = useState("");    // filtro: respondente (nome exato)
  const [fSetor, setFSetor] = useState("");  // filtro: setor carimbado na resposta
  const [fDe, setFDe] = useState("");        // filtro: data de criação (yyyy-mm-dd)
  const [fAte, setFAte] = useState("");
  const [detalhe, setDetalhe] = useState<Resposta | null>(null);  // modal "Detalhes" do cadastro
  const [pessoa, setPessoa] = useState<string | null>(null);      // modal ficha do empregado (nome citado)
  const [vinculos, setVinculos] = useState<Map<string, string>>(new Map()); // apelido -> nome do empregado (CS_FORM_VINCULOS)

  const load = useCallback(async () => {
    setLoading(true);
    const [fRes, rRes] = await Promise.all([
      (supabase as any).from("CS_FORMULARIOS").select("*").eq("id", id).single(),
      (supabase as any).from("CS_FORM_RESPOSTAS").select("*").eq("formulario_id", id).order("enviado_em", { ascending: false }),
    ]);
    setLoading(false);
    if (fRes.error) { nav("/app/central-servicos/formularios"); return; }
    setForm(fRes.data);
    setPergsTodas(normalizaPerguntas(fRes.data.perguntas));
    setResps((rRes.data ?? []).map((r: any) => ({ ...r, itens: r.itens ?? {} })));
  }, [id, nav]);
  useEffect(() => { load(); }, [load]);

  // Monta em segundo plano o índice que a ficha do empregado consome. Quem abre
  // esta tela vai clicar em nome — quando clicar, não deve haver nada a esperar.
  useEffect(() => { prewarmFichas(); }, []);

  // De-para dos vínculos feitos à mão (CS_FORM_VINCULOS). É a ÚNICA fonte que
  // transforma um texto solto em pessoa — o cadastro inteiro não é mais lido
  // aqui, porque não há mais busca por semelhança para alimentar.
  const carregarNomes = useCallback(async () => {
    setVinculos(await carregarVinculos());
  }, []);
  useEffect(() => { carregarNomes(); }, [carregarNomes]);

  // Pessoa = bate com o cadastro OU foi vinculada à mão (nome incompleto etc.).
  // O vínculo manual manda no nome exibido: quem vinculou "Gerência Sistemas" a
  // IURY DE JESUS SILVA quer ver o nome dele, não o texto que veio na resposta.
  //
  // NÃO existe mais casamento automático por semelhança de nome. A regra do
  // "nome contido" pescava qualquer coisa no cadastro — uma resposta "N" virava
  // um empregado de verdade, em negrito, como se estivesse identificada. Nome
  // que ninguém vinculou fica como veio, texto puro: melhor não afirmar nada do
  // que afirmar errado.
  //
  // Isto vale p/ nome de TERCEIRO citado numa resposta. Quem RESPONDEU não
  // passa por aqui: a identidade vem carimbada na resposta (ver `identidades`).
  const resolve = useCallback((v: any): Pessoa => {
    const original = v == null ? "" : String(v);
    const n = normNome(v);
    const vinculado = n ? vinculos.get(n) : undefined;
    if (vinculado !== undefined) return { ehPessoa: true, exibir: vinculado || original, original };
    return { ehPessoa: false, exibir: original, original };
  }, [vinculos]);

  // Qual pergunta diz QUEM respondeu. A config do formulário manda; sem ela,
  // deduz pelo TÍTULO primeiro e só depois pelo tipo: um formulário costuma ter
  // várias perguntas do tipo "colaborador" (no Feedback Guiado, a #1 é a
  // liderança que conduz e a #2 é quem respondeu) — indo pelo tipo pegaríamos a
  // liderança. "Identificação..." é o sinal forte de quem respondeu.
  const perguntaNomeId = useMemo(() => {
    if (form?.pergunta_nome_id) return form.pergunta_nome_id;
    const porTitulo = pergs.find(p => /identifica[çc]|nome complet|^\s*nome\s*$/i.test(p.titulo || ""));
    if (porTitulo) return porTitulo.id;
    const porTipo = pergs.find(p => p.tipo === "colaborador");
    return porTipo?.id ?? null;
  }, [form?.pergunta_nome_id, pergs]);

  // Quem respondeu: o nome gravado na resposta ou, quando ela veio sem nome
  // (importada), o valor da pergunta que identifica o respondente.
  const nomeRespondente = useCallback((r: Resposta): string => {
    // Anônima é anônima: nem a pergunta de identificação vale como nome aqui
    // (o formulário pode ter uma, e ela devolveria a pessoa pela porta dos fundos).
    if (r.anonimo) return "Anônimo";
    const gravado = (r.respondente_nome ?? "").trim();
    if (gravado) return gravado;
    const v = perguntaNomeId ? r.itens[perguntaNomeId] : null;
    const txt = Array.isArray(v) ? (v[0] != null ? String(v[0]) : "") : (v != null ? String(v) : "");
    return txt.trim() || "Anônimo";
  }, [perguntaNomeId]);

  // Identidade oficial de quem respondeu. Ela vem da PRÓPRIA resposta: quem
  // envia logado chega carimbado com o cadastro (respondente_cadastro), então
  // não há nada a adivinhar. Este de-para leva do texto digitado na pergunta de
  // identificação até o nome oficial — era a falta dele que fazia a tela
  // oferecer "Vincular" para nome que já estava perfeitamente identificado.
  // Resposta vinda do link público (sem login) não entra: ali não existe
  // identidade a afirmar, só o texto que a pessoa digitou.
  const identidades = useMemo(() => {
    const m = new Map<string, string>();
    resps.forEach(r => {
      const oficial = String(r.respondente_cadastro?.nome ?? r.respondente_nome ?? "").trim();
      if (!oficial) return;
      m.set(normNome(oficial), oficial);
      const v = perguntaNomeId ? r.itens[perguntaNomeId] : null;
      const digitado = normNome(Array.isArray(v) ? v[0] : v);
      if (digitado) m.set(digitado, oficial);
    });
    return m;
  }, [resps, perguntaNomeId]);

  // Nome de quem respondeu: identidade primeiro; sem ela (link público), cai no
  // casamento com o cadastro, que continua valendo p/ as respostas anônimas.
  const resolveQuem = useCallback((v: unknown): Pessoa => {
    const original = v == null ? "" : String(v);
    const oficial = identidades.get(normNome(original));
    if (oficial) return { ehPessoa: true, exibir: oficial, original };
    return resolve(v);
  }, [identidades, resolve]);

  // Chaves de `itens` que não têm mais pergunta: a pergunta foi apagada do
  // formulário DEPOIS das respostas. O dado continua gravado, mas sumia da tela
  // — 81 das 98 respostas do Feedback Guiado tinham resposta invisível assim.
  const idsPerguntas = useMemo(() => new Set(pergsTodas.map(p => p.id)), [pergsTodas]);
  const orfasDe = useCallback((r: Resposta) => Object.entries(r.itens ?? {}).filter(([k, v]) =>
    !idsPerguntas.has(k) && !k.includes("__anexo") &&
    v != null && v !== "" && !(Array.isArray(v) && v.length === 0)), [idsPerguntas]);

  // Nome do empregado vinculado ao login. É por ele que "só as próprias" casa as
  // MINHAS respostas: elas vêm do link público (sem criado_por), então quem
  // respondeu se identificou pelo nome do cadastro, não pelo dono da linha.
  const meuNome = useMemo(() => normNome(empregado?.nome ?? ""), [empregado]);

  // Recorte de visibilidade — espelha a RLS (cs_form_resp_select), como defesa
  // em profundidade: a RLS continua sendo a autoridade, mas a tela mostra só o
  // que a permissão do usuário libera, mesmo que a RLS devolva mais por estar
  // defasada (era isso que fazia "ver por setor = RH" mostrar todo mundo).
  //   • ver_tudo, ou dono do setor do formulário (criar_setor) → todas;
  //   • ver_proprias → as que EU enviei (criado_por meu OU eu sou o respondente
  //     vinculado);
  //   • ver_setor → só as carimbadas com um setor que me foi liberado (o
  //     Setor_ERP de quem respondeu, gravado em CS_FORM_RESPOSTAS.setor).
  const respsEscopo = useMemo(() => {
    if (!user) return [];
    if (can("ver_tudo") || (form && canCriarSetor((form as any).setor))) return resps;
    return resps.filter(r =>
      (can("ver_proprias") && (
        (!!r.criado_por && r.criado_por === user.id) ||
        (!!meuNome && normNome(nomeRespondente(r)) === meuNome)
      ))
      || canVerSetor(r.setor));
  }, [resps, user, form, can, canVerSetor, canCriarSetor, meuNome, nomeRespondente]);

  // Opções dos filtros: saem das próprias respostas (só o que existe aparece).
  const opcoesResp = useMemo(
    () => [...new Set(respsEscopo.map(r => nomeRespondente(r)).filter(n => n && n !== "Anônimo"))].sort(),
    [respsEscopo, nomeRespondente]);
  const opcoesSetor = useMemo(() => [...new Set(respsEscopo.map(r => (r.setor ?? "").trim()).filter(Boolean))].sort(), [respsEscopo]);
  // Respostas filtradas alimentam AS DUAS abas (resumo e individuais) e o CSV.
  // Data: intervalo fechado nas duas pontas - "até 31/05" inclui o dia 31
  // inteiro (por isso o fim do dia, não 00:00).
  const respsFiltradas = useMemo(() => {
    const de = fDe ? new Date(`${fDe}T00:00:00`).getTime() : null;
    const ate = fAte ? new Date(`${fAte}T23:59:59.999`).getTime() : null;
    return respsEscopo.filter(r => {
      if (fResp && nomeRespondente(r) !== fResp) return false;
      if (fSetor && (r.setor ?? "").trim() !== fSetor) return false;
      if (de != null || ate != null) {
        const t = new Date(r.enviado_em).getTime();
        if (isNaN(t)) return false;
        if (de != null && t < de) return false;
        if (ate != null && t > ate) return false;
      }
      return true;
    });
  }, [respsEscopo, fResp, fSetor, fDe, fAte, nomeRespondente]);
  const filtrando = !!(fResp || fSetor || fDe || fAte);
  const limparFiltros = () => { setFResp(""); setFSetor(""); setFDe(""); setFAte(""); };

  const exportCsv = () => {
    if (!form) return;
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const cab = ["Enviado em", "Nome", "E-mail", ...pergs.map(p => p.titulo)];
    const linhas = respsFiltradas.map(r => [
      fmtDt(r.enviado_em), nomeRespondente(r), r.respondente_email ?? "",
      ...pergs.map(p => valorTexto(r.itens[p.id])),
    ]);
    const csv = "﻿" + [cab, ...linhas].map(l => l.map(esc).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `respostas-${form.slug}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const excluirResp = async (r: Resposta) => {
    if (!confirm("Excluir esta resposta?")) return;
    await (supabase as any).from("CS_FORM_RESPOSTAS").delete().eq("id", r.id);
    invalidarFichas();   // a resposta some das participações da ficha
    load();
  };

  if (loading || !form || permsLoading || vincLoading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Carregando...</div>;
  const sit = situacao(form, resps.length);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={() => nav("/app/central-servicos/formularios")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>← Voltar</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f3171" }}>📊 {form.titulo}</div>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}><b style={{ color: "#0f172a" }}>{respsEscopo.length}</b> resposta(s){form.max_respostas != null ? ` · limite ${form.max_respostas}` : ""} · <span style={{ color: sit.c, fontWeight: 700 }}>{sit.rotulo}</span></div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
          {(["resumo", "individuais"] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: aba === a ? "#fff" : "transparent", color: aba === a ? "#0f3171" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: aba === a ? "0 2px 6px rgba(15,23,42,.08)" : "none" }}>
              {a === "resumo" ? "Resumo" : "Individuais"}
            </button>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!respsFiltradas.length} style={btn(respsFiltradas.length ? "#16a34a" : "#94a3b8")}>⬇ Exportar CSV</button>
      </div>

      {respsEscopo.length > 0 && (
        <FiltrosRespostas
          fResp={fResp} setFResp={setFResp} opcoesResp={opcoesResp}
          fSetor={fSetor} setFSetor={setFSetor} opcoesSetor={opcoesSetor}
          fDe={fDe} setFDe={setFDe} fAte={fAte} setFAte={setFAte}
          filtrando={filtrando} onLimpar={limparFiltros} />
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {respsEscopo.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "#94a3b8", padding: 50 }}>{soProprias ? "Você ainda não enviou nenhuma resposta a este formulário." : "Nenhuma resposta ainda. Compartilhe a URL pública do formulário."}</div>
          ) : respsFiltradas.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "#94a3b8", padding: 40 }}>
              Nenhuma resposta bate com o filtro. <button onClick={limparFiltros} style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 700, cursor: "pointer", fontSize: 12.5 }}>Limpar filtros</button>
            </div>
          ) : aba === "resumo" ? (
            // resolverDaPergunta: só a pergunta de identificação e as do tipo
            // "colaborador" tratam o texto como gente. Sem isso, rótulos curtos
            // de opção casavam com empregado ("Bom" virava "NATALEN SOARES
            // BOM…", "N" virava gente).
            pergs.map((p, i) => <ResumoPergunta key={p.id} p={p} i={i} resps={respsFiltradas}
              resolve={resolverDaPergunta(p, perguntaNomeId, resolveQuem, resolve)} resolveQuem={resolveQuem}
              onPessoa={setPessoa} quem={nomeRespondente}
              onVerRespostas={(n) => { setFResp(n); setAba("individuais"); }} />)
          ) : (
            respsFiltradas.map(r => {
              const quem = nomeRespondente(r);
              return (
              <div key={r.id} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>
                    {quem !== "Anônimo" && resolveQuem(quem).ehPessoa
                      ? <NomeLink texto={quem} resolve={resolveQuem} onPessoa={setPessoa} />
                      : quem}
                  </span>
                  {r.anonimo && <span title="Enviada sem identificação - nada nesta resposta aponta para quem respondeu" style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#f1f5f9", color: "#475569" }}>🕶 Anônima</span>}
                  {r.respondente_email && <span style={{ fontSize: 11.5, color: "#64748b" }}>{r.respondente_email}</span>}
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDt(r.enviado_em)}</span>
                  {r.setor && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>{r.setor}</span>}
                  {r.duracao_seg != null && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#f1f5f9", color: "#64748b" }}>⏱ {fmtDur(r.duracao_seg)}</span>}
                  <div style={{ flex: 1 }} />
                  {r.respondente_cadastro && <button onClick={() => setDetalhe(r)} style={btn("rgba(15,49,113,.08)", "#0f3171", "1px solid rgba(15,49,113,.2)")}>👤 Detalhes</button>}
                  <button onClick={() => excluirResp(r)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>Excluir</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pergs.map(p => {
                    const anexo = r.itens[`${p.id}__anexo`];
                    return (
                      <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <BlocoResposta titulo={p.titulo} valor={r.itens[p.id]} resolve={resolverDaPergunta(p, perguntaNomeId, resolveQuem, resolve)} onPessoa={setPessoa} />
                        {anexo && (
                          <a href={anexo} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "#0369a1", textDecoration: "none", background: "#f0f7ff", border: "1px solid #dbeafe", borderRadius: 8, padding: "5px 10px" }}>📎 Baixar anexo{r.itens[`${p.id}__anexo_nome`] ? ` — ${r.itens[`${p.id}__anexo_nome`]}` : ""}</a>
                        )}
                      </div>
                    );
                  })}
                  {/* Respostas de perguntas apagadas do formulário. Sem isto o
                      dado continua no banco mas some da tela, e a resposta
                      aparece incompleta sem explicar por quê. */}
                  {orfasDe(r).map(([k, v]) => (
                    <div key={k} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "9px 12px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", lineHeight: 1.45, marginBottom: 4 }}>
                        Pergunta removida do formulário
                      </div>
                      <span style={valorFonte}>{valorTexto(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal Detalhes - cadastro do respondente (snapshot no momento da resposta) */}
      {detalhe && detalhe.respondente_cadastro && (
        <div onClick={() => setDetalhe(null)} style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 22, width: 520, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", position: "relative" }}>
            <button onClick={() => setDetalhe(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f3171", marginBottom: 2 }}>👤 {detalhe.respondente_cadastro.nome || detalhe.respondente_nome || "Respondente"}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Dados completos do cadastro no momento da resposta</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <div style={{ background: "#eef6ff", border: "1px solid #dbeafe", borderRadius: 10, padding: "6px 11px", fontSize: 12 }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>🕒 Respondido em: </span><span style={{ color: "#0f172a", fontWeight: 700 }}>{fmtDt(detalhe.enviado_em)}</span></div>
              <div style={{ background: "#eef6ff", border: "1px solid #dbeafe", borderRadius: 10, padding: "6px 11px", fontSize: 12 }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>⏱ Tempo de resposta: </span><span style={{ color: "#0f172a", fontWeight: 700 }}>{fmtDur(detalhe.duracao_seg)}</span></div>
              {detalhe.setor && <div style={{ background: "#eef2ff", border: "1px solid #e0e7ff", borderRadius: 10, padding: "6px 11px", fontSize: 12 }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Setor: </span><span style={{ color: "#4338ca", fontWeight: 700 }}>{detalhe.setor}</span></div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {CADASTRO_CAMPOS.map(({ k, rotulo }) => {
                const v = detalhe.respondente_cadastro?.[k];
                return v ? (
                  <div key={k} style={{ background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, padding: "8px 11px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>{rotulo}</div>
                    <div style={{ fontSize: 12.5, color: "#0f172a", fontWeight: 600, marginTop: 2, wordBreak: "break-word" }}>{String(v)}</div>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal Ficha do empregado - dados AO VIVO da EMPREGADOS + formulários que participou.
          onVinculado: acabou de amarrar um nome solto a um empregado -> recarrega
          os nomes p/ o texto virar link aqui na hora. */}
      {pessoa && <EmpregadoDetalheModal nome={pessoa} onClose={() => setPessoa(null)} onVinculado={carregarNomes} />}
    </div>
  );
}

// Uma opção do gráfico. A contagem responde "quantos"; a pergunta seguinte de
// quem lê é sempre "quem?" — daí o card no hover, com os nomes de quem escolheu
// aquela opção (clicáveis, cada um abre a ficha).
function BarraOpcao({ rotulo, n, pct, pessoas, resolve, resolveQuem, onPessoa }: {
  rotulo: string; n: number; pct: number; pessoas: string[];
  resolve: Resolver; resolveQuem: Resolver; onPessoa: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const mostrar = aberto && pessoas.length > 0;
  return (
    <div onMouseEnter={() => setAberto(true)} onMouseLeave={() => setAberto(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, position: "relative", borderRadius: 9, background: mostrar ? "#f8fafc" : "transparent" }}>
      <span style={{ fontSize: 12.5, color: "#0f172a", width: 180, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rotulo}>
        <NomeLink texto={rotulo} resolve={resolve} onPessoa={onPessoa} />
      </span>
      <div style={{ flex: 1, height: 18, background: "#f1f5f9", borderRadius: 9, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: mostrar ? "#1d4ed8" : "#0f3171", borderRadius: 9, transition: "width .3s, background .15s" }} />
      </div>
      <span style={{ fontSize: 12, color: "#64748b", width: 76, textAlign: "right", flexShrink: 0 }}>{n} ({pct}%)</span>
      {mostrar && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 60, minWidth: 240, maxWidth: 340, maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.16)", padding: "9px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>
            {pessoas.length} {pessoas.length === 1 ? "pessoa escolheu" : "pessoas escolheram"} “{rotulo}”
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {pessoas.map((nome, idx) => (
              <div key={idx} style={{ fontSize: 11.5, color: "#0f172a", lineHeight: 1.5 }}>
                <NomeLink texto={nome} resolve={resolveQuem} onPessoa={onPessoa} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoPergunta({ p, i, resps, resolve, resolveQuem, onPessoa, quem, onVerRespostas }: { p: Pergunta; i: number; resps: Resposta[]; resolve: Resolver; resolveQuem: Resolver; onPessoa: (n: string) => void; quem: (r: Resposta) => string; onVerRespostas: (nome: string) => void }) {
  const valores = useMemo(() => resps.map(r => r.itens[p.id]).filter(v => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)), [resps, p.id]);

  // Ocorrências com a resposta de origem (o valor sozinho perde "quem disse").
  // Arrays (caixas de seleção) viram uma ocorrência por item.
  const ocorrencias = useMemo(() => {
    const out: { v: any; r: Resposta }[] = [];
    resps.forEach(r => {
      const v = r.itens[p.id];
      if (v == null || v === "") return;
      (Array.isArray(v) ? v : [v]).forEach(x => { if (x != null && x !== "") out.push({ v: x, r }); });
    });
    return out;
  }, [resps, p.id]);

  // Agrupa pela IDENTIDADE resolvida, não pelo texto cru: grafias diferentes
  // vinculadas à mesma pessoa ("Iury", "Gerência Sistemas") juntam-se ao nome
  // canônico numa linha só — antes cada grafia virava uma linha duplicada.
  const grupos = useMemo(() => {
    const m = new Map<string, { texto: string; itens: { v: any; r: Resposta }[] }>();
    ocorrencias.forEach(o => {
      const texto = valorTexto(o.v);
      const pess = resolve(texto);
      const rotulo = pess.ehPessoa ? pess.exibir : texto;   // mostra o nome do cadastro
      const chave = normNome(rotulo) || rotulo;
      const g = m.get(chave);
      if (g) g.itens.push(o); else m.set(chave, { texto: rotulo, itens: [o] });
    });
    return [...m.values()];
  }, [ocorrencias, resolve]);

  // Quem escolheu cada opção — sai das ocorrências, que ainda sabem de qual
  // resposta cada valor veio. Nomes repetidos (caixas de seleção respondidas
  // duas vezes pela mesma pessoa) contam uma vez só no card.
  const pessoasPorOpcao = useMemo(() => {
    const m = new Map<string, string[]>();
    ocorrencias.forEach(o => {
      const k = String(o.v);
      const nome = quem(o.r);
      const lista = m.get(k) ?? [];
      if (!lista.includes(nome)) lista.push(nome);
      m.set(k, lista);
    });
    m.forEach(lista => lista.sort((a, b) => a.localeCompare(b, "pt-BR")));
    return m;
  }, [ocorrencias, quem]);

  const conteudo = useMemo(() => {
    // Colegas: o que interessa é o ranking de quem foi indicado - quantas
    // indicações, média das notas e o que escreveram sobre a pessoa.
    if (p.tipo === "colegas")
      return <ResumoColegas resps={resps} pid={p.id} resolve={resolve} onPessoa={onPessoa} quem={quem} />;
    if (["multipla_escolha", "caixas_selecao", "lista_suspensa", "escala"].includes(p.tipo)) {
      const cont: Record<string, number> = {};
      let total = 0;
      valores.forEach(v => (Array.isArray(v) ? v : [v]).forEach(x => { cont[String(x)] = (cont[String(x)] || 0) + 1; total++; }));
      let chaves: string[];
      if (p.tipo === "escala") {
        const min = p.config?.min ?? 1, max = p.config?.max ?? 5;
        chaves = []; for (let n = min; n <= max; n++) chaves.push(String(n));
      } else chaves = p.opcoes.length ? p.opcoes : Object.keys(cont);
      const media = p.tipo === "escala" && valores.length
        ? (valores.reduce((s, v) => s + Number(v), 0) / valores.length).toFixed(1) : null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {media && <div style={{ fontSize: 13, color: "#0f3171", fontWeight: 800 }}>Média: {media}</div>}
          {chaves.map(k => {
            const n = cont[k] || 0;
            const pct = total ? Math.round((n / total) * 100) : 0;
            return (
              <BarraOpcao key={k} rotulo={k} n={n} pct={pct} pessoas={pessoasPorOpcao.get(k) ?? []}
                resolve={resolve} resolveQuem={resolveQuem} onPessoa={onPessoa} />
            );
          })}
        </div>
      );
    }
    if (p.tipo === "numero") {
      const ns = valores.map(Number).filter(n => !isNaN(n));
      if (!ns.length) return <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Sem respostas numéricas.</div>;
      const soma = ns.reduce((s, n) => s + n, 0);
      return <div style={{ fontSize: 13, color: "#0f172a" }}>Média <b>{(soma / ns.length).toFixed(2)}</b> · Mín <b>{Math.min(...ns)}</b> · Máx <b>{Math.max(...ns)}</b> · Soma <b>{soma}</b></div>;
    }
    // texto/data: lista agrupada (nome repetido vira 1 linha + contagem)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 300, overflowY: "auto" }}>
        {grupos.map((g, gi) => (
          <GrupoValor key={gi} texto={g.texto} itens={g.itens} resolve={resolve} resolveQuem={resolveQuem} onPessoa={onPessoa} quem={quem} onVerRespostas={onVerRespostas} />
        ))}
      </div>
    );
  }, [p, valores, grupos, pessoasPorOpcao, resolve, resolveQuem, onPessoa, quem, onVerRespostas]);

  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{i + 1}. {p.titulo}</div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>{valores.length} de {resps.length} responderam</div>
      {conteudo}
    </div>
  );
}

// Resumo da pergunta "colegas": ranking dos indicados. Uma linha por pessoa,
// com quantas indicações recebeu, a média das notas e - ao abrir - o que cada
// respondente escreveu sobre ela. Quem respondeu anônimo entra como "Anônimo".
function ResumoColegas({ resps, pid, resolve, onPessoa, quem }: {
  resps: Resposta[]; pid: string; resolve: Resolver; onPessoa: (n: string) => void; quem: (r: Resposta) => string;
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  const ranking = useMemo(() => {
    const m = new Map<string, { nome: string; setores: Set<string>; n: number; notas: number[]; comentarios: { texto: string; quem: string }[] }>();
    resps.forEach(r => {
      const linhas = Array.isArray(r.itens?.[pid]) ? r.itens[pid] : [];
      linhas.filter(ehLinhaColega).forEach((l: any) => {
        const bruto = String(l.colaborador ?? "").trim();
        if (!bruto) return;
        const pess = resolve(bruto);
        const rotulo = pess.ehPessoa ? pess.exibir : bruto;   // nome do cadastro quando vinculado
        const chave = normNome(rotulo) || rotulo;
        const g = m.get(chave) ?? { nome: rotulo, setores: new Set<string>(), n: 0, notas: [] as number[], comentarios: [] as { texto: string; quem: string }[] };
        g.n += 1;
        if (l.setor) g.setores.add(String(l.setor).trim());
        const nota = Number(l.nota);
        if (!isNaN(nota) && l.nota != null) g.notas.push(nota);
        const txt = String(l.comentario ?? "").trim();
        if (txt) g.comentarios.push({ texto: txt, quem: quem(r) });
        m.set(chave, g);
      });
    });
    return [...m.entries()]
      .map(([chave, g]) => ({ chave, ...g, media: g.notas.length ? g.notas.reduce((s, n) => s + n, 0) / g.notas.length : null }))
      .sort((a, b) => b.n - a.n || (b.media ?? 0) - (a.media ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [resps, pid, resolve, quem]);

  if (!ranking.length) return <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Nenhum colega indicado ainda.</div>;
  const maxN = ranking[0].n;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 460, overflowY: "auto" }}>
      {ranking.map(g => {
        const on = aberto === g.chave;
        return (
          <div key={g.chave} style={{ border: "1px solid #f1f5f9", borderRadius: 9, background: on ? "#f8fafc" : "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 150, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <NomeLink texto={g.nome} resolve={resolve} onPessoa={onPessoa} />
                {[...g.setores].map(s => <span key={s} style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>{s}</span>)}
              </div>
              <div style={{ width: 90, height: 8, background: "#f1f5f9", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
                <div style={{ width: `${Math.round((g.n / maxN) * 100)}%`, height: "100%", background: "#0f3171" }} />
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "#0f172a", flexShrink: 0 }}>{g.n}×</span>
              {g.media != null && <span style={{ fontSize: 11.5, color: "#a16207", fontWeight: 800, flexShrink: 0 }}>★ {g.media.toFixed(1)}</span>}
              {g.comentarios.length > 0 && (
                <button onClick={() => setAberto(on ? null : g.chave)} style={btnMini("#fff", "#0f3171", "1px solid rgba(15,49,113,.25)")}>
                  {on ? "Ocultar" : `${g.comentarios.length} comentário(s)`}
                </button>
              )}
            </div>
            {on && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 10px 9px 10px" }}>
                {g.comentarios.map((c, ci) => (
                  <div key={ci} style={{ background: "#fff", border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 9px" }}>
                    <div style={valorFonte}>{c.texto}</div>
                    <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>— {c.quem}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
