import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, GraduationCap, Info, Megaphone, Settings } from "lucide-react";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { estaVigente, fmtDataHora, type Notificacao } from "@/lib/notificacoes";
import { ImagemAviso } from "@/components/notificacoes/ImagemAviso";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Quadro de Avisos no Início — o mural, não o gate.
 *
 * O aviso que EXIGE resposta continua aparecendo por cima de tudo
 * (GateNotificacoes, montado no layout do /app). Este cartão é a outra
 * metade: o aviso que já foi respondido, e o que nunca pediu ciência,
 * continuam valendo como recado e precisam de um lugar para serem relidos
 * sem virar caixa na frente de ninguém.
 *
 * Por isso lista TODO aviso vigente, inclusive o que a pessoa já respondeu:
 * "quando mesmo era o prazo do reembolso?" é a pergunta que este bloco
 * responde. Filtrar os respondidos deixaria o mural vazio no dia seguinte à
 * publicação, justamente quando ele começa a servir.
 *
 * 10/09/2026 — "pra algumas pessoas apareceu só um card simples, em vez de
 * aparecer com a imagem certinho". Era isto aqui. Quem JÁ respondeu para de
 * receber o gate (que mostra o cartaz) e passa a ver só esta linha, que era
 * texto puro — o mesmo aviso com duas caras conforme a pessoa já tivesse
 * respondido ou não. Agora a linha mostra a miniatura e abre o aviso inteiro,
 * imagem e tudo, no clique.
 *
 * Some sozinho quando não há aviso nenhum: cartão vazio numa tela que fica
 * aberta o expediente inteiro é ruído.
 */

/** Ícone por categoria. Ícone de sistema, nunca emoji — regra do Início. */
const ICONE: Record<string, typeof Info> = {
  Comunicado: Info,
  Sistemas: Settings,
  Treinamento: GraduationCap,
  Processos: AlertTriangle,
  Procedimentos: Settings,
  RH: Megaphone,
};

const COR: Record<string, { fundo: string; texto: string }> = {
  Comunicado: { fundo: "#eff6ff", texto: "#1d4ed8" },
  Sistemas: { fundo: "#eef2ff", texto: "#4338ca" },
  Treinamento: { fundo: "#ecfdf5", texto: "#047857" },
  Processos: { fundo: "#fef2f2", texto: "#b91c1c" },
  Procedimentos: { fundo: "#f5f3ff", texto: "#6d28d9" },
  RH: { fundo: "#fff7ed", texto: "#c2410c" },
};

const fmtData = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleDateString("pt-BR");
};

export function AvisosCard({ limite = 4 }: { limite?: number }) {
  const { notificacoes, podeVerQuadro } = useNotificacoes();
  const [aberto, setAberto] = useState<Notificacao | null>(null);

  const vigentes = notificacoes.filter((n) => estaVigente(n)).slice(0, limite);
  if (!vigentes.length) return null;

  return (
    <section className="ini-card" data-reveal>
      <div className="ini-card-hd">
        <div className="ini-hd-tx">
          <h3><Megaphone className="ini-hd-ic" aria-hidden /> Quadro de Avisos</h3>
          <p>Fique por dentro dos comunicados, prazos e informações importantes.</p>
        </div>
        {/* O link só para quem abre a tela: mandar alguém para uma página que
            vai recusá-lo é pior do que não oferecer o caminho. */}
        {podeVerQuadro && (
          <div className="ini-hd-acoes">
            <Link to="/app/central-servicos/quadro-avisos" className="ini-link-mais">
              Ver todos os avisos <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        )}
      </div>

      <ul className="ini-avisos">
        {vigentes.map((n) => {
          const cat = n.categoria ?? "Comunicado";
          const Icone = ICONE[cat] ?? Info;
          const cor = COR[cat] ?? COR.Comunicado;
          return (
            <li key={n.id}>
              {/* Botão, e não div com onClick: o mural é navegável no teclado
                  como o resto do Início, e leitor de tela precisa saber que
                  isto abre alguma coisa. */}
              <button type="button" className="ini-aviso" onClick={() => setAberto(n)}>
                {n.anexo_url ? (
                  <img src={n.anexo_url} alt="" className="ini-aviso-mini" loading="lazy" />
                ) : (
                  <span className="ini-aviso-ic" style={{ background: cor.fundo, color: cor.texto }}>
                    <Icone className="h-4 w-4" aria-hidden />
                  </span>
                )}
                <div className="ini-aviso-tx">
                  <strong>{n.titulo}</strong>
                  {/* O resumo existe para isto: a linha curta da lista. Sem ele,
                      cai o conteúdo — cortado no CSS, nunca no meio de uma
                      palavra por JS. */}
                  <span>{n.resumo || n.mensagem}</span>
                </div>
                <div className="ini-aviso-meta">
                  <time dateTime={n.publicado_em}>{fmtData(n.publicado_em)}</time>
                  <span className="ini-aviso-cat" style={{ background: cor.fundo, color: cor.texto }}>
                    {cat}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* O aviso inteiro, com o cartaz. Sem botão de responder: a ciência é
          do gate, e um segundo lugar para responder daria dois caminhos para o
          mesmo registro. Aqui é releitura. */}
      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{aberto?.titulo}</DialogTitle>
            <DialogDescription>
              {aberto?.categoria} · publicado em {fmtDataHora(aberto?.publicado_em)}
              {aberto?.criado_por_nome ? ` por ${aberto.criado_por_nome}` : ""}
            </DialogDescription>
          </DialogHeader>
          {aberto && (
            <div className="space-y-3">
              {aberto.anexo_url && (
                <ImagemAviso
                  url={aberto.anexo_url}
                  nome={aberto.anexo_nome}
                  prioridade
                  className="aspect-video w-full"
                />
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{aberto.mensagem}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
