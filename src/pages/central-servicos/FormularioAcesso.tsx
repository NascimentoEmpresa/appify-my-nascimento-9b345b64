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
// A autoridade continua sendo a RLS — aqui é só a interface.
// =====================================================================

export const PAPEIS = [
  { valor: "form_dono",      rotulo: "Dono",      resumo: "Tudo: editar, excluir e gerenciar o acesso" },
  { valor: "form_gerenciar", rotulo: "Gerenciar", resumo: "Editar, ver respostas e gerenciar o acesso" },
  { valor: "form_editar",    rotulo: "Editar",    resumo: "Editar as perguntas e ver as respostas" },
  { valor: "form_ver",       rotulo: "Ver",       resumo: "Somente ler as respostas" },
] as const;

const rotuloPapel = (p: string) => PAPEIS.find((x) => x.valor === p)?.rotulo ?? p;
// Quem pode mexer na própria lista — é por eles que se mede "a lista ficou órfã".
const GERENCIAM = ["form_dono", "form_gerenciar"];

interface Linha { id: number; user_id: string; papel: string }
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

  const carregar = async () => {
    const [aRes, pRes] = await Promise.all([
      // `.in(papel)`: o formulário também guarda linhas de LEITURA por
      // formulário (20260921000002), que não pertencem a esta lista. Sem o
      // filtro elas apareceriam como gente na lista e — pior — ligariam o
      // modo restrito (`restrito = linhas.length > 0`) sem ninguém pedir.
      (supabase as any).from("CS_FORM_ACESSOS").select("id,user_id,papel")
        .eq("formulario_id", formulario.id)
        .in("papel", PAPEIS.map((p) => p.valor)),
      (supabase as any).from("profiles").select("id,display_name,email").order("display_name"),
    ]);
    if (aRes.error) toast("Erro ao carregar o acesso: " + aRes.error.message, "err");
    setLinhas((aRes.data ?? []) as Linha[]);
    setPerfis((pRes.data ?? []) as Perfil[]);
    setCarregando(false);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [formulario.id]);

  const nomeDe = (userId: string) => {
    const p = perfis.find((x) => x.id === userId);
    return p?.display_name?.trim() || p?.email || userId.slice(0, 8) + "…";
  };

  const restrito = linhas.length > 0;
  const candidatos = useMemo(() => {
    const jaTem = new Set(linhas.map((l) => l.user_id));
    const t = busca.trim().toLowerCase();
    return perfis
      .filter((p) => !jaTem.has(p.id))
      .filter((p) => !t || [p.display_name, p.email].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [perfis, linhas, busca]);

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
            global de editar formulários e não está na lista <b>não</b> mexe nele. Quem tem “ver todas as respostas”
            continua lendo e consegue reatribuir esta lista.</>
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
