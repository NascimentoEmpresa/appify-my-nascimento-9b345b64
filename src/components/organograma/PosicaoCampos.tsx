import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Network, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BuscaPessoa } from "./BuscaPessoa";
import { carregarContratos, carregarPostos, type PosicaoForm } from "@/lib/organograma/pessoas";

// "Onde a pessoa fica no organograma": o mesmo bloco no criar/editar usuário,
// no cadastro do colaborador e na tela do organograma. <select> nativo de
// propósito: o Select do shadcn abre em portal e fica atrás do modal do
// Colaboradores (z-index 700).
const CLASSE_SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function PosicaoCampos({ valor, onValor, semSuperior = false, semFuncao = false, funcaoObrigatoria = false, titulo = "Posição no organograma" }: {
  valor: PosicaoForm;
  onValor: (p: PosicaoForm) => void;
  /** Quem chama já cuida do "reporta a" (o organograma tem seletor próprio, com grupos). */
  semSuperior?: boolean;
  semFuncao?: boolean;
  funcaoObrigatoria?: boolean;
  titulo?: string;
}) {
  const muda = (patch: Partial<PosicaoForm>) => onValor({ ...valor, ...patch });

  const contratosQ = useQuery({ queryKey: ["organograma-contratos"], queryFn: carregarContratos, staleTime: 5 * 60_000 });
  const postosQ = useQuery({
    queryKey: ["organograma-postos", valor.empresa, valor.filial],
    queryFn: () => carregarPostos(valor.empresa!, valor.filial!),
    enabled: valor.empregadoId != null && valor.empresa != null && valor.filial != null,
    staleTime: 5 * 60_000,
  });

  const contratosLivres = (contratosQ.data ?? []).filter((c) =>
    !valor.extras.some((x) => x.empresa === c.empresa && x.filial === c.filial)
    && !(c.empresa === valor.empresa && c.filial === valor.filial));
  const postos = postosQ.data ?? [];
  const postoForaDaLista = valor.postoCodigo && !postos.some((p) => p.codigo === valor.postoCodigo);

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary"><Network className="h-3.5 w-3.5" /> {titulo}</p>

      {!semSuperior && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Reporta a (superior imediato) <span className="text-destructive">*</span></p>
          {valor.topo ? (
            <p className="rounded-md border bg-background px-2.5 py-2 text-sm text-muted-foreground">Ninguém — fica no topo da empresa</p>
          ) : valor.superior ? (
            <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{valor.superior.nome}</span>
              {valor.deduzido && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">sugerido pelo posto — confira</span>}
              <button type="button" title="Trocar o superior" onClick={() => muda({ superior: null, deduzido: false })} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <BuscaPessoa soNaArvore ocultarId={valor.noId} placeholder="Busque o superior pelo nome…"
              onEscolher={(p) => p.no_id && muda({ superior: { id: p.no_id, nome: p.nome }, doGrupo: false, deduzido: false })} />
          )}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={valor.topo}
              onChange={(e) => muda({ topo: e.target.checked, superior: e.target.checked ? null : valor.superior, deduzido: false })} />
            Não reporta a ninguém (topo da empresa)
          </label>
          {valor.equipeDireta > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {valor.equipeDireta} pessoa(s) respondem direto a esta pessoa e continuam com ela ao mudar o superior. Para reorganizar a equipe, use o organograma.
            </p>
          )}
        </div>
      )}

      {!semFuncao && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Função no organograma {funcaoObrigatoria ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(opcional)</span>}</p>
          <Input value={valor.funcao} maxLength={80} onChange={(e) => muda({ funcao: e.target.value })} placeholder={valor.cargo || "Ex.: Gerente de RH"} />
          {!funcaoObrigatoria && <p className="text-[11px] text-muted-foreground">Em branco, vale o cargo do cadastro{valor.cargo ? ` (${valor.cargo})` : ""}.</p>}
        </div>
      )}

      {valor.empregadoId != null && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Posto</p>
          <select className={CLASSE_SELECT} value={valor.postoCodigo ?? ""} onChange={(e) => muda({ postoCodigo: e.target.value || null })}>
            <option value="">— Sem posto —</option>
            {postoForaDaLista && <option value={valor.postoCodigo!}>{valor.postoCodigo}</option>}
            {postos.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.titulo}</option>)}
          </select>
          <p className="text-[11px] text-muted-foreground">Vem do cadastro. Trocar aqui vale em todo o ERP (mesmo ajuste da Hierarquia de Postos), inclusive o ponto.</p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold">Contrato</p>
        {valor.contrato && <p className="rounded-md border bg-background px-2.5 py-1.5 text-sm">{valor.contrato} <span className="text-[11px] text-muted-foreground">(do cadastro)</span></p>}
        {valor.extras.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {valor.extras.map((c) => (
              <span key={`${c.empresa}-${c.filial}`} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium">
                {c.nome}
                <button type="button" title="Tirar deste contrato" className="text-muted-foreground hover:text-foreground"
                  onClick={() => muda({ extras: valor.extras.filter((x) => x !== c) })}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <select className={CLASSE_SELECT} value="" onChange={(e) => {
          const c = contratosLivres.find((x) => `${x.empresa}-${x.filial}` === e.target.value);
          if (c) muda({ extras: [...valor.extras, c] });
        }}>
          <option value="">{valor.contrato ? "Atrelar também a outro contrato…" : "Atrelar a um contrato…"}</option>
          {contratosLivres.map((c) => <option key={`${c.empresa}-${c.filial}`} value={`${c.empresa}-${c.filial}`}>{c.nome}</option>)}
        </select>
      </div>
    </div>
  );
}
