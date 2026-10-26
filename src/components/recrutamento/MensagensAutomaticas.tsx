import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// RECRUTAMENTO › Mensagens automáticas de WhatsApp por etapa
// (SIS-2026-0667, mig 20261014000049)
//
// Cada etapa do kanban dispara UMA OU MAIS mensagens da biblioteca do
// WhatsApp (WA_TEMPLATE — as mesmas da "/" na Caixa de Entrada). Antes era
// um "nome de template" digitado à mão por etapa, que nunca foi criado na
// Meta: o log só tinha "(#132001) Template name does not exist".
//
// O que a tela precisa deixar claro (pedido do Pablo): sem aprovação da Meta
// a mensagem só chega a quem escreveu nas últimas 24h — e a Meta leva de
// horas a alguns dias para aprovar. Por isso o status de cada mensagem fica
// à vista e há um botão que manda todas as pendentes para aprovação.
//
// As lacunas ({{n}}) se preenchem sozinhas com os dados do candidato e da
// vaga; o que não dá para saber (ex.: o link do formulário) vira VALOR FIXO
// aqui; o banco do salário é perguntado na hora de contratar.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

/** Etapas na ordem do funil. CONTRATADO = o "Contratar (enviar à Admissão)". */
export const ETAPAS_MSG: { etapa: string; rotulo: string; dica?: string }[] = [
  { etapa: "ENTRADA", rotulo: "Entrada", dica: "quando o candidato é selecionado para o processo" },
  { etapa: "TRIAGEM", rotulo: "Triagem" },
  { etapa: "JURÍDICO", rotulo: "Jurídico" },
  { etapa: "ENTREVISTA", rotulo: "Entrevista" },
  { etapa: "ENTREVISTA GESTOR", rotulo: "Entrevista com gestor" },
  { etapa: "APROVADO", rotulo: "Em admissão" },
  { etapa: "DOCUMENTAÇÃO", rotulo: "Documentação" },
  { etapa: "SST + COMPRAS", rotulo: "SST + Compras" },
  { etapa: "ADMISSÃO", rotulo: "Admissão concluída" },
  { etapa: "CONTRATADO", rotulo: "Contratado", dica: "ao clicar \"Contratar (enviar à Admissão)\" — a tela pede data de início, local e banco" },
];

/** Rótulos que a Edge preenche sozinha (recrutamento-mensagem). */
const AUTOMATICAS = ["primeiro nome", "nome", "cargo", "cidade", "contrato", "empresa", "data de inicio", "local / posto"];
/** Perguntados na hora de contratar. */
const NA_CONTRATACAO = ["banco do salario", "data de inicio", "local / posto"];
const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

interface Tpl { codigo: string; titulo: string; texto: string; variaveis: string[] | null; template_nome: string | null }
interface Vinculo { etapa: string; codigo: string; ordem: number; ativo: boolean }

const STATUS: Record<string, { txt: string; bg: string; fg: string }> = {
  APPROVED: { txt: "aprovada pela Meta", bg: "#dcfce7", fg: "#15803d" },
  PENDING: { txt: "em análise na Meta", bg: "#fef3c7", fg: "#b45309" },
  REJECTED: { txt: "reprovada pela Meta", bg: "#fee2e2", fg: "#b91c1c" },
  NAO_CRIADO: { txt: "não enviada à Meta", bg: "#f1f5f9", fg: "#475569" },
  SEM_TEMPLATE: { txt: "só em 24h", bg: "#f1f5f9", fg: "#475569" },
};

export function MensagensAutomaticas({ onFechar, podeEditar, toast }: {
  onFechar: () => void;
  podeEditar: boolean;
  toast: (msg: string, tipo?: "ok" | "err" | "info") => void;
}) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, { status: string; motivo?: string }> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [enviandoMeta, setEnviandoMeta] = useState(false);

  const consultarStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("whatsapp-template-enviar", { body: { acao: "status" } });
    if (error) { setStatus({}); return; }
    const mapa: Record<string, { status: string; motivo?: string }> = {};
    for (const t of ((data as { templates?: { codigo: string; status: string; motivo?: string }[] })?.templates ?? [])) mapa[t.codigo] = t;
    setStatus(mapa);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [t, v, f] = await Promise.all([
      db.from("WA_TEMPLATE").select("codigo, titulo, texto, variaveis, template_nome").eq("ativo", true).order("ordem").order("titulo"),
      db.from("RECRUTAMENTO_MENSAGEM_ETAPA").select("etapa, codigo, ordem, ativo").order("ordem"),
      db.from("RECRUTAMENTO_MENSAGEM_VALOR").select("variavel, valor"),
    ]);
    setCarregando(false);
    if (t.error || v.error) { toast("Não consegui carregar as mensagens: " + (t.error ?? v.error)?.message, "err"); return; }
    setTpls((t.data ?? []) as Tpl[]);
    setVinculos((v.data ?? []) as Vinculo[]);
    const fx: Record<string, string> = {};
    for (const r of (f.data ?? []) as { variavel: string; valor: string | null }[]) fx[r.variavel] = r.valor ?? "";
    setValores(fx);
  }, [toast]);

  useEffect(() => { carregar(); consultarStatus(); }, [carregar, consultarStatus]);

  const porCodigo = useMemo(() => new Map(tpls.map(t => [t.codigo, t])), [tpls]);
  const daEtapa = (etapa: string) => vinculos.filter(v => v.etapa === etapa).sort((a, b) => a.ordem - b.ordem);

  // Variáveis que ninguém preenche sozinho → precisam de valor fixo.
  const variaveisFixas = useMemo(() => {
    const s = new Set<string>(Object.keys(valores));
    for (const v of vinculos) {
      for (const rotulo of porCodigo.get(v.codigo)?.variaveis ?? []) {
        const k = chave(rotulo);
        if (AUTOMATICAS.includes(k)) continue;
        if (v.etapa === "CONTRATADO" && NA_CONTRATACAO.includes(k)) continue;
        s.add(rotulo);
      }
    }
    return [...s].sort();
  }, [vinculos, porCodigo, valores]);

  const adicionar = (etapa: string, codigo: string) => {
    if (!codigo || vinculos.some(v => v.etapa === etapa && v.codigo === codigo)) return;
    const ordem = Math.max(0, ...daEtapa(etapa).map(v => v.ordem)) + 1;
    setVinculos(vs => [...vs, { etapa, codigo, ordem, ativo: true }]);
  };
  const remover = (etapa: string, codigo: string) => setVinculos(vs => vs.filter(v => !(v.etapa === etapa && v.codigo === codigo)));
  const alternar = (etapa: string, codigo: string) =>
    setVinculos(vs => vs.map(v => (v.etapa === etapa && v.codigo === codigo ? { ...v, ativo: !v.ativo } : v)));

  const salvar = async () => {
    setSalvando(true);
    try {
      const { data: antes } = await db.from("RECRUTAMENTO_MENSAGEM_ETAPA").select("etapa, codigo");
      const fica = new Set(vinculos.map(v => `${v.etapa}|${v.codigo}`));
      for (const a of (antes ?? []) as { etapa: string; codigo: string }[]) {
        if (!fica.has(`${a.etapa}|${a.codigo}`)) {
          const { error } = await db.from("RECRUTAMENTO_MENSAGEM_ETAPA").delete().eq("etapa", a.etapa).eq("codigo", a.codigo);
          if (error) throw error;
        }
      }
      if (vinculos.length) {
        const { error } = await db.from("RECRUTAMENTO_MENSAGEM_ETAPA").upsert(
          vinculos.map(v => ({ etapa: v.etapa, codigo: v.codigo, ordem: v.ordem, ativo: v.ativo, atualizado_em: new Date().toISOString() })),
          { onConflict: "etapa,codigo" });
        if (error) throw error;
      }
      const linhasValor = variaveisFixas.map(k => ({ variavel: k, valor: (valores[k] ?? "").trim() || null, atualizado_em: new Date().toISOString() }));
      if (linhasValor.length) {
        const { error } = await db.from("RECRUTAMENTO_MENSAGEM_VALOR").upsert(linhasValor, { onConflict: "variavel" });
        if (error) throw error;
      }
      toast("Mensagens automáticas salvas.", "ok");
      onFechar();
    } catch (e) {
      toast("Erro ao salvar: " + (e as Error).message, "err");
    } finally {
      setSalvando(false);
    }
  };

  // Manda à Meta todas as mensagens usadas nas etapas que ainda não foram.
  const enviarTodasMeta = async () => {
    const usadas = [...new Set(vinculos.map(v => v.codigo))];
    const pendentes = usadas.filter(c => porCodigo.get(c)?.template_nome && (!status?.[c] || status[c].status === "NAO_CRIADO" || status[c].status === "REJECTED"));
    if (!pendentes.length) { toast("Todas as mensagens das etapas já foram enviadas à Meta.", "info"); return; }
    if (!confirm(`Enviar ${pendentes.length} mensagem(ns) para aprovação da Meta?\n\nA Meta revisa cada uma — costuma levar de algumas horas a alguns dias. Até aprovar, a mensagem só chega a quem escreveu nas últimas 24h.`)) return;
    setEnviandoMeta(true);
    const erros: string[] = [];
    let ok = 0;
    for (const codigo of pendentes) {
      const { data, error } = await supabase.functions.invoke("whatsapp-template-enviar", { body: { acao: "criar_template", codigo } });
      const d = data as { ok?: boolean; error?: string } | null;
      if (error || !d?.ok) erros.push(`${porCodigo.get(codigo)?.titulo ?? codigo}: ${d?.error ?? error?.message ?? "erro"}`);
      else ok++;
    }
    setEnviandoMeta(false);
    if (ok) toast(`${ok} enviada(s) para aprovação da Meta. Acompanhe o status aqui — pode levar alguns dias.`, "ok");
    if (erros.length) toast(`Não enviadas: ${erros.join(" | ")}`, "err");
    consultarStatus();
  };

  const selo = (codigo: string) => {
    if (status === null) return null;
    const s = STATUS[status[codigo]?.status ?? ""] ?? (status[codigo] ? { txt: status[codigo].status, bg: "#f1f5f9", fg: "#475569" } : null);
    if (!s) return <span style={{ fontSize: 9.5, color: "#94a3b8" }}>status indisponível</span>;
    return <span title={status[codigo]?.motivo} style={{ fontSize: 9.5, fontWeight: 800, padding: "1px 7px", borderRadius: 20, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>{s.txt}</span>;
  };

  return (
    <div className="rec-modal-ov" style={{ zIndex: 870 }}>
      <div className="rec-modal" style={{ maxWidth: 860, maxHeight: "92vh", overflowY: "auto" }}>
        <button onClick={onFechar} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Mensagens automáticas (WhatsApp)</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
          Quando o candidato chega na etapa, o sistema manda estas mensagens, na ordem. São as mesmas mensagens da “/” na Caixa de Entrada
          (WhatsApp › Chatbot › Mensagens prontas) — para mudar o texto, edite lá.
        </div>

        <div style={{ fontSize: 12.5, color: "#7c2d12", background: "#fff7ed", border: "1.5px solid #fdba74", borderRadius: 10, padding: "10px 12px", marginBottom: 14, lineHeight: 1.55 }}>
          <b>⚠ A Meta precisa aprovar cada mensagem — e isso pode levar alguns dias.</b><br />
          Enquanto não estiver <b>“aprovada pela Meta”</b>, a mensagem só chega a quem mandou mensagem para a empresa nas <b>últimas 24 horas</b>.
          Para falar com quem nunca escreveu (ex.: o convite da Entrada), ela precisa estar aprovada. Mensagem nova ou com texto alterado
          volta para a fila de aprovação.
        </div>

        {carregando ? <div style={{ padding: 20, color: "#94a3b8", fontSize: 13 }}>Carregando…</div> : (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              {ETAPAS_MSG.map(({ etapa, rotulo, dica }) => {
                const lista = daEtapa(etapa);
                const disponiveis = tpls.filter(t => !lista.some(v => v.codigo === t.codigo));
                return (
                  <div key={etapa} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", background: lista.length ? "#fff" : "#f8fafc" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f3171" }}>{rotulo}</span>
                      {dica && <span style={{ fontSize: 11, color: "#94a3b8" }}>{dica}</span>}
                      {!lista.length && <span style={{ fontSize: 11, color: "#94a3b8" }}>· nenhuma mensagem</span>}
                    </div>
                    {lista.map(v => {
                      const t = porCodigo.get(v.codigo);
                      return (
                        <div key={v.codigo} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, opacity: v.ativo ? 1 : .55 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, fontSize: 12.5, cursor: podeEditar ? "pointer" : "default" }} title={t?.texto}>
                            <input type="checkbox" checked={v.ativo} disabled={!podeEditar} onChange={() => alternar(etapa, v.codigo)} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t?.titulo ?? `${v.codigo} (mensagem desativada na biblioteca)`}</span>
                          </label>
                          {selo(v.codigo)}
                          {podeEditar && <button type="button" onClick={() => remover(etapa, v.codigo)} title="Tirar desta etapa"
                            style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14 }}>✕</button>}
                        </div>
                      );
                    })}
                    {podeEditar && disponiveis.length > 0 && (
                      <select value="" onChange={e => adicionar(etapa, e.target.value)}
                        style={{ marginTop: 7, fontSize: 12, padding: "4px 6px", borderRadius: 7, border: "1px dashed #cbd5e1", background: "#fff", color: "#475569", maxWidth: "100%" }}>
                        <option value="">+ adicionar mensagem nesta etapa…</option>
                        {disponiveis.map(t => <option key={t.codigo} value={t.codigo}>{t.titulo}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>

            {variaveisFixas.length > 0 && (
              <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f3171", marginBottom: 2 }}>Valores fixos</div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>
                  Lacunas que o sistema não sabe preencher sozinho. Sem valor, a mensagem que usa a lacuna <b>não sai</b>.
                  Nome, cargo, cidade, contrato e data de início vêm do candidato e da vaga; o banco é perguntado ao contratar.
                </div>
                {variaveisFixas.map(k => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", minWidth: 150 }}>{k}</span>
                    <input value={valores[k] ?? ""} disabled={!podeEditar} onChange={e => setValores(v => ({ ...v, [k]: e.target.value }))}
                      placeholder={/link/i.test(k) ? "https://docs.google.com/forms/d/e/…/viewform (link de RESPOSTA, não o de edição)" : "valor"}
                      style={{ flex: 1, minWidth: 0, padding: "6px 9px", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit",
                               border: `1px solid ${(valores[k] ?? "").trim() ? "#e2e8f0" : "#fca5a5"}`, background: (valores[k] ?? "").trim() ? "#fff" : "#fff5f5" }} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {podeEditar ? (
            <button type="button" onClick={enviarTodasMeta} disabled={enviandoMeta || carregando}
              title="Manda à Meta, para aprovação, todas as mensagens usadas nas etapas que ainda não foram"
              style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(37,211,102,.35)", background: enviandoMeta ? "#f1f5f9" : "rgba(37,211,102,.1)", color: "#128c7e", fontSize: 12, fontWeight: 700, cursor: enviandoMeta ? "default" : "pointer" }}>
              {enviandoMeta ? "Enviando…" : "↑ Enviar todas para aprovação da Meta"}
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onFechar} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{podeEditar ? "Cancelar" : "Fechar"}</button>
            {podeEditar && (
              <button onClick={salvar} disabled={salvando || carregando}
                style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: salvando ? "#94a3b8" : "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: salvando ? "default" : "pointer" }}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
