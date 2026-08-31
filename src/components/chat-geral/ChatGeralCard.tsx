import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessagesSquare, SendHorizonal, X } from "lucide-react";
import { LIMITE_TEXTO, useChatGeral, type MensagemChat } from "@/hooks/useChatGeral";
import { usarEstiloChatGeral } from "./estilos";

/**
 * Chat geral da empresa — cartão do Início, ao lado dos aniversariantes.
 *
 * Uma sala só, sem canal, sem menção e sem thread: é o mural de recado rápido
 * que antes vivia em grupo de WhatsApp. Quem escreveu apaga o que escreveu;
 * quem tem o flag "Pode apagar mensagens do chat geral" (Administração ›
 * Acesso por Usuário) apaga qualquer uma. Editar não existe de propósito —
 * ninguém reescreve o que os outros já leram.
 *
 * A rolagem só é forçada para o fim quando a pessoa JÁ estava no fim. Se ela
 * subiu para reler algo, a chegada de mensagem nova (o polling é de 15s) não
 * pode arrancar a tela de baixo dela.
 */
export function ChatGeralCard() {
  usarEstiloChatGeral();
  const { mensagens, carregando, enviar, apagar } = useChatGeral();
  const [texto, setTexto] = useState("");
  const refLista = useRef<HTMLDivElement>(null);
  const refColado = useRef(true);

  const registrarRolagem = () => {
    const el = refLista.current;
    if (!el) return;
    refColado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    const el = refLista.current;
    if (el && refColado.current) el.scrollTop = el.scrollHeight;
  }, [mensagens.length]);

  const enviarAgora = () => {
    const limpo = texto.trim();
    if (!limpo || enviar.isPending) return;
    setTexto("");
    refColado.current = true;
    enviar.mutate(limpo, {
      onError: (e: any) => {
        setTexto(limpo); // devolve o que a pessoa escreveu, não some com ele
        toast.error(e?.message ?? "Não deu para enviar a mensagem.");
      },
    });
  };

  const apagarAgora = (m: MensagemChat) => {
    if (!window.confirm("Apagar esta mensagem? Ela some para todo mundo.")) return;
    apagar.mutate(m.id, {
      onError: (e: any) => toast.error(e?.message ?? "Não deu para apagar."),
    });
  };

  // Cada linha já sabe se repete o autor da anterior e se abre um dia novo —
  // o JSX abaixo só desenha, não decide.
  const linhas = useMemo(() => montarLinhas(mensagens), [mensagens]);

  return (
    <section className="ini-card">
      <div className="ini-card-hd">
        <div className="ini-hd-tx">
          <h3><MessagesSquare className="ini-hd-ic" aria-hidden /> Chat da empresa</h3>
          <p>Recado rápido para todo mundo do ERP.</p>
        </div>
      </div>

      <div className="chat-body">
        <div
          className="chat-lista"
          ref={refLista}
          onScroll={registrarRolagem}
          role="log"
          aria-label="Mensagens do chat da empresa"
        >
          {carregando && <p className="ini-nota">Carregando…</p>}

          {!carregando && !mensagens.length && (
            <div className="chat-vazio">
              <MessagesSquare size={22} aria-hidden />
              <p>Nenhuma mensagem ainda. Manda a primeira.</p>
            </div>
          )}

          {linhas.map(({ msg, seguida, diaNovo }) => (
            <div key={`l${msg.id}`}>
              {diaNovo && <p className="chat-dia">{rotuloDia(msg.criado_em)}</p>}
              <div className={`chat-msg ${seguida ? "chat-msg--seguida" : ""}`}>
                {seguida
                  ? <span className="chat-av chat-av--vazio" aria-hidden />
                  : msg.autor_avatar
                    ? <img className="chat-av" src={msg.autor_avatar} alt="" loading="lazy" />
                    : <span className="chat-av" aria-hidden>{iniciais(msg.autor_nome)}</span>}

                <div className="chat-msg-corpo">
                  {!seguida && (
                    <div className="chat-msg-topo">
                      <span className={`chat-autor ${msg.sou_eu ? "chat-autor--eu" : ""}`}>
                        {msg.sou_eu ? "Você" : primeiroESobrenome(msg.autor_nome)}
                      </span>
                      <span className="chat-hora">{hora(msg.criado_em)}</span>
                    </div>
                  )}
                  <p className="chat-texto">{msg.texto}</p>
                </div>

                {msg.posso_apagar && (
                  <button
                    type="button"
                    className="chat-apagar"
                    onClick={() => apagarAgora(msg)}
                    title="Apagar mensagem"
                    aria-label="Apagar mensagem"
                  >
                    <X size={12} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="chat-envio">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, LIMITE_TEXTO))}
            onKeyDown={(e) => {
              // Enter manda, Shift+Enter quebra linha — o que todo mundo já
              // espera de uma caixa de chat.
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarAgora(); }
            }}
            maxLength={LIMITE_TEXTO}
            rows={1}
            placeholder="Escreva para a empresa…"
            aria-label="Mensagem para o chat da empresa"
          />
          <button
            type="button"
            className="chat-enviar"
            onClick={enviarAgora}
            disabled={!texto.trim() || enviar.isPending}
            title="Enviar (Enter)"
            aria-label="Enviar mensagem"
          >
            <SendHorizonal size={16} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Agrupamento e formatação                                             */
/* ------------------------------------------------------------------ */

/** Marca cada mensagem como "continuação do mesmo autor" e "abre um dia novo".
 *  Continuação vale só dentro de 5 minutos: depois disso é outra conversa,
 *  mesmo sendo a mesma pessoa. */
function montarLinhas(mensagens: MensagemChat[]) {
  return mensagens.map((msg, i) => {
    const ant = i > 0 ? mensagens[i - 1] : null;
    const diaNovo = !ant || new Date(ant.criado_em).toDateString() !== new Date(msg.criado_em).toDateString();
    const perto = !!ant &&
      new Date(msg.criado_em).getTime() - new Date(ant.criado_em).getTime() < 5 * 60_000;
    return { msg, diaNovo, seguida: !diaNovo && !!ant && ant.autor === msg.autor && perto };
  });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function rotuloDia(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function primeiroESobrenome(nome: string) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(" ");
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

function iniciais(nome: string) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
