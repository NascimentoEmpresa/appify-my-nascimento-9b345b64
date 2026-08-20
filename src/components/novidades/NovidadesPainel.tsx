import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Megaphone, Plus } from "lucide-react";
import { useNovidades } from "@/hooks/useNovidades";
import { usarEstiloNovidades } from "./estilos";
import { NovidadesLista } from "./NovidadesLista";
import { NovidadeFormModal } from "./NovidadeFormModal";
import type { FormNovidade, Novidade } from "@/lib/novidades";

/**
 * Painel de Novidades do Sistema.
 *
 * É o mesmo componente no Início (recortado nas 4 mais recentes) e na página
 * /app/novidades (`completo`, com tudo e sem o rodapé "ver todas"). O botão de
 * publicar só existe para quem tem o flag; a RLS recusa o resto.
 */
export function NovidadesPainel({ limite = 4, completo = false }: { limite?: number; completo?: boolean }) {
  usarEstiloNovidades();
  const navigate = useNavigate();
  const {
    novidades, pendentes, carregando, podePublicar, salvar, excluir,
  } = useNovidades();

  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Novidade | null>(null);

  const naoLidasIds = useMemo(() => new Set(pendentes.map(n => n.id)), [pendentes]);
  const visiveis = completo ? novidades : novidades.slice(0, limite);

  const abrirNova = useCallback(() => { setEditando(null); setModal(true); }, []);
  const abrirEdicao = useCallback((n: Novidade) => { setEditando(n); setModal(true); }, []);

  const gravar = async (form: FormNovidade) => {
    try {
      await salvar.mutateAsync({ id: editando?.id, form });
      toast.success(editando ? "Novidade atualizada." : "Novidade publicada para toda a equipe.");
      setModal(false);
      setEditando(null);
    } catch (e: any) {
      toast.error(`Não deu para salvar: ${e?.message ?? "erro desconhecido"}`);
    }
  };

  const apagar = async (n: Novidade) => {
    if (!window.confirm(`Excluir a novidade "${n.titulo}"? Ela some para todo mundo.`)) return;
    try {
      await excluir.mutateAsync(n.id);
      toast.success("Novidade excluída.");
    } catch (e: any) {
      toast.error(`Não deu para excluir: ${e?.message ?? "erro desconhecido"}`);
    }
  };

  return (
    <section className="nov-card">
      <div className="nov-hd">
        <span className={`nov-hd-ic ${pendentes.length ? "nov-hd-ic--vivo" : ""}`}>
          <Megaphone size={17} aria-hidden />
        </span>
        <div className="nov-hd-tx">
          <h3>Novidades do Sistema</h3>
          <p>Fique por dentro das últimas atualizações e melhorias no ERP Nascimento.</p>
        </div>
        <div className="nov-hd-acoes">
          {podePublicar && (
            <button type="button" className="nov-btn" onClick={abrirNova}>
              <Plus size={13} aria-hidden /> Nova
            </button>
          )}
          {!completo && (
            <button type="button" className="nov-link" onClick={() => navigate("/app/novidades")}>
              Ver todas <ArrowRight size={12} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <NovidadesLista
        novidades={visiveis}
        naoLidasIds={naoLidasIds}
        carregando={carregando}
        podePublicar={podePublicar}
        onEditar={abrirEdicao}
        onExcluir={apagar}
        vazioTexto={podePublicar
          ? "Nada publicado ainda. Clique em “Nova” para contar o que mudou."
          : "Nenhuma novidade publicada ainda."}
      />

      {!completo && novidades.length > visiveis.length && (
        <div className="nov-rodape">
          <button type="button" onClick={() => navigate("/app/novidades")}>
            Ver todas as atualizações <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      )}

      <NovidadeFormModal
        aberto={modal}
        editando={editando}
        salvando={salvar.isPending}
        onFechar={() => { setModal(false); setEditando(null); }}
        onSalvar={gravar}
      />
    </section>
  );
}
