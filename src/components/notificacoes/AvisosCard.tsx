import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, GraduationCap, Info, Megaphone, Settings } from "lucide-react";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { estaVigente } from "@/lib/notificacoes";

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
            <li key={n.id} className="ini-aviso">
              <span className="ini-aviso-ic" style={{ background: cor.fundo, color: cor.texto }}>
                <Icone className="h-4 w-4" aria-hidden />
              </span>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
