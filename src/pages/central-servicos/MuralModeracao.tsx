import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useDecidirMural, useDefinirVisibilidadeMural, useHabilitarTriagem, useMuralModeracao, useTriagemMural,
  useVisibilidadeMural, type ItemModeracao, type VisibilidadeMural,
} from "@/hooks/useMuralReconhecimento";
import {
  itensDaPrevia, mesAnterior, rankingMural, rotuloMes, somarMes,
  type StatusMural,
} from "@/lib/formularios/muralReconhecimento";
import { bloqueadoPelaIA, separarPelaTriagem, semTriagem, sinalizadoPelaIA } from "@/lib/formularios/muralTriagem";
import { CartaoReconhecimento, type ItemCartao } from "@/components/reconhecimento/ReconhecimentoCard";

// =====================================================================
// NASCIMENTO FORMULÁRIOS - Mural do Início (moderação)
//
// Pedido do Pablo (30/10/2026): os comentários POSITIVOS da pergunta
// "colegas" vão para o cartão "Reconhecimento e Convivência Profissional"
// do Início, sempre do mês anterior — mas só depois que quem tem acesso às
// permissões do formulário LIBERAR. Esta janela é essa liberação.
//
// A fila já chega filtrada pelo banco (cs_form_mural_moderacao): só nota
// alta + comentário com texto. Nada aqui mostra quem respondeu — o
// formulário é anônimo e a moderação também.
//
// Abre no MÊS ANTERIOR, que é o que está no Início agora; as setas
// adiantam o mês corrente para deixar a lista pronta antes da virada.
//
// 03/11/2026 (Pablo, com print de 345 cartões soltos): virou RANKING por
// pessoa — cada colega uma vez, do 1º ao último pela quantidade de
// comentários positivos (nota média desempata); clicar no nome abre os
// comentários dele. E a liberação só abre no dia 20 do mês seguinte ao do
// voto (outubro → 20/11): antes disso os botões ficam travados com o aviso
// de quantos dias faltam, e o banco recusa do mesmo jeito (trigger
// cs_form_mural_trava_liberacao, mig 20261103001300). Toda liberação pede
// confirmação dizendo quantos comentários e de qual mês.
//
// 12/11/2026 (Pablo): SAIU a trava do dia 20 — dá para publicar quando
// quiser, na tela e no banco (mig 20261112210000 derruba o trigger). O freio
// agora é a DUPLA confirmação: "Tem certeza?" e, depois do sim, "Confirma sua
// certeza?". Só o segundo sim libera. Vale para o "Liberar" de um recado, o
// "Liberar os N" da pessoa e o "Liberar todos os pendentes". E o Início
// passou a mostrar todo mês publicado (setas no cartão), não só o anterior —
// por isso o selo "no Início" agora depende de o mês ter algo liberado.
//
// 06/11/2026 (Pablo: "tem que ter uma prévia pra ver como fica antes de ser
// publicado"): botão "Ver prévia" — no rodapé (o mês inteiro, já liberados +
// pendentes), em cada pessoa (só os dela) e na confirmação de liberar. A
// prévia é o MESMO cartão do Início (CartaoReconhecimento), só sem a foto do
// cadastro, que a moderação não carrega. Não grava nada.
//
// 12/11/2026 (Pablo: "preciso que a i.a sugira quais elogios não vão pro
// mural do inicio tipo: tem um comentário que fala que é mais competente que
// o lider, que deveria ser o lider do setor... mostra me um card já
// desabilitado esses comentários, se o usuario quiser habilitar aí habilita e
// manda"): TRIAGEM POR IA ao abrir o mês (Edge mural-triagem-ia, gravada em
// CS_FORM_MURAL_TRIAGEM_IA — abrir de novo não relê). O não recomendado fica
// no card "Não recomendados pela IA", desabilitado: fora do "Liberar os N" e
// do "Liberar todos", que passam a contar só os habilitados. "Habilitar" põe
// de volta no envio normal (com as duas confirmações). Enquanto a IA lê, os
// botões de liberar esperam; se ela falhar, um aviso diz que a triagem não
// rodou e tudo segue como antes (regra em lib/formularios/muralTriagem).
//
// 12/11/2026 (Pablo: "coloca opção pra tirar do painel inicial, e ali todos
// podem ver, não precisa ter permissões"): "⤺ Tirar do Início" no recado, na
// pessoa e no mês inteiro (rodapé), com uma confirmação. Tirar = voltar a
// PENDENTE (mesmo cs_form_mural_decidir/_lote do "Desfazer", sem migration):
// some do cartão e pode ser liberado de novo. Ver o cartão já não exige
// permissão nenhuma — cs_form_mural_inicio só pede estar logado e o Início
// só esconde do encarregado externo (login anônimo); permissão
// (cs_form_pode 'acesso') é só para liberar/tirar, aqui.
// =====================================================================

const MESES_CAP = (ym: string) => rotuloMes(ym).replace(/^./, (c) => c.toUpperCase());

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const btnSeta: React.CSSProperties = { width: 32, height: 32, borderRadius: 9, border: "1px solid #e2e8f0", background: "#fff", color: "#0f3171", fontSize: 17, fontWeight: 800, lineHeight: 1, cursor: "pointer" };
const btnApagado: React.CSSProperties = { ...btn("#e2e8f0", "#94a3b8"), cursor: "not-allowed" };
const avisoIA = (bg: string, c: string, borda: string): React.CSSProperties =>
  ({ flexShrink: 0, padding: "8px 12px", borderRadius: 10, background: bg, color: c, border: `1px solid ${borda}`, fontSize: 12, lineHeight: 1.45 });

const COR_STATUS: Record<StatusMural, { bg: string; c: string; rot: string }> = {
  pendente: { bg: "#fef3c7", c: "#b45309", rot: "Pendente" },
  liberado: { bg: "#dcfce7", c: "#15803d", rot: "No mural" },
  recusado: { bg: "#f1f5f9", c: "#64748b", rot: "Recusado" },
};

const MEDALHA: Record<number, { bg: string; c: string }> = {
  1: { bg: "#fde68a", c: "#92400e" },
  2: { bg: "#e2e8f0", c: "#334155" },
  3: { bg: "#fed7aa", c: "#9a3412" },
};

type Filtro = "todos" | StatusMural;

const chaveItem = (i: ItemModeracao) => `${i.resposta_id}:${i.pergunta_id}:${i.linha}`;
const paraCartao = (i: ItemModeracao): ItemCartao => ({
  chave: chaveItem(i), colaborador: i.colaborador, setor: i.setor, cargo: null, avatar_url: null,
  nota: i.nota, escala: i.escala, comentario: i.comentario,
});
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Caixinha do checklist (12/11/2026, Pablo: "deixa selecionar quais eu quero
 * liberar, como se fosse checklist"). `parcial` = alguns da pessoa marcados.
 */
function Caixa({ marcado, parcial = false, onChange, rotulo }: {
  marcado: boolean; parcial?: boolean; onChange: () => void; rotulo: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = parcial && !marcado; }, [parcial, marcado]);
  return (
    <input ref={ref} type="checkbox" checked={marcado} onChange={onChange} aria-label={rotulo} title={rotulo}
      onClick={(e) => e.stopPropagation()}
      style={{ width: 17, height: 17, accentColor: "#16a34a", cursor: "pointer", flexShrink: 0 }} />
  );
}

/** "Todos veem" × "Cada um vê só os seus" (13/11/2026). */
function SeletorModo({ modo, onTrocar, desabilitado, compacto = false }: {
  modo: VisibilidadeMural; onTrocar: (m: VisibilidadeMural) => void; desabilitado?: boolean; compacto?: boolean;
}) {
  const opcoes: { v: VisibilidadeMural; rot: string; dica: string }[] = [
    { v: "todos", rot: "👥 Todos veem os comentários bons", dica: "Todo mundo logado vê os recados liberados do mês." },
    { v: "proprios", rot: "🔒 Cada um vê só os seus", dica: "Cada pessoa vê no Início só os recados feitos para ela." },
  ];
  return (
    <div role="radiogroup" aria-label="Quem vê no Início"
      style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, padding: 3, borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
      {opcoes.map((o) => {
        const on = modo === o.v;
        return (
          <button key={o.v} type="button" role="radio" aria-checked={on} disabled={desabilitado} title={o.dica}
            onClick={() => onTrocar(o.v)}
            style={{ border: 0, borderRadius: 8, cursor: desabilitado ? "default" : "pointer", fontWeight: 800,
              fontSize: compacto ? 11 : 12, padding: compacto ? "5px 9px" : "7px 11px",
              background: on ? (o.v === "proprios" ? "#7c3aed" : "#0f3171") : "transparent",
              color: on ? "#fff" : "#475569", transition: "background .2s" }}>
            {o.rot}
          </button>
        );
      })}
    </div>
  );
}

export default function MuralModeracao({ formId, onFechar }: { formId: string; onFechar: () => void }) {
  const noInicio = mesAnterior();
  const [mes, setMes] = useState(noInicio);
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  // etapa 1 = "Tem certeza?", etapa 2 = "Confirma sua certeza?" — só a 2 libera.
  // modo: quem vê no Início — escolhido aqui na confirmação (13/11/2026).
  const [confirmar, setConfirmar] = useState<{ lista: ItemModeracao[]; quem?: string; etapa: 1 | 2; desde?: number; foraIA?: number; modo: VisibilidadeMural } | null>(null);
  // Prévia: o que vai ser liberado (somado ao que já está no mural).
  const [previa, setPrevia] = useState<{ aLiberar: ItemModeracao[]; quem?: string } | null>(null);
  const [cardIAAberto, setCardIAAberto] = useState(true);
  // "Tirar do Início": o que já está publicado volta a pendente (uma confirmação).
  // mesInteiro = o botão "Remover completamente mês do mural" (12/11/2026).
  const [tirar, setTirar] = useState<{ lista: ItemModeracao[]; quem?: string; mesInteiro?: boolean } | null>(null);
  // Checklist: chaves dos pendentes marcados para liberar/recusar juntos.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  useEffect(() => { setMarcados(new Set()); }, [mes]);
  const { data: itens = [], isLoading, error } = useMuralModeracao(formId, mes, true);
  const decidir = useDecidirMural();
  // Quem vê no Início, por formulário + mês (13/11/2026, Pablo: "CADA UM VER
  // SÓ OS SEUS COMENTÁRIOS ou TODOS VEREM OS COMENTÁRIOS BONS").
  const visQ = useVisibilidadeMural(formId, mes);
  const modoAtual: VisibilidadeMural = visQ.data?.modo ?? "todos";
  const modoDisponivel = visQ.data?.disponivel ?? false;
  const definirModo = useDefinirVisibilidadeMural(formId, mes);
  const trocarModo = (modo: VisibilidadeMural) => {
    if (modo === modoAtual) return;
    definirModo.mutate(modo, {
      onSuccess: () => toast.success(modo === "proprios"
        ? `${MESES_CAP(mes)}: cada um vê só os comentários feitos para si.`
        : `${MESES_CAP(mes)}: todos veem os comentários bons.`),
      onError: (e: Error) => toast.error(e?.message ?? "Não foi possível salvar."),
    });
  };
  // Triagem por IA: só depois que a fila carregou e se há pendente.
  const temPendente = itens.some((i) => i.status === "pendente");
  const triagemQ = useTriagemMural(formId, mes, !isLoading && temPendente);
  const habilitar = useHabilitarTriagem(formId, mes);
  const mapaTriagem = useMemo(() => triagemQ.data?.porChave ?? new Map(), [triagemQ.data]);
  // Enquanto a IA lê pela primeira vez, liberar espera (senão o "Liberar
  // todos" passaria o que ela ia segurar). Erro destrava.
  const triando = temPendente && triagemQ.isFetching && !triagemQ.data;
  const triagemDe = (i: ItemModeracao) => mapaTriagem.get(chaveItem(i));

  const contagem = useMemo(() => {
    const c: Record<StatusMural, number> = { pendente: 0, liberado: 0, recusado: 0 };
    itens.forEach((i) => { c[i.status] += 1; });
    return c;
  }, [itens]);
  // A posição vem de TODOS os comentários positivos do mês: o filtro muda o
  // que aparece, não quem é o 1º.
  const ranking = useMemo(() => rankingMural(itens), [itens]);
  const termo = busca.trim().toUpperCase();
  const visiveis = ranking
    .map((p) => ({ ...p, filtrados: filtro === "todos" ? p.itens : p.itens.filter((i) => i.status === filtro) }))
    .filter((p) => p.filtrados.length && (!termo || p.colaborador.toUpperCase().includes(termo)));
  const pendentes = itens.filter((i) => i.status === "pendente");
  const { liberaveis: pendentesLiberaveis, bloqueados: bloqueadosIA } = separarPelaTriagem(pendentes, mapaTriagem, chaveItem);
  const naoLidos = triagemQ.data ? semTriagem(pendentes, mapaTriagem, chaveItem).length : 0;
  // Reabilitados à mão continuam no card (com "Desabilitar"), para dar para voltar atrás.
  const sinalizadosIA = pendentes.filter((i) => sinalizadoPelaIA(i, triagemDe(i)));
  // Só entra na seleção o que pode ser liberado: pendente e não segurado pela
  // IA. O que mudou de status (ou a IA desabilitou) sai sozinho da contagem.
  const selecionados = pendentesLiberaveis.filter((i) => marcados.has(chaveItem(i)));
  const alternarMarcado = (lista: ItemModeracao[]) => setMarcados((s) => {
    const n = new Set(s);
    const todos = lista.every((i) => n.has(chaveItem(i)));
    lista.forEach((i) => { if (todos) n.delete(chaveItem(i)); else n.add(chaveItem(i)); });
    return n;
  });

  const aplicar = (lista: ItemModeracao[], status: StatusMural) => {
    if (!lista.length) return;
    decidir.mutate({ itens: lista, status }, {
      onSuccess: () => {
        setMarcados((s) => { const n = new Set(s); lista.forEach((i) => n.delete(chaveItem(i))); return n; });
        if (lista.length > 1) toast.success(`${lista.length} comentário(s) ${status === "liberado" ? "liberados para o mural" : "atualizados"}.`);
      },
      onError: (e: Error) => toast.error(e?.message ?? "Não foi possível salvar."),
    });
  };
  const pedirLiberacao = (lista: ItemModeracao[], quem?: string, foraIA = 0) => {
    if (!lista.length) return;
    setConfirmar({ lista, quem, etapa: 1, foraIA, modo: modoAtual });
  };
  const mudarHabilitado = (i: ItemModeracao, habilitado: boolean) =>
    habilitar.mutate({ item: i, habilitado }, {
      onSuccess: () => toast.success(habilitado ? "Habilitado: entra no próximo Liberar." : "Desabilitado: fica fora do Liberar."),
      onError: (e: Error) => toast.error(e?.message ?? "Não foi possível salvar."),
    });
  const alternar = (nome: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(nome)) n.delete(nome); else n.add(nome);
    return n;
  });

  const ocupado = decidir.isPending || definirModo.isPending;
  const travaLiberar = ocupado || triando;

  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "min(820px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#f8fafc", borderRadius: 18, boxShadow: "0 30px 70px rgba(15,23,42,.35)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: "linear-gradient(120deg,#0f3171,#1d4a92 60%,#f97316)", color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>🏆 Mural do Início — Reconhecimento</div>
              <div style={{ fontSize: 12, opacity: .85, marginTop: 3, lineHeight: 1.45 }}>
                Só comentários <b>positivos</b> (nota alta e com texto). O que você liberar aparece no cartão
                "Reconhecimento e Convivência Profissional" do Início, <b>sem o nome de quem votou</b>.
              </div>
              <ul style={{ fontSize: 11.5, opacity: .9, margin: "6px 0 0", paddingLeft: 16, lineHeight: 1.5 }}>
                <li><b>Ranking:</b> do 1º ao último pela quantidade de comentários positivos no mês; empate vai para a nota média.</li>
                <li><b>Liberação:</b> quando quiser — pede <b>duas confirmações</b> antes de publicar. No Início, cada mês publicado vira uma página do cartão — e, por mês, você escolhe quem vê: <b>👥 todos veem os comentários bons</b> ou <b>🔒 cada um vê só os seus</b> (ao lado do mês e na confirmação de publicar). <b>🗑 Tirar mês do Início</b> (ao lado do mês) tira o mês inteiro do Início na hora; <b>⤺ Tirar do Início</b> (em cada pessoa) tira só os dela. O que sai volta para pendente. Para liberar só alguns, <b>marque as caixinhas</b> e use <b>Liberar selecionados</b>.</li>
                <li><b>Triagem por IA:</b> comentários que não cabem num mural público (comparação com o líder, crítica a terceiros, assunto pessoal…) já vêm <b>desabilitados</b>; habilite se quiser enviar.</li>
              </ul>
            </div>
            <button onClick={onFechar} aria-label="Fechar" style={{ ...btn("rgba(255,255,255,.16)"), fontSize: 15, padding: "4px 10px" }}>✕</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderBottom: "1px solid #e2e8f0", background: "#fff", flexWrap: "wrap" }}>
          <button style={btnSeta} onClick={() => setMes((m) => somarMes(m, -1))} aria-label="Mês anterior">‹</button>
          <div style={{ minWidth: 150, textAlign: "center" }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>Votos de {MESES_CAP(mes)}</div>
            <div style={{ fontSize: 10.5, color: contagem.liberado ? "#15803d" : "#94a3b8", fontWeight: 700 }}>
              {contagem.liberado ? "● no Início agora" : "nada publicado ainda"}
            </div>
          </div>
          <button style={btnSeta} onClick={() => setMes((m) => somarMes(m, 1))} aria-label="Próximo mês">›</button>
          {/* 12/11/2026 (Pablo: "desenvolve o botão REMOVER COMPLETAMENTE MÊS DO
              MURAL — se eu fizer isso em setembro vai remover instantaneamente
              do Início"): tira do cartão TUDO o que está publicado do mês
              escolhido nas setas ao lado. Antes isso era o "Tirar do Início" do
              rodapé, fácil de não ver. Os comentários voltam para Pendente
              (dá para publicar de novo, com as duas confirmações). */}
          {/* 14/11/2026 (Pablo: "não tem botão de tirar do início"): o botão
              sumia justamente quando o mês não tinha nada publicado, e parecia
              que não existia. Agora fica sempre à vista, com a contagem;
              desabilitado só quando não há o que tirar daquele mês. */}
          <button disabled={ocupado || contagem.liberado === 0}
            onClick={() => setTirar({ lista: itens.filter((i) => i.status === "liberado"), mesInteiro: true })}
            title={contagem.liberado > 0
              ? `Tirar do cartão do Início todos os ${contagem.liberado} comentários publicados de ${MESES_CAP(mes)}`
              : `${MESES_CAP(mes)} não tem nada publicado no Início — nada para tirar`}
            style={{ ...btn("#fff", "#b91c1c", "1px solid #fecaca"), textTransform: "uppercase", fontSize: 11.5,
                     ...(contagem.liberado === 0 ? { opacity: 0.45, cursor: "not-allowed" } : {}) }}>
            🗑 Tirar mês do Início ({contagem.liberado})
          </button>
          {modoDisponivel && (
            <SeletorModo modo={modoAtual} desabilitado={ocupado} onTrocar={trocarModo} compacto />
          )}
          <div style={{ flex: 1 }} />
          {(["pendente", "liberado", "recusado", "todos"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              style={{ ...btn(filtro === f ? "#0f3171" : "#fff", filtro === f ? "#fff" : "#475569", "1px solid #e2e8f0"), padding: "5px 10px", fontSize: 11.5 }}>
              {f === "todos" ? `Todos (${itens.length})` : `${COR_STATUS[f].rot} (${contagem[f]})`}
            </button>
          ))}
        </div>

        <div style={{ padding: "10px 20px 0" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa no ranking…"
            style={{ width: "100%", padding: "7px 11px", borderRadius: 9, border: "1px solid #e2e8f0", fontSize: 12.5, background: "#fff" }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {!isLoading && !error && temPendente && (
            triando ? (
              <div style={avisoIA("#eff6ff", "#1d4ed8", "#bfdbfe")}>
                🤖 A IA está lendo os {pendentes.length} comentários pendentes para separar o que não cabe no mural… os botões de liberar voltam em instantes.
              </div>
            ) : triagemQ.error ? (
              <div style={avisoIA("#fff7ed", "#c2410c", "#fed7aa")}>
                ⚠ <b>A triagem por IA não rodou</b> ({(triagemQ.error as Error)?.message ?? "sem resposta"}). O mural segue como antes: revise os comentários antes de liberar.
                <button onClick={() => triagemQ.refetch()} style={{ ...btn("#fff", "#c2410c", "1px solid #fed7aa"), marginLeft: 8, padding: "3px 9px", fontSize: 11 }}>Tentar de novo</button>
              </div>
            ) : naoLidos > 0 ? (
              <div style={avisoIA("#fff7ed", "#c2410c", "#fed7aa")}>
                ⚠ A IA não leu {plural(naoLidos, "comentário", "comentários")} agora{triagemQ.data?.aviso ? ` (${triagemQ.data.aviso})` : ""} — esses seguem liberáveis como antes.
                <button onClick={() => triagemQ.refetch()} style={{ ...btn("#fff", "#c2410c", "1px solid #fed7aa"), marginLeft: 8, padding: "3px 9px", fontSize: 11 }}>Ler o resto</button>
              </div>
            ) : null
          )}

          {!isLoading && !error && sinalizadosIA.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
              <button onClick={() => setCardIAAberto((v) => !v)} aria-expanded={cardIAAberto}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", background: "#fef2f2", border: "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#991b1b", flex: 1 }}>
                  🤖 Não recomendados pela IA — {plural(bloqueadosIA.length, "desabilitado", "desabilitados")}
                  {sinalizadosIA.length > bloqueadosIA.length ? ` · ${sinalizadosIA.length - bloqueadosIA.length} habilitado(s) por você` : ""}
                </span>
                <span style={{ fontSize: 11, color: "#b91c1c", fontWeight: 700 }}>{cardIAAberto ? "▾ fechar" : "▸ ver"}</span>
              </button>
              {cardIAAberto && (
                <div style={{ padding: "8px 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.45 }}>
                    Ficam <b>fora</b> do "Liberar" e do "Liberar todos". É só uma sugestão: se achar que pode ir, clique em <b>Habilitar</b> e ele entra no próximo envio.
                  </div>
                  {sinalizadosIA.map((i) => {
                    const t = triagemDe(i);
                    const bloq = bloqueadoPelaIA(i, t);
                    return (
                      <div key={chaveItem(i)} style={{ border: "1px solid #eef2f7", borderLeft: `3px solid ${bloq ? "#ef4444" : "#16a34a"}`, borderRadius: 8, padding: "6px 10px", background: bloq ? "#fafafa" : "#fff" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11.5, fontWeight: 800, color: "#0f172a", textTransform: "uppercase" }}>{i.colaborador}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: bloq ? "#fee2e2" : "#dcfce7", color: bloq ? "#b91c1c" : "#15803d" }}>
                            {bloq ? "Desabilitado" : "Habilitado por você"}
                          </span>
                          <div style={{ flex: 1 }} />
                          <button disabled={habilitar.isPending} onClick={() => mudarHabilitado(i, bloq)}
                            style={bloq ? btn("#fff", "#15803d", "1px solid #bbf7d0") : btn("#fff", "#b91c1c", "1px solid #fecaca")}>
                            {bloq ? "Habilitar" : "Desabilitar"}
                          </button>
                        </div>
                        {t?.motivo && <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>Motivo: {t.motivo}</div>}
                        <div style={{ marginTop: 4, fontSize: 12.5, color: bloq ? "#94a3b8" : "#334155", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>“{i.comentario}”</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
          ) : error ? (
            <div style={{ padding: 30, textAlign: "center", color: "#b91c1c", fontSize: 13 }}>{(error as Error)?.message ?? "Não foi possível carregar."}</div>
          ) : !visiveis.length ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              {itens.length ? "Nada neste filtro." : `Nenhum comentário positivo nos votos de ${rotuloMes(mes)}.`}
              {/* Abre no mês que está no Início; quem chega antes da virada
                  quer preparar o mês corrente — um clique em vez de achar a seta. */}
              {!itens.length && mes === noInicio && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => setMes(somarMes(noInicio, 1))} style={btn("#0f3171")}>
                    Ver os votos de {rotuloMes(somarMes(noInicio, 1))} →
                  </button>
                </div>
              )}
            </div>
          ) : visiveis.map((p) => {
            const aberto = abertos.has(p.colaborador);
            const pendTodos = p.itens.filter((i) => i.status === "pendente");
            // "Liberar os N" conta só o que a IA não segurou (ou que foi habilitado).
            const { liberaveis: pend, bloqueados: pendForaIA } = separarPelaTriagem(pendTodos, mapaTriagem, chaveItem);
            const med = MEDALHA[p.posicao];
            const nMarcados = pend.filter((i) => marcados.has(chaveItem(i))).length;
            return (
              // flexShrink 0: com overflow hidden o cartão perde o min-height
              // automático e a coluna espremia as 55 pessoas em tracinhos (03/11/2026).
              <div key={p.colaborador} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 4px 14px rgba(15,23,42,.05)", overflow: "hidden", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
                  {pend.length > 0 && (
                    <Caixa marcado={nMarcados === pend.length} parcial={nMarcados > 0}
                      onChange={() => alternarMarcado(pend)}
                      rotulo={`Selecionar os ${pend.length} pendente(s) de ${p.colaborador}`} />
                  )}
                  <span title={`${p.posicao}º lugar`}
                    style={{ minWidth: 38, textAlign: "center", fontSize: 13, fontWeight: 900, padding: "4px 6px", borderRadius: 9, background: med?.bg ?? "#f1f5f9", color: med?.c ?? "#475569" }}>
                    {p.posicao}º
                  </span>
                  <button onClick={() => alternar(p.colaborador)} aria-expanded={aberto}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 200, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a", textTransform: "uppercase" }}>{p.colaborador}</span>
                    {p.setor && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>{p.setor}</span>}
                    {p.media != null && <span style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b" }}>★ {p.media.toFixed(1).replace(".", ",")}</span>}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>{plural(p.total, "comentário", "comentários")}</span>
                    {pendTodos.length > 0 && pendTodos.length < p.total && (
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: COR_STATUS.pendente.bg, color: COR_STATUS.pendente.c }}>{pendTodos.length} pendente(s)</span>
                    )}
                    {pendForaIA.length > 0 && (
                      <span title="A IA não recomendou para o mural — abra para ver o motivo e habilitar"
                        style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#fee2e2", color: "#b91c1c" }}>
                        🤖 {pendForaIA.length} desabilitado(s)
                      </span>
                    )}
                    {nMarcados > 0 && (
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#dcfce7", color: "#15803d" }}>☑ {nMarcados} selecionado(s)</span>
                    )}
                    <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>{aberto ? "▾ fechar" : "▸ ver comentários"}</span>
                  </button>
                  {p.itens.some((i) => i.status !== "recusado") && (
                    <button onClick={() => setPrevia({ aLiberar: pend, quem: p.colaborador })}
                      title="Ver como os recados desta pessoa aparecem no Início"
                      style={btn("#fff", "#0f3171", "1px solid #c7d2fe")}>👁 Prévia</button>
                  )}
                  {p.itens.some((i) => i.status === "liberado") && (
                    <button disabled={ocupado}
                      onClick={() => setTirar({ lista: p.itens.filter((i) => i.status === "liberado"), quem: p.colaborador })}
                      title="Tirar do cartão do Início os recados desta pessoa que já estão publicados"
                      style={btn("#fff", "#b45309", "1px solid #fde68a")}>
                      ⤺ Tirar do Início
                    </button>
                  )}
                  {pend.length > 0 && (
                    <button disabled={travaLiberar}
                      onClick={() => pedirLiberacao(pend, p.colaborador, pendForaIA.length)}
                      title={triando ? "Aguarde a triagem da IA" : undefined}
                      style={triando ? btnApagado : btn("#16a34a")}>
                      ✓ Liberar {pend.length > 1 ? `os ${pend.length}` : ""}
                    </button>
                  )}
                </div>

                {aberto && (
                  <div style={{ borderTop: "1px solid #f1f5f9", padding: "8px 14px 12px", display: "flex", flexDirection: "column", gap: 8, background: "#fbfdff" }}>
                    {p.filtrados.map((i) => {
                      const st = COR_STATUS[i.status];
                      const t = triagemDe(i);
                      const bloq = bloqueadoPelaIA(i, t);
                      const sinal = sinalizadoPelaIA(i, t);
                      return (
                        <div key={chaveItem(i)} style={{ borderLeft: `3px solid ${bloq ? "#ef4444" : st.c}`, padding: "6px 10px", background: bloq ? "#fafafa" : "#fff", borderRadius: 8, border: "1px solid #eef2f7" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {i.status === "pendente" && !bloq && (
                              <Caixa marcado={marcados.has(chaveItem(i))} onChange={() => alternarMarcado([i])}
                                rotulo="Selecionar este comentário" />
                            )}
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b" }}>★ {i.nota}/{i.escala}</span>
                            <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.c }}>{st.rot}</span>
                            {sinal && (
                              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: bloq ? "#fee2e2" : "#dcfce7", color: bloq ? "#b91c1c" : "#15803d" }}>
                                {bloq ? "🤖 Desabilitado pela IA" : "🤖 Habilitado por você"}
                              </span>
                            )}
                            <div style={{ flex: 1 }} />
                            {sinal && (
                              <button disabled={habilitar.isPending} onClick={() => mudarHabilitado(i, bloq)}
                                style={bloq ? btn("#fff", "#15803d", "1px solid #bbf7d0") : btn("#fff", "#b91c1c", "1px solid #fecaca")}>
                                {bloq ? "Habilitar" : "Desabilitar"}
                              </button>
                            )}
                            {i.status !== "liberado" && !bloq && (
                              <button disabled={travaLiberar}
                                onClick={() => pedirLiberacao([i], p.colaborador)} style={triando ? btnApagado : btn("#16a34a")}>
                                ✓ Liberar
                              </button>
                            )}
                            {i.status !== "recusado" && (
                              <button disabled={ocupado} onClick={() => aplicar([i], "recusado")} style={btn("#fff", "#b91c1c", "1px solid #fecaca")}>Recusar</button>
                            )}
                            {i.status === "liberado" && (
                              <button disabled={ocupado} onClick={() => setTirar({ lista: [i], quem: p.colaborador })}
                                style={btn("#fff", "#b45309", "1px solid #fde68a")}>⤺ Tirar do Início</button>
                            )}
                            {i.status === "recusado" && (
                              <button disabled={ocupado} onClick={() => aplicar([i], "pendente")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Desfazer</button>
                            )}
                          </div>
                          {sinal && t?.motivo && <div style={{ marginTop: 5, fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>Motivo da IA: {t.motivo}</div>}
                          <div style={{ marginTop: 6, fontSize: 13, color: bloq ? "#94a3b8" : "#334155", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>“{i.comentario}”</div>
                          {i.decidido_por && i.status !== "pendente" && (
                            <div style={{ marginTop: 5, fontSize: 10.5, color: "#94a3b8" }}>
                              {i.status === "liberado" ? "Liberado" : "Recusado"} por {i.decidido_por}
                              {i.decidido_em ? ` em ${new Date(i.decidido_em).toLocaleDateString("pt-BR")}` : ""}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid #e2e8f0", background: "#fff", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: "#64748b", flex: 1 }}>
            {plural(ranking.length, "pessoa", "pessoas")} · {contagem.liberado} no mural · {contagem.pendente} pendente(s)
            {bloqueadosIA.length > 0 && <> ({bloqueadosIA.length} desabilitado(s) pela IA)</>} · {contagem.recusado} recusado(s)
          </span>
          <button disabled={!pendentesLiberaveis.length && !contagem.liberado} onClick={() => setPrevia({ aLiberar: pendentesLiberaveis })}
            title="Ver como o cartão do Início fica com o que já está no mural e os pendentes habilitados"
            style={pendentesLiberaveis.length || contagem.liberado ? btn("#fff", "#0f3171", "1px solid #c7d2fe") : btnApagado}>
            👁 Ver prévia
          </button>
          {selecionados.length > 0 ? (
            <>
              <button onClick={() => setMarcados(new Set())} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Limpar seleção</button>
              <button disabled={ocupado} onClick={() => aplicar(selecionados, "recusado")}
                style={btn("#fff", "#b91c1c", "1px solid #fecaca")}>Recusar selecionados ({selecionados.length})</button>
              {/* Mesmas duas confirmações do "Liberar". */}
              <button disabled={travaLiberar} onClick={() => pedirLiberacao(selecionados)}
                title={triando ? "Aguarde a triagem da IA" : undefined}
                style={triando ? btnApagado : btn("#16a34a")}>
                ✓ Liberar selecionados ({selecionados.length})
              </button>
            </>
          ) : (
          <button disabled={!pendentesLiberaveis.length || travaLiberar}
            onClick={() => pedirLiberacao(pendentesLiberaveis, undefined, bloqueadosIA.length)}
            title={triando ? "Aguarde a triagem da IA" : undefined}
            style={pendentesLiberaveis.length && !triando ? btn("#16a34a") : btnApagado}>
            ✓ Liberar todos os pendentes{bloqueadosIA.length > 0 ? ` (${pendentesLiberaveis.length})` : ""}
          </button>
          )}
        </div>

        {confirmar && (
          <div onClick={() => setConfirmar(null)} style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
              style={{ width: "min(420px, 100%)", background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 20px 50px rgba(15,23,42,.35)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", letterSpacing: ".04em" }}>CONFIRMAÇÃO {confirmar.etapa} DE 2</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#b91c1c", marginTop: 2 }}>
                {confirmar.etapa === 1 ? "TEM CERTEZA?" : "CONFIRMA SUA CERTEZA?"}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                Vão para o mural do Início <b>{plural(confirmar.lista.length, "comentário", "comentários")}</b> dos
                votos de <b>{MESES_CAP(mes)}</b>
                {confirmar.quem ? <> para <b>{confirmar.quem}</b></> : <> de <b>{plural(new Set(confirmar.lista.map((i) => i.colaborador.trim().toUpperCase())).size, "pessoa", "pessoas")}</b></>}.
                {confirmar.modo === "proprios"
                  ? <> <b>Cada pessoa vai ver só os comentários feitos para ela</b>, sem o nome de quem votou.</>
                  : <> Todos que entram no ERP vão ler, sem o nome de quem votou.</>}
                {!!confirmar.foraIA && <> <b>{plural(confirmar.foraIA, "comentário desabilitado", "comentários desabilitados")} pela IA {confirmar.foraIA === 1 ? "fica" : "ficam"} de fora.</b></>}
                {confirmar.etapa === 2 && <> <b>Depois deste sim, já está publicado.</b></>}
              </div>
              {modoDisponivel && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 6 }}>QUEM VÊ NO INÍCIO ({MESES_CAP(mes).toUpperCase()})</div>
                  <SeletorModo modo={confirmar.modo} desabilitado={ocupado}
                    onTrocar={(m) => setConfirmar({ ...confirmar, modo: m, etapa: 1 })} />
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <button onClick={() => setPrevia({ aLiberar: confirmar.lista, quem: confirmar.quem })}
                  style={{ ...btn("#fff", "#0f3171", "1px solid #c7d2fe"), marginRight: "auto" }}>👁 Ver prévia</button>
                <button onClick={() => setConfirmar(null)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
                {confirmar.etapa === 1 ? (
                  <button key="etapa1" autoFocus disabled={ocupado}
                    onClick={() => setConfirmar({ ...confirmar, etapa: 2, desde: Date.now() })}
                    style={btn("#16a34a")}>Sim, tenho certeza</button>
                ) : (
                  // O botão da etapa 2 nasce no MESMO lugar do da etapa 1: um
                  // duplo clique passaria pelas duas confirmações de uma vez.
                  // Clique nos primeiros 700 ms da etapa 2 não vale.
                  <button key="etapa2" autoFocus disabled={ocupado}
                    onClick={() => {
                      if (Date.now() - (confirmar.desde ?? 0) < 700) return;
                      const { lista, modo } = confirmar;
                      setConfirmar(null);
                      // Grava o modo ANTES de liberar: o recado nunca fica
                      // um instante visível para todos quando era "só os seus".
                      if (modoDisponivel && modo !== modoAtual) {
                        definirModo.mutate(modo, {
                          onSuccess: () => aplicar(lista, "liberado"),
                          onError: (e: Error) => toast.error(e?.message ?? "Não foi possível salvar quem vê. Nada foi publicado."),
                        });
                      } else aplicar(lista, "liberado");
                    }}
                    style={btn("#b91c1c")}>✓ Confirmo, liberar {confirmar.lista.length}</button>
                )}
              </div>
            </div>
          </div>
        )}

        {tirar && (
          <div onClick={() => setTirar(null)} style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
              style={{ width: "min(420px, 100%)", background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 20px 50px rgba(15,23,42,.35)" }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: tirar.mesInteiro ? "#b91c1c" : "#b45309" }}>
                {tirar.mesInteiro ? `REMOVER ${MESES_CAP(mes).toUpperCase()} DO MURAL?` : "TIRAR DO INÍCIO?"}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                {tirar.mesInteiro && <><b>{MESES_CAP(mes)} sai inteiro do Início na hora</b> — o cartão deixa de ter esse mês. </>}
                Saem do cartão "Reconhecimento e Convivência Profissional" <b>{plural(tirar.lista.length, "comentário", "comentários")}</b> dos
                votos de <b>{MESES_CAP(mes)}</b>{tirar.quem ? <> de <b>{tirar.quem}</b></> : null}.
                {" "}Eles voltam para <b>Pendente</b> aqui e podem ser liberados de novo depois.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button onClick={() => setTirar(null)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
                <button autoFocus disabled={ocupado}
                  onClick={() => {
                    const n = tirar.lista.length;
                    const mesInteiro = tirar.mesInteiro;
                    decidir.mutate({ itens: tirar.lista, status: "pendente" }, {
                      onSuccess: () => toast.success(mesInteiro
                        ? `${MESES_CAP(mes)} removido do mural do Início (${plural(n, "comentário", "comentários")}).`
                        : `${plural(n, "comentário tirado", "comentários tirados")} do Início.`),
                      onError: (e: Error) => toast.error(e?.message ?? "Não foi possível tirar do Início."),
                    });
                    setTirar(null);
                  }}
                  style={btn(tirar.mesInteiro ? "#b91c1c" : "#b45309")}>
                  {tirar.mesInteiro ? `🗑 Remover ${MESES_CAP(mes)} do mural` : `⤺ Tirar ${tirar.lista.length} do Início`}
                </button>
              </div>
            </div>
          </div>
        )}

        {previa && (
          <PreviaMural
            mes={mes}
            // Prévia de uma pessoa: só os recados dela (já no mural + a liberar).
            itens={itensDaPrevia(
              previa.quem ? itens.filter((i) => i.colaborador.trim().toUpperCase() === previa.quem!.trim().toUpperCase()) : itens,
              previa.aLiberar,
              chaveItem,
            )}
            novos={previa.aLiberar.filter((i) => i.status === "pendente").length}
            quem={previa.quem}
            onFechar={() => setPrevia(null)}
          />
        )}
      </div>
    </div>
  );
}

function PreviaMural({ mes, itens, novos, quem, onFechar }: {
  mes: string; itens: ItemModeracao[]; novos: number; quem?: string; onFechar: () => void;
}) {
  // A prévia fica por cima da confirmação (zIndex maior): dá para olhar e
  // voltar para o "Sim, liberar" sem perder nada.
  return (
    <div onClick={onFechar} style={{ position: "absolute", inset: 0, zIndex: 5, background: "rgba(15,23,42,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Prévia do Mural do Início" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(760px, 100%)", maxHeight: "100%", overflowY: "auto", background: "#f1f5f9", borderRadius: 16, boxShadow: "0 24px 60px rgba(15,23,42,.4)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 18px", background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: "#0f172a" }}>👁 Prévia — assim aparece no Início{quem ? ` (${quem})` : ""}</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3, lineHeight: 1.45 }}>
              {novos > 0
                ? <>Inclui <b>{plural(novos, "recado pendente", "recados pendentes")}</b> como se já estivessem liberados, junto com o que já está no mural. </>
                : <>Só o que já está no mural. </>}
              Nada é publicado por aqui. No Início entra a foto do cadastro de cada pessoa.
            </div>
          </div>
          <button onClick={onFechar} aria-label="Fechar prévia" style={{ ...btn("#fff", "#475569", "1px solid #e2e8f0"), fontSize: 14, padding: "4px 10px" }}>✕</button>
        </div>
        <div className="rec-previa" style={{ padding: 18 }}>
          {itens.length ? (
            <CartaoReconhecimento mes={mes} itens={itens.map(paraCartao)} rodape="Prévia — ainda não publicado." />
          ) : (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Nada para mostrar: sem recados liberados ou pendentes. Recusados não entram no mural.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
