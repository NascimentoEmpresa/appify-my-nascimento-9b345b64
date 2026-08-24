import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Formulario } from "./Formularios";

// =====================================================================
// ACESSO DE UM FORMULÁRIO
//
// Espelha a migration 20260906000004. A regra que dá sentido à tela:
//   - Formulário SEM ninguém na lista  -> aberto, valem as permissões
//     globais de Acesso por Usuário (é como tudo funcionava antes).
//   - Assim que entra a PRIMEIRA pessoa -> o formulário fica restrito a
//     ela. Quem tem 'editar_criar' global e não está na lista perde este
//     formulário.
// Por isso a tela avisa em voz alta na hora de adicionar o primeiro nome:
// é o clique que muda o regime, e ninguém adivinha isso sozinho.
//
// DUAS CAMADAS, na mesma tela (21/08/2026):
//   1. PAPEL no formulário — quem administra: Dono / Gerenciar / Editar /
//      Ver. É o que liga o modo restrito descrito acima.
//   2. RESPOSTAS — o que a pessoa enxerga DESTE formulário: tudo, só as
//      próprias, ou por setor de quem respondeu. Grava as linhas de leitura
//      por formulário da migration 20260921000002, e SUBSTITUI a permissão
//      geral dela (Acesso por Usuário) dentro deste formulário.
//   As duas são independentes: dá para alguém administrar sem ver resposta
//   nenhuma, e para alguém ver tudo sem poder mexer no formulário.
//
// RESPONDER é uma TERCEIRA pergunta, e ela NÃO se decide aqui: quem
// responde vem do público-alvo do editor (segurança + setores + pessoas
// escolhidas). Desde 20260921000004 quem está na lista abaixo também
// responde, esteja ou não no alvo — administrar um formulário não pode
// excluir você dele.
//
// A autoridade continua sendo a RLS — aqui é só a interface.
// =====================================================================

export const PAPEIS = [
  { valor: "form_dono",      rotulo: "Dono",      resumo: "Tudo: editar, excluir e gerenciar o acesso" },
  { valor: "form_gerenciar", rotulo: "Gerenciar", resumo: "Editar, ver respostas e gerenciar o acesso" },
  { valor: "form_editar",    rotulo: "Editar",    resumo: "Editar as perguntas e ver as respostas" },
  { valor: "form_ver",       rotulo: "Ver",       resumo: "Somente ler as respostas" },
] as const;

/** As capacidades de LEITURA que valem por formulário (20260921000002). */
const CAPS_VER = [
  { valor: "ver_tudo",     rotulo: "Todas as respostas" },
  { valor: "ver_proprias", rotulo: "Só as que ela enviou" },
] as const;

// ver_tudo x ver_proprias se contradizem: ligar um desliga o outro, senão
// "só as próprias" fica escrito na tela enquanto a pessoa vê tudo.
const OPOSTO: Record<string, string> = { ver_tudo: "ver_proprias", ver_proprias: "ver_tudo" };

/**
 * Papel MARCADOR: presença = "o que esta pessoa vê deste formulário está
 * definido aqui". Sem ele, vale a permissão geral dela. Com ele e nada
 * marcado, ela não vê resposta nenhuma DESTE formulário — que é justamente
 * o que não dava para expressar antes.
 */
const MARCADOR = "ver_regra_form";
const PAPEIS_LISTA = PAPEIS.map((p) => p.valor) as unknown as string[];
const PAPEIS_LEITURA = [MARCADOR, "ver_tudo", "ver_proprias", "ver_setor"];

const rotuloPapel = (p: string) => PAPEIS.find((x) => x.valor === p)?.rotulo ?? p;
// Quem pode mexer na própria lista — é por eles que se mede "a lista ficou órfã".
const GERENCIAM = ["form_dono", "form_gerenciar"];
const chaveSetor = (s: string) => s.trim().toUpperCase();

interface Linha { id: number; user_id: string; papel: string }
/** O que a pessoa vê deste formulário, quando há regra própria. */
interface RegraVer { caps: Set<string>; setores: Set<string> }
interface Perfil { id: string; display_name: string | null; email: string | null }

const cx = {
  fundo: { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex",
           alignItems: "center", justifyContent: "center", zIndex: 950 } as React.CSSProperties,
  caixa: { background: "#fff", borderRadius: 16, padding: 22, width: 620, maxWidth: "94vw",
           maxHeight: "88vh", overflowY: "auto" } as React.CSSProperties,
  btn: (bg: string, c = "#fff", border = "none"): React.CSSProperties => ({
    background: bg, color: c, border, borderRadius: 8, padding: "7px 12px",
    fontSize: 13, fontWeight: 600, cursor: "pointer" }),
  sel: { padding: "6px 8px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 } as React.CSSProperties,
  chip: (on: boolean): React.CSSProperties => ({
    padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? "#bfdbfe" : "#e2e8f0"}`, background: on ? "#eff6ff" : "#fff",
    color: on ? "#1d4ed8" : "#64748b" }),
};

export function FormularioAcesso({ formulario, onFechar, onSalvo, toast }: {
  formulario: Formulario;
  onFechar: () => void;
  onSalvo: () => void;
  toast: (m: string, t?: string) => void;
}) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [novoUser, setNovoUser] = useState("");
  const [novoPapel, setNovoPapel] = useState<string>("form_dono");
  const [busca, setBusca] = useState("");
  // Regra de leitura por pessoa: user_id -> o que ela vê deste formulário.
  // Só entra no mapa quem tem o marcador.
  const [regras, setRegras] = useState<Map<string, RegraVer>>(new Map());
  const [setoresCatalogo, setSetoresCatalogo] = useState<string[]>([]);
  const [abertoSetores, setAbertoSetores] = useState<string | null>(null);  // user_id com a lista de setores aberta
  const [novoVer, setNovoVer] = useState("");     // pessoa a ganhar regra de leitura
  const [buscaVer, setBuscaVer] = useState("");

  const carregar = async () => {
    const [aRes, rRes, uRes, pRes] = await Promise.all([
      // `.in(papel)`: o formulário também guarda linhas de LEITURA por
      // formulário (20260921000002), que não pertencem a esta lista. Sem o
      // filtro elas apareceriam como gente na lista e — pior — ligariam o
      // modo restrito (`restrito = linhas.length > 0`) sem ninguém pedir.
      (supabase as any).from("CS_FORM_ACESSOS").select("id,user_id,papel")
        .eq("formulario_id", formulario.id)
        .in("papel", PAPEIS_LISTA),
      // As linhas de LEITURA deste formulário, de todo mundo. São outra
      // camada: não contam como "gente na lista" e não ligam o modo restrito.
      (supabase as any).from("CS_FORM_ACESSOS").select("id,user_id,papel,setor")
        .eq("formulario_id", formulario.id)
        .in("papel", PAPEIS_LEITURA),
      // Os NOMES. `profiles` só é legível por quem tem administracao:visualizar
      // (policy profiles_self_select), então ler a tabela direto mostrava o UUID
      // cru para todo dono de formulário que não fosse admin — inclusive no
      // seletor "Escolha a pessoa…", que vinha praticamente vazio. A RPC
      // listar_usuarios_ativos é SECURITY DEFINER e devolve só id/nome/setor a
      // qualquer autenticado; é a mesma que Chamados e Reuniões usam.
      (supabase as any).rpc("listar_usuarios_ativos"),
      // Complemento opcional: quem é admin ganha o e-mail (ajuda a distinguir
      // homônimos) e os usuários INATIVOS que ainda estejam na lista. Sem
      // permissão isto volta vazio, sem erro — a RPC acima já garante o nome.
      (supabase as any).from("profiles").select("id,display_name,email"),
    ]);
    if (aRes.error) toast("Erro ao carregar o acesso: " + aRes.error.message, "err");
    setLinhas((aRes.data ?? []) as Linha[]);
    const mapa = new Map<string, RegraVer>();
    (rRes.data ?? []).forEach((r: any) => {
      const atual = mapa.get(r.user_id) ?? { caps: new Set<string>(), setores: new Set<string>() };
      if (r.papel === "ver_setor" && r.setor) atual.setores.add(chaveSetor(String(r.setor)));
      else if (r.papel !== MARCADOR) atual.caps.add(r.papel);
      mapa.set(r.user_id, atual);
    });
    setRegras(mapa);
    const pessoas = new Map<string, Perfil>();
    (uRes.data ?? []).forEach((u: any) =>
      pessoas.set(u.id, { id: u.id, display_name: u.display_name ?? null, email: null }));
    (pRes.data ?? []).forEach((p: any) =>
      pessoas.set(p.id, {
        id: p.id,
        display_name: p.display_name ?? pessoas.get(p.id)?.display_name ?? null,
        email: p.email ?? null,
      }));
    setPerfis([...pessoas.values()].sort((a, b) =>
      (a.display_name ?? a.email ?? "").localeCompare(b.display_name ?? b.email ?? "", "pt-BR")));
    setCarregando(false);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [formulario.id]);

  // Setores para o recorte "por setor de quem respondeu". Mesma fonte do painel
  // Acesso por Usuário: une o Setor_ERP do cadastro com o setor carimbado nas
  // respostas (RPC cs_form_setores_catalogo, SECURITY DEFINER, só nomes).
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("cs_form_setores_catalogo");
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
      const porChave = new Map<string, string>();
      (data ?? []).forEach((r: any) => {
        const l = String(r.setor ?? "").trim();
        if (!l) return;
        const k = norm(l);
        if (k === "PADRAO" || porChave.has(k)) return;
        porChave.set(k, l);
      });
      setSetoresCatalogo([...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR")));
    })();
  }, []);

  const nomeDe = (userId: string) => {
    const p = perfis.find((x) => x.id === userId);
    return p?.display_name?.trim() || p?.email || userId.slice(0, 8) + "…";
  };

  const restrito = linhas.length > 0;
  const filtraPessoas = (termo: string, excluir: Set<string>) => {
    const t = termo.trim().toLowerCase();
    return perfis
      .filter((p) => !excluir.has(p.id))
      .filter((p) => !t || [p.display_name, p.email].some((v) => String(v ?? "").toLowerCase().includes(t)));
  };
  const candidatos = useMemo(
    () => filtraPessoas(busca, new Set(linhas.map((l) => l.user_id))),
    /* eslint-disable-next-line react-hooks/exhaustive-deps */ [perfis, linhas, busca]);
  const candidatosVer = useMemo(
    () => filtraPessoas(buscaVer, new Set(regras.keys())),
    /* eslint-disable-next-line react-hooks/exhaustive-deps */ [perfis, regras, buscaVer]);

  const erroRls = (m: string) =>
    /row-level|policy|permission/i.test(m) ? "Você não tem permissão para gerenciar o acesso deste formulário." : m;

  const adicionar = async () => {
    if (!novoUser || salvando) return;
    // O primeiro nome é o que liga o modo restrito. Confirmar aqui evita a
    // surpresa de "sumiu o formulário da tela de todo mundo".
    if (!restrito) {
      const ok = window.confirm(
        `Ao adicionar a primeira pessoa, "${formulario.titulo}" passa a ser RESTRITO:\n\n` +
        `só quem estiver nesta lista poderá administrá-lo, mesmo quem tem permissão global de editar formulários.\n\n` +
        `Quem tem "ver todas as respostas" continua conseguindo ler e reatribuir o acesso.\n\nContinuar?`);
      if (!ok) return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("CS_FORM_ACESSOS")
      .insert({ formulario_id: formulario.id, user_id: novoUser, papel: novoPapel });
    setSalvando(false);
    if (error) { toast("Erro ao adicionar: " + erroRls(error.message), "err"); return; }
    setNovoUser(""); setBusca("");
    await carregar(); onSalvo();
    toast("Acesso concedido.", "ok");
  };

  const trocarPapel = async (l: Linha, papel: string) => {
    if (papel === l.papel) return;
    // Rebaixar o último que gerencia deixa a lista sem quem a mantenha.
    const sobram = linhas.filter((x) => x.id !== l.id && GERENCIAM.includes(x.papel));
    if (GERENCIAM.includes(l.papel) && !GERENCIAM.includes(papel) && sobram.length === 0) {
      const ok = window.confirm(
        "Esta é a última pessoa que pode gerenciar o acesso deste formulário.\n\n" +
        "Rebaixando o papel dela, só quem tem \"ver todas as respostas\" conseguirá reabrir esta lista.\n\nContinuar?");
      if (!ok) return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).from("CS_FORM_ACESSOS").update({ papel }).eq("id", l.id);
    setSalvando(false);
    if (error) { toast("Erro ao alterar: " + erroRls(error.message), "err"); return; }
    await carregar(); onSalvo();
  };

  const remover = async (l: Linha) => {
    const ultimo = linhas.length === 1;
    const sobram = linhas.filter((x) => x.id !== l.id && GERENCIAM.includes(x.papel));
    const aviso = ultimo
      ? `Removendo ${nomeDe(l.user_id)}, a lista fica vazia e "${formulario.titulo}" VOLTA A SER ABERTO — ` +
        "todo mundo com permissão global de formulários volta a administrá-lo.\n\nContinuar?"
      : GERENCIAM.includes(l.papel) && sobram.length === 0
        ? "Esta é a última pessoa que pode gerenciar o acesso deste formulário.\n\n" +
          "Sem ela, só quem tem \"ver todas as respostas\" conseguirá reabrir esta lista.\n\nContinuar?"
        : `Remover ${nomeDe(l.user_id)} do acesso a este formulário?`;
    if (!window.confirm(aviso)) return;
    setSalvando(true);
    const { error } = await (supabase as any).from("CS_FORM_ACESSOS").delete().eq("id", l.id);
    setSalvando(false);
    if (error) { toast("Erro ao remover: " + erroRls(error.message), "err"); return; }
    await carregar(); onSalvo();
  };

  // ── Camada 2: o que cada pessoa vê DESTE formulário ────────────────────
  // Mesma gravação do painel Acesso por Usuário (ModulosMenusTab), só que
  // fixada neste formulário: linhas em CS_FORM_ACESSOS com formulario_id.

  /** Reflete a mudança no estado local, sem recarregar o modal inteiro. */
  const mexerRegra = (userId: string, f: (r: RegraVer) => RegraVer | null) => {
    setRegras((m) => {
      const n = new Map(m);
      const atual = n.get(userId) ?? { caps: new Set<string>(), setores: new Set<string>() };
      const novo = f({ caps: new Set(atual.caps), setores: new Set(atual.setores) });
      if (novo) n.set(userId, novo); else n.delete(userId);
      return n;
    });
  };

  const linhaBase = { formulario_id: formulario.id };
  const apagaLeitura = (userId: string, papel: string) => (supabase as any).from("CS_FORM_ACESSOS")
    .delete().eq("formulario_id", formulario.id).eq("user_id", userId).eq("papel", papel);

  /** Grava o marcador: daqui em diante quem manda neste formulário é esta tela. */
  const definirRegra = async (userId: string) => {
    if (!userId || regras.has(userId) || salvando) return;
    setSalvando(true);
    const { error } = await (supabase as any).from("CS_FORM_ACESSOS")
      .insert({ ...linhaBase, papel: MARCADOR, user_id: userId });
    setSalvando(false);
    if (error) { toast("Erro ao definir: " + erroRls(error.message), "err"); return; }
    mexerRegra(userId, (r) => r);
    setNovoVer(""); setBuscaVer("");
    onSalvo();
  };

  /** Apagar tudo devolve a pessoa à permissão geral dela. */
  const removerRegra = async (userId: string) => {
    if (!window.confirm(
      `${nomeDe(userId)} volta a valer pela permissão geral de Acesso por Usuário neste formulário.\n\nContinuar?`)) return;
    setSalvando(true);
    const { error } = await (supabase as any).from("CS_FORM_ACESSOS")
      .delete().eq("formulario_id", formulario.id).eq("user_id", userId).in("papel", PAPEIS_LEITURA);
    setSalvando(false);
    if (error) { toast("Erro ao remover: " + erroRls(error.message), "err"); return; }
    mexerRegra(userId, () => null);
    if (abertoSetores === userId) setAbertoSetores(null);
    onSalvo();
  };

  const alternarCap = async (userId: string, cap: string) => {
    const r = regras.get(userId);
    if (!r || salvando) return;
    const tem = r.caps.has(cap);
    const oposto = !tem ? OPOSTO[cap] : undefined;
    setSalvando(true);
    if (tem) {
      const { error } = await apagaLeitura(userId, cap);
      setSalvando(false);
      if (error) { toast("Erro: " + erroRls(error.message), "err"); return; }
    } else {
      if (oposto && r.caps.has(oposto)) await apagaLeitura(userId, oposto);
      const { error } = await (supabase as any).from("CS_FORM_ACESSOS")
        .insert({ ...linhaBase, papel: cap, user_id: userId });
      setSalvando(false);
      if (error) { toast("Erro: " + erroRls(error.message), "err"); return; }
    }
    mexerRegra(userId, (x) => {
      if (tem) x.caps.delete(cap);
      else { x.caps.add(cap); if (oposto) x.caps.delete(oposto); }
      return x;
    });
    onSalvo();
  };

  const alternarSetor = async (userId: string, setor: string) => {
    if (salvando) return;
    const chave = chaveSetor(setor);
    const tem = regras.get(userId)?.setores.has(chave) ?? false;
    setSalvando(true);
    const { error } = tem
      ? await (supabase as any).from("CS_FORM_ACESSOS").delete()
          .eq("formulario_id", formulario.id).eq("user_id", userId).eq("papel", "ver_setor").eq("setor", setor)
      : await (supabase as any).from("CS_FORM_ACESSOS")
          .insert({ ...linhaBase, papel: "ver_setor", user_id: userId, setor });
    setSalvando(false);
    if (error) { toast("Erro: " + erroRls(error.message), "err"); return; }
    mexerRegra(userId, (x) => { if (tem) x.setores.delete(chave); else x.setores.add(chave); return x; });
    onSalvo();
  };

  /** Resumo em uma linha do que a regra concede — é o que se lê de relance. */
  const resumoRegra = (r: RegraVer) => {
    const partes: string[] = [];
    if (r.caps.has("ver_tudo")) partes.push("todas as respostas");
    if (r.caps.has("ver_proprias")) partes.push("só as que ela enviou");
    if (r.setores.size) partes.push(`setor: ${[...r.setores].sort().join(", ")}`);
    return partes.length ? partes.join(" + ") : "não vê nenhuma resposta deste formulário";
  };
  // Os QUATRO papéis da lista já leem todas as respostas (cs_form_pode(_,'ver')),
  // e esse ramo da policy não passa pela regra própria. Sem este aviso a tela
  // diria "não vê nenhuma resposta" para alguém que vê todas pelo papel.
  const papelNaLista = (userId: string) => linhas.find((l) => l.user_id === userId)?.papel ?? null;

  return (
    <div style={cx.fundo} onClick={onFechar}>
      <div style={cx.caixa} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, color: "#0f172a" }}>Acesso ao formulário</h3>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>{formulario.titulo}</p>
          </div>
          <button onClick={onFechar} style={cx.btn("transparent", "#94a3b8")}>✕</button>
        </div>

        {/* Regime atual — é a informação mais importante da tela. */}
        <div style={{
          marginTop: 14, padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
          background: restrito ? "#eff6ff" : "#f8fafc",
          border: `1px solid ${restrito ? "#bfdbfe" : "#e2e8f0"}`,
          color: restrito ? "#1e40af" : "#475569",
        }}>
          {restrito ? (
            <>🔒 <b>Restrito.</b> Só as {linhas.length} pessoa(s) abaixo administram este formulário — quem tem permissão
            global de editar formulários e não está na lista <b>não</b> mexe nele, e o formulário some da tela de gestão
            dele. Quem tem “ver todas as respostas” continua lendo e consegue reatribuir esta lista.</>
          ) : (
            <>🌐 <b>Aberto.</b> Ninguém foi definido, então valem as permissões globais de Administração › Acesso por
            Usuário. Adicionar a primeira pessoa torna este formulário restrito a ela.</>
          )}
        </div>

        {carregando ? (
          <p style={{ marginTop: 16, fontSize: 13, color: "#94a3b8" }}>Carregando…</p>
        ) : (
          <>
            {linhas.length > 0 && (
              <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                {linhas.map((l, i) => (
                  <div key={l.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 11px",
                    borderTop: i ? "1px solid #f1f5f9" : "none",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {nomeDe(l.user_id)}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
                        {PAPEIS.find((p) => p.valor === l.papel)?.resumo ?? rotuloPapel(l.papel)}
                      </div>
                    </div>
                    <select value={l.papel} onChange={(e) => trocarPapel(l, e.target.value)} disabled={salvando} style={cx.sel}>
                      {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                    </select>
                    <button onClick={() => remover(l)} disabled={salvando} style={cx.btn("transparent", "#dc2626")}>Remover</button>
                  </div>
                ))}
              </div>
            )}

            {/* Adicionar pessoa */}
            <div style={{ marginTop: 14, padding: 12, border: "1px dashed #cbd5e1", borderRadius: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Dar acesso a alguém</div>
              <input
                value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select value={novoUser} onChange={(e) => setNovoUser(e.target.value)} style={{ ...cx.sel, flex: 1, minWidth: 200 }}>
                  <option value="">Escolha a pessoa…</option>
                  {candidatos.slice(0, 200).map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name?.trim() || p.email || p.id}</option>
                  ))}
                </select>
                <select value={novoPapel} onChange={(e) => setNovoPapel(e.target.value)} style={cx.sel}>
                  {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                </select>
                <button onClick={adicionar} disabled={!novoUser || salvando} style={cx.btn(novoUser ? "#0f3171" : "#cbd5e1")}>
                  Adicionar
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>
                {PAPEIS.map((p) => <div key={p.valor}><b>{p.rotulo}:</b> {p.resumo}</div>)}
                <div style={{ marginTop: 6, color: "#0f766e" }}>
                  Todos eles também <b>respondem</b> este formulário, mesmo fora do público-alvo definido no editor.
                </div>
              </div>
            </div>

            {/* ── Camada 2: leitura das respostas ─────────────────────────
                Independente da lista acima: vale para qualquer pessoa, esteja
                ou não nela. Espelha as linhas de leitura por formulário. */}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>Quem vê as respostas deste formulário</div>
              <p style={{ margin: "4px 0 10px", fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>
                Por padrão cada pessoa lê pelo que tem em Administração › Acesso por Usuário. Definir alguém aqui
                <b> substitui</b> a permissão geral dela <i>neste</i> formulário — inclusive para menos: sem nada marcado,
                ela não vê resposta nenhuma daqui.
              </p>

              {regras.size > 0 && (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                  {[...regras.entries()]
                    .sort((a, b) => nomeDe(a[0]).localeCompare(nomeDe(b[0]), "pt-BR"))
                    .map(([userId, r], i) => (
                      <div key={userId} style={{ borderTop: i ? "1px solid #f1f5f9" : "none", padding: "9px 11px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {nomeDe(userId)}
                            </div>
                            <div style={{ fontSize: 11.5, color: r.caps.size || r.setores.size ? "#94a3b8" : "#b45309" }}>
                              {resumoRegra(r)}
                            </div>
                            {papelNaLista(userId) && (
                              <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                                ⚠ Está na lista acima como <b>{rotuloPapel(papelNaLista(userId)!)}</b> — o papel já dá
                                acesso a todas as respostas, e isto aqui não tira. Para limitar, mude o papel dela.
                              </div>
                            )}
                          </div>
                          <button onClick={() => removerRegra(userId)} disabled={salvando} style={cx.btn("transparent", "#dc2626")}>
                            Usar a geral
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                          {CAPS_VER.map((c) => (
                            <button key={c.valor} onClick={() => alternarCap(userId, c.valor)} disabled={salvando}
                              style={cx.chip(r.caps.has(c.valor))}>
                              {r.caps.has(c.valor) ? "✓ " : ""}{c.rotulo}
                            </button>
                          ))}
                          <button onClick={() => setAbertoSetores(abertoSetores === userId ? null : userId)}
                            style={cx.chip(r.setores.size > 0)}>
                            Por setor{r.setores.size ? ` (${r.setores.size})` : ""} {abertoSetores === userId ? "▴" : "▾"}
                          </button>
                        </div>
                        {abertoSetores === userId && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7, paddingLeft: 2 }}>
                            {setoresCatalogo.length === 0 && (
                              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Carregando setores…</span>
                            )}
                            {setoresCatalogo.map((s) => (
                              <button key={s} onClick={() => alternarSetor(userId, s)} disabled={salvando}
                                style={cx.chip(r.setores.has(chaveSetor(s)))}>
                                {r.setores.has(chaveSetor(s)) ? "✓ " : ""}{s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}

              <div style={{ marginTop: 10, padding: 12, border: "1px dashed #cbd5e1", borderRadius: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Definir a leitura de alguém</div>
                <input
                  value={buscaVer} onChange={(e) => setBuscaVer(e.target.value)}
                  placeholder="Buscar por nome ou e-mail…"
                  style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={novoVer} onChange={(e) => setNovoVer(e.target.value)} style={{ ...cx.sel, flex: 1, minWidth: 200 }}>
                    <option value="">Escolha a pessoa…</option>
                    {candidatosVer.slice(0, 200).map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name?.trim() || p.email || p.id}</option>
                    ))}
                  </select>
                  <button onClick={() => definirRegra(novoVer)} disabled={!novoVer || salvando}
                    style={cx.btn(novoVer ? "#0f3171" : "#cbd5e1")}>
                    Definir
                  </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>
                  Entra sem nada marcado — ou seja, sem ver resposta alguma daqui até você marcar o que ela vê.
                </div>
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onFechar} style={cx.btn("#f1f5f9", "#334155", "1px solid #e2e8f0")}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
