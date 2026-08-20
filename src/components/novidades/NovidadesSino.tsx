import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Megaphone } from "lucide-react";
import { useNovidades } from "@/hooks/useNovidades";
import { rotuloContador } from "@/lib/novidades";
import { usarEstiloNovidades } from "./estilos";
import { NovidadesLista } from "./NovidadesLista";

/**
 * Megafone da barra de topo: bolinha com quantas novidades a pessoa ainda não
 * viu, e a lista curta ao clicar.
 *
 * A marca de lida é gravada ao ABRIR — não no render nem no hover. Bolinha que
 * some sozinha ao passar o mouse é bolinha que ninguém leu.
 */
export function NovidadesSino({ aoAbrir }: { aoAbrir?: () => void }) {
  usarEstiloNovidades();
  const navigate = useNavigate();
  const { novidades, pendentes, naoLidasCount, carregando, marcarLidas } = useNovidades();
  const [aberto, setAberto] = useState(false);

  // Congela quais estavam pendentes na abertura: sem isso, `marcarLidas`
  // apagaria os pontinhos na frente da pessoa, no mesmo instante em que ela
  // abriu para ler.
  const [destaques, setDestaques] = useState<Set<number>>(new Set());
  const pendentesRef = useRef(pendentes);
  pendentesRef.current = pendentes;

  const alternar = useCallback(() => {
    setAberto(atual => {
      const proximo = !atual;
      if (proximo) {
        aoAbrir?.();
        setDestaques(new Set(pendentesRef.current.map(n => n.id)));
        void marcarLidas();
      }
      return proximo;
    });
  }, [aoAbrir, marcarLidas]);

  useEffect(() => {
    if (!aberto) return;
    const fecha = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", fecha);
    return () => window.removeEventListener("keydown", fecha);
  }, [aberto]);

  const visiveis = useMemo(() => novidades.slice(0, 6), [novidades]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={alternar}
        aria-label={naoLidasCount ? `Novidades do sistema (${naoLidasCount} não lidas)` : "Novidades do sistema"}
        title="Novidades do Sistema"
        aria-expanded={aberto}
        className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Megaphone className={`h-4 w-4 ${naoLidasCount ? "nov-hd-ic--vivo" : ""}`} />
        {naoLidasCount > 0 && (
          <span className="nov-bolinha">{rotuloContador(naoLidasCount)}</span>
        )}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="nov-pop">
            <div className="nov-hd" style={{ padding: "13px 15px 9px" }}>
              <span className="nov-hd-ic" style={{ width: 30, height: 30 }}>
                <Megaphone size={15} aria-hidden />
              </span>
              <div className="nov-hd-tx">
                <h3>Novidades do Sistema</h3>
                <p>{naoLidasCount > 0
                  ? `${naoLidasCount} ${naoLidasCount === 1 ? "novidade nova" : "novidades novas"}`
                  : "Você está em dia."}</p>
              </div>
            </div>

            <NovidadesLista
              novidades={visiveis}
              naoLidasIds={destaques}
              carregando={carregando}
            />

            <div className="nov-rodape">
              <button type="button" onClick={() => { setAberto(false); navigate("/app/novidades"); }}>
                Ver todas as atualizações <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
