import { useEffect, useState } from "react";
import { Loader2, Megaphone, X } from "lucide-react";
import {
  FORM_VAZIO, TIPOS, validarNovidade,
  type FormNovidade, type Novidade, type TipoNovidade,
} from "@/lib/novidades";

/**
 * Publicar / editar uma novidade. Só chega aqui quem tem o flag "Pode criar
 * novidades do sistema" — a RLS recusa a gravação de qualquer outro, então o
 * modal é conveniência, não a trava.
 */
export function NovidadeFormModal({
  aberto, editando, salvando, onFechar, onSalvar,
}: {
  aberto: boolean;
  editando: Novidade | null;
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (form: FormNovidade) => Promise<void> | void;
}) {
  const [form, setForm] = useState<FormNovidade>({ ...FORM_VAZIO });
  const [erro, setErro] = useState<string | null>(null);

  // Reabrir o modal tem que trazer o formulário do registro certo — e limpo
  // quando é novidade nova, senão sobra o texto da anterior.
  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setForm(editando
      ? {
        titulo: editando.titulo,
        descricao: editando.descricao,
        tipo: editando.tipo,
        rota: editando.rota ?? "",
        publicado: editando.publicado,
      }
      : { ...FORM_VAZIO });
  }, [aberto, editando]);

  // Esc fecha: o modal cobre a tela inteira e o mouse pode estar longe do ✕.
  useEffect(() => {
    if (!aberto) return;
    const fecha = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", fecha);
    return () => window.removeEventListener("keydown", fecha);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const enviar = async () => {
    const problema = validarNovidade(form);
    if (problema) { setErro(problema); return; }
    setErro(null);
    await onSalvar(form);
  };

  return (
    <div className="nov-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="nov-modal" role="dialog" aria-modal="true" aria-label="Publicar novidade">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span className="nov-hd-ic"><Megaphone size={17} aria-hidden /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
              {editando ? "Editar novidade" : "Publicar novidade"}
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: ".75rem", color: "#94a3b8" }}>
              Aparece no Início e no megafone de todo mundo.
            </p>
          </div>
          <button
            type="button" onClick={onFechar} aria-label="Fechar"
            style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4 }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div style={{ height: 14 }} />
        {erro && <div className="nov-erro">{erro}</div>}

        <div className="nov-fg">
          <label htmlFor="nov-tipo">Tipo *</label>
          <div className="nov-tipos" id="nov-tipo">
            {TIPOS.map(t => (
              <button
                key={t.valor}
                type="button"
                className={`nov-tipo ${form.tipo === t.valor ? "nov-tipo--on" : ""}`}
                style={{ "--selo": t.cor, "--selo-bg": t.fundo } as React.CSSProperties}
                aria-pressed={form.tipo === t.valor}
                onClick={() => setForm(f => ({ ...f, tipo: t.valor as TipoNovidade }))}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="nov-fg">
          <label htmlFor="nov-titulo">Título *</label>
          <input
            id="nov-titulo" className="nov-fi" maxLength={120} autoFocus
            placeholder="Ex.: Novo módulo: Controle de Diárias"
            value={form.titulo}
            onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
          />
        </div>

        <div className="nov-fg">
          <label htmlFor="nov-desc">O que mudou *</label>
          <textarea
            id="nov-desc" className="nov-fi" rows={4} maxLength={1000}
            placeholder="Explique em duas linhas o que a pessoa ganha com isso."
            value={form.descricao}
            onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
          />
          <p className="nov-fi-dica">{form.descricao.length}/1000</p>
        </div>

        <div className="nov-fg">
          <label htmlFor="nov-rota">Link do "Saiba mais" (opcional)</label>
          <input
            id="nov-rota" className="nov-fi"
            placeholder="/app/rh/colaboradores"
            value={form.rota}
            onChange={e => setForm(f => ({ ...f, rota: e.target.value }))}
          />
          <p className="nov-fi-dica">Rota interna do ERP, começando com "/". Deixe vazio para não mostrar o botão.</p>
        </div>

        <div className="nov-fg">
          <label className="nov-switch">
            <input
              type="checkbox" checked={form.publicado}
              onChange={e => setForm(f => ({ ...f, publicado: e.target.checked }))}
            />
            <span className="nov-switch-tr" aria-hidden />
            <span className="nov-switch-tx">
              {form.publicado ? "Publicada — todo mundo vê" : "Rascunho — só quem publica vê"}
            </span>
          </label>
        </div>

        <div className="nov-modal-pe">
          <button type="button" className="nov-btn nov-btn--fantasma" onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className="nov-btn" onClick={enviar} disabled={salvando}>
            {salvando && <Loader2 size={13} className="animate-spin" aria-hidden />}
            {editando ? "Salvar alterações" : "Publicar novidade"}
          </button>
        </div>
      </div>
    </div>
  );
}
