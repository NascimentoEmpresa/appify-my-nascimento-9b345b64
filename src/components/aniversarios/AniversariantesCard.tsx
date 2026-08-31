import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Cake, MessageSquarePlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  EMOJI_REACAO, REACOES, useAniversariantes, useFelicitar,
  type Aniversariante, type Felicitacao, type ReacaoChave,
} from "@/hooks/useAniversariantes";
import { usarEstiloAniversarios } from "./estilos";

/**
 * Cartão de Aniversariantes do Início.
 *
 * Duas coisas acontecem aqui, e só duas:
 *   1. Quem faz aniversário HOJE aparece com foto, e o colega deixa uma
 *      reação e (se quiser) um recado curto. As reações recebidas ficam
 *      grudadas na foto da pessoa, empilhadas, o dia inteiro.
 *   2. Quem faz nos próximos dias aparece numa lista de uma linha por
 *      pessoa — sem foto, sem reação: ainda não é o dia dela.
 *
 * SOBRE O EMOJI. A tela de Início tem uma regra explícita de "ícone de
 * sistema, não emoji" (ver o cabeçalho de `pages/Inicio.tsx`), e ela vale:
 * o cabeçalho deste cartão usa o mesmo `lucide-react` do resto. A exceção
 * é a REAÇÃO — ali o emoji não é enfeite de interface, é o conteúdo que uma
 * pessoa mandou para a outra, do mesmo jeito que no WhatsApp de onde a
 * equipe veio. Trocar isso por um ícone monocromático mataria a coisa.
 *
 * O cartão SOME quando não há ninguém hoje nem nos próximos dias — cartão
 * vazio todo dia é ruído numa tela que fica aberta o expediente inteiro.
 */
export function AniversariantesCard({ dias = 15, maxProximos = 5 }: { dias?: number; maxProximos?: number }) {
  usarEstiloAniversarios();
  const { user } = useAuth();
  const { deHoje, emBreve, mural, carregando } = useAniversariantes(dias);

  if (carregando || (!deHoje.length && !emBreve.length)) return null;

  // O cartão divide a fileira com o Chat da empresa: a lista de próximos é
  // cortada para o bloco não crescer mais que o vizinho. Em 15/09 caem sete
  // aniversários no mesmo dia — sem o corte, o "próximos" viraria a maior
  // parte da tela inicial.
  const proximosVisiveis = emBreve.slice(0, maxProximos);
  const proximosRestantes = emBreve.length - proximosVisiveis.length;

  return (
    <section className="ini-card">
      <div className="ini-card-hd">
        <div className="ini-hd-tx">
          <h3><Cake className="ini-hd-ic" aria-hidden /> Aniversariantes</h3>
          <p>
            {deHoje.length
              ? "Mande uma reação ou um recado para quem faz aniversário hoje."
              : "Ninguém faz aniversário hoje. Estes são os próximos."}
          </p>
        </div>
      </div>

      <div className="ini-card-body aniv-body">
        {deHoje.length > 0 && (
          <>
            <div className="aniv-hoje">
              {deHoje.map((pessoa) => (
                <PessoaDoDia
                  key={pessoa.user_id}
                  pessoa={pessoa}
                  felicitacoes={mural.filter((f) => f.aniversariante === pessoa.user_id)}
                  souEu={pessoa.user_id === user?.id}
                />
              ))}
            </div>
            {emBreve.length > 0 && <p className="aniv-titulo">Próximos</p>}
          </>
        )}

        {proximosVisiveis.length > 0 && (
          <div className="aniv-breve">
            {proximosVisiveis.map((p) => (
              <div key={p.user_id} className="aniv-breve-item">
                <span className="aniv-breve-data">{dataCurta(p)}</span>
                <span className="aniv-breve-nome">
                  {primeiroESobrenome(p.nome)}
                  {p.setor ? <span style={{ opacity: 0.6 }}> · {p.setor}</span> : null}
                </span>
                <span className="aniv-breve-quando">{quando(p.dias_ate)}</span>
              </div>
            ))}
            {proximosRestantes > 0 && (
              <p className="aniv-breve-mais">
                e mais {proximosRestantes} {proximosRestantes === 1 ? "pessoa" : "pessoas"} até {quando(emBreve[emBreve.length - 1].dias_ate)}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Uma pessoa do dia: foto com as reações grudadas, barra para reagir e  */
/* os recados que ela já recebeu.                                       */
/* ------------------------------------------------------------------ */
function PessoaDoDia({
  pessoa, felicitacoes, souEu,
}: {
  pessoa: Aniversariante;
  felicitacoes: Felicitacao[];
  souEu: boolean;
}) {
  const felicitar = useFelicitar();
  const [escrevendo, setEscrevendo] = useState(false);
  const [rascunho, setRascunho] = useState("");

  const minha = felicitacoes.find((f) => f.sou_eu) ?? null;
  const recados = felicitacoes.filter((f) => (f.mensagem ?? "").trim().length > 0);

  // Uma pilha por reação distinta, da mais usada para a menos usada. Só as
  // três primeiras entram na foto — a partir da quarta a foto some atrás
  // das bolinhas.
  const pilhas = useMemo(() => {
    const conta = new Map<string, number>();
    felicitacoes.forEach((f) => {
      if (!f.reacao) return;
      conta.set(f.reacao, (conta.get(f.reacao) ?? 0) + 1);
    });
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [felicitacoes]);

  const enviar = (reacao: ReacaoChave | null, mensagem: string | null) => {
    felicitar.mutate(
      { aniversariante: pessoa.user_id, reacao, mensagem },
      {
        onError: (e: any) => toast.error(e?.message ?? "Não deu para enviar."),
      },
    );
  };

  const alternarReacao = (chave: ReacaoChave) => {
    const nova = minha?.reacao === chave ? null : chave;
    enviar(nova, minha?.mensagem ?? null);
  };

  const salvarRecado = () => {
    const texto = rascunho.trim();
    enviar(minha?.reacao ?? null, texto || null);
    setEscrevendo(false);
    setRascunho("");
    if (texto) toast.success(`Recado enviado para ${primeiroNome(pessoa.nome)}.`);
  };

  return (
    <div className={`aniv-pessoa ${souEu ? "aniv-pessoa--eu" : ""}`}>
      <div className="aniv-foto">
        {pessoa.avatar_url
          ? <img src={pessoa.avatar_url} alt="" loading="lazy" />
          : <span className="aniv-iniciais" aria-hidden>{iniciais(pessoa.nome)}</span>}

        {pilhas.length > 0 && (
          <div
            className="aniv-reacoes-foto"
            aria-label={`${pilhas.reduce((s, [, n]) => s + n, 0)} reações recebidas`}
          >
            {pilhas.slice(0, 3).map(([chave, n]) => (
              <span key={chave} className="aniv-reacao-chip">
                {EMOJI_REACAO[chave] ?? "🎉"}
                {n > 1 && <b>{n}</b>}
              </span>
            ))}
            {pilhas.length > 3 && <span className="aniv-reacao-chip"><b>+{pilhas.length - 3}</b></span>}
          </div>
        )}
      </div>

      <div className="aniv-corpo">
        <div>
          <p className="aniv-nome">{pessoa.nome}</p>
          {(pessoa.cargo || pessoa.setor) && (
            <p className="aniv-cargo">{[pessoa.cargo, pessoa.setor].filter(Boolean).join(" · ")}</p>
          )}
          {souEu && <p className="aniv-parabens">Parabéns! Hoje o dia é seu. 🎂</p>}
        </div>

        {/* Ninguém reage ao próprio aniversário — o banco recusa também. */}
        {!souEu && (
          <div className="aniv-barra">
            {REACOES.map((r) => (
              <button
                key={r.chave}
                type="button"
                className={`aniv-bt ${minha?.reacao === r.chave ? "aniv-bt--on" : ""}`}
                onClick={() => alternarReacao(r.chave)}
                disabled={felicitar.isPending}
                aria-pressed={minha?.reacao === r.chave}
                title={r.titulo}
              >
                <span aria-hidden>{r.emoji}</span>
                <span className="sr-only">{r.titulo}</span>
              </button>
            ))}
            {!escrevendo && (
              <button
                type="button"
                className="aniv-recado-bt"
                onClick={() => { setRascunho(minha?.mensagem ?? ""); setEscrevendo(true); }}
              >
                <MessageSquarePlus size={14} aria-hidden />
                {minha?.mensagem ? "Editar recado" : "Deixar um recado"}
              </button>
            )}
          </div>
        )}

        {escrevendo && (
          <div className="aniv-forma">
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value.slice(0, 180))}
              maxLength={180}
              autoFocus
              placeholder={`Escreva algo para ${primeiroNome(pessoa.nome)}…`}
              aria-label={`Recado para ${pessoa.nome}`}
            />
            <div className="aniv-forma-pe">
              <span className="aniv-contador">{rascunho.length}/180</span>
              <button
                type="button"
                className="ini-btn"
                onClick={() => { setEscrevendo(false); setRascunho(""); }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ini-btn ini-btn--ok"
                onClick={salvarRecado}
                disabled={felicitar.isPending}
              >
                {minha?.mensagem && !rascunho.trim() ? "Apagar recado" : "Enviar"}
              </button>
            </div>
          </div>
        )}

        {recados.length > 0 && (
          <div className="aniv-recados">
            {recados.map((f) => (
              <p key={f.autor} className="aniv-recado">
                <span className="aniv-recado-emoji" aria-hidden>
                  {f.reacao ? (EMOJI_REACAO[f.reacao] ?? "💬") : "💬"}
                </span>
                <span>
                  <b>{f.sou_eu ? "Você" : primeiroESobrenome(f.autor_nome)}:</b> {f.mensagem}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formatação                                                           */
/* ------------------------------------------------------------------ */

/** "05/09" — a lista de próximos não mostra ano, e o cadastro nem manda. */
function dataCurta(p: Aniversariante) {
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}`;
}

function quando(dias: number) {
  if (dias === 1) return "amanhã";
  if (dias < 7) return `em ${dias} dias`;
  if (dias === 7) return "em 1 semana";
  return `em ${dias} dias`;
}

function primeiroNome(nome: string) {
  return (nome || "").trim().split(/\s+/)[0] || "seu colega";
}

/** Nome de cadastro do Senior costuma ter cinco palavras; na lista cabem duas. */
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
