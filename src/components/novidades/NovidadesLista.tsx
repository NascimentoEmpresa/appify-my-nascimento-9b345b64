import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, Megaphone, Pencil, Trash2 } from "lucide-react";
import { fmtQuando, selo, type Novidade } from "@/lib/novidades";

/**
 * A lista de novidades. É a MESMA nos três lugares (megafone, Início e
 * página) — o que muda é quantas entram e se os botões de edição aparecem.
 * Uma cópia divergiria no primeiro ajuste de rótulo.
 */
export function NovidadesLista({
  novidades, naoLidasIds, carregando, podePublicar, onEditar, onExcluir, vazioTexto,
}: {
  novidades: Novidade[];
  naoLidasIds?: Set<number>;
  carregando?: boolean;
  podePublicar?: boolean;
  onEditar?: (n: Novidade) => void;
  onExcluir?: (n: Novidade) => void;
  vazioTexto?: string;
}) {
  const navigate = useNavigate();

  if (carregando) {
    return (
      <div className="nov-lista">
        {[0, 1, 2].map(i => <div key={i} className="nov-skel" />)}
      </div>
    );
  }

  if (!novidades.length) {
    return (
      <div className="nov-vazio">
        <Megaphone size={26} aria-hidden />
        <p>{vazioTexto ?? "Nenhuma novidade publicada ainda."}</p>
      </div>
    );
  }

  return (
    <div className="nov-lista">
      {novidades.map((n, i) => {
        const s = selo(n.tipo);
        const nova = naoLidasIds?.has(n.id) ?? false;
        return (
          <article
            key={n.id}
            className={`nov-item ${nova ? "nov-item--nova" : ""}`}
            style={{ "--i": i, "--selo": s.cor, "--selo-bg": s.fundo } as React.CSSProperties}
          >
            <div className="nov-item-top">
              <span className="nov-data"><CalendarDays size={11} aria-hidden /> {fmtQuando(n.publicado_em)}</span>
              <span className="nov-selo">{s.rotulo}</span>
              {!n.publicado && <span className="nov-rascunho">Rascunho</span>}
            </div>
            <h4 className="nov-item-tt">{n.titulo}</h4>
            <p className="nov-item-ds">{n.descricao}</p>

            <div className="nov-item-pe">
              {n.rota && (
                <button type="button" className="nov-link" onClick={() => navigate(n.rota!)}>
                  Saiba mais <ArrowRight size={12} aria-hidden />
                </button>
              )}
              {podePublicar && onEditar && (
                <button type="button" className="nov-link" onClick={() => onEditar(n)}>
                  <Pencil size={12} aria-hidden /> Editar
                </button>
              )}
              {podePublicar && onExcluir && (
                <button
                  type="button"
                  className="nov-link"
                  style={{ color: "#dc2626" }}
                  onClick={() => onExcluir(n)}
                >
                  <Trash2 size={12} aria-hidden /> Excluir
                </button>
              )}
              {n.criado_por_nome && <span className="nov-autor">por {n.criado_por_nome}</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
