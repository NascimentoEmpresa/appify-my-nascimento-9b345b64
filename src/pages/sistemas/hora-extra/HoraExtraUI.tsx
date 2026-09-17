import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleX, Clock3, Download, Hourglass, Paperclip, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { urlAssinadaHoraExtra } from "@/hooks/useHoraExtra";
import { cn } from "@/lib/utils";
import { formatarDuracao, mensagemErro, rotuloFaseAnexo, statusExibicao } from "./horaExtraUtils";
import type { AnexoHoraExtra, SolicitacaoHoraExtra, StatusExecucao } from "./types";
import { STATUS_EXECUCAO } from "./types";

export function BreadcrumbHoraExtra({ atual }: { atual: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span>ERP</span>
      <span>›</span>
      <span>Sistemas</span>
      <span>›</span>
      <span>Hora Extra</span>
      <span>›</span>
      <strong className="text-slate-800">{atual}</strong>
    </div>
  );
}

export function BadgeStatus({ solicitacao }: { solicitacao: Pick<SolicitacaoHoraExtra, "status" | "data_he"> }) {
  const item = statusExibicao(solicitacao.status, solicitacao.data_he);
  const Icone =
    item.icone === "ampulheta"
      ? Hourglass
      : item.icone === "x"
        ? CircleX
        : item.icone === "relogio"
          ? Clock3
          : CheckCircle2;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold",
        item.classe,
      )}
    >
      <Icone className="h-3 w-3" />
      {item.label}
    </span>
  );
}

export function BadgeExecucao({ status }: { status?: StatusExecucao | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const item = STATUS_EXECUCAO[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold",
        item.classe,
      )}
    >
      <item.Icone className="h-3 w-3" />
      {item.label}
    </span>
  );
}

export function SecaoForm({
  titulo,
  subtitulo,
  icone,
  children,
  className,
}: {
  titulo: string;
  subtitulo?: string;
  icone?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white p-4", className)}>
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 text-[#07194b]">{icone}</span>
        <div>
          <h3 className="font-bold text-[#07194b]">{titulo}</h3>
          {subtitulo && <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Campo({
  rotulo,
  obrigatorio,
  children,
  className,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium text-slate-600">
        {rotulo}
        {obrigatorio && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * Arquivos já enviados. O bucket é privado, então cada arquivo abre por URL
 * assinada na hora do clique. A seção aparece sempre, inclusive vazia: sumir
 * em silêncio foi o que fez parecer que o anexo tinha se perdido.
 */
export function ListaAnexos({ anexos, titulo = "Anexos" }: { anexos?: AnexoHoraExtra[] | null; titulo?: string }) {
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const lista = anexos ?? [];
  const abrir = async (id: string, caminho: string) => {
    try {
      setAbrindo(id);
      window.open(await urlAssinadaHoraExtra(caminho), "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível abrir o anexo."));
    } finally {
      setAbrindo(null);
    }
  };
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 font-bold text-[#07194b]">
        <Paperclip className="h-4 w-4" />
        {titulo}
        {!!lista.length && <span className="text-xs font-normal text-slate-500">({lista.length})</span>}
      </h3>
      {lista.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-500">
          Nenhum arquivo anexado a esta solicitação.
        </p>
      ) : (
        <div className="space-y-2">
          {lista.map((anexo) => (
            <button
              key={anexo.id}
              type="button"
              disabled={abrindo === anexo.id}
              onClick={() => abrir(anexo.id, anexo.storage_path)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded border px-3 py-2",
                "text-left text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-60",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0" />
                <span className="truncate">{anexo.nome_arquivo}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                {rotuloFaseAnexo(anexo.fase)}
                <Download className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function DropzoneAnexos({
  arquivos,
  setArquivos,
  descricao,
}: {
  arquivos: File[];
  setArquivos: (arquivos: File[]) => void;
  descricao?: string;
}) {
  return (
    <div className="space-y-2">
      {descricao && <p className="-mt-2 mb-2 text-xs text-slate-500">{descricao}</p>}
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed",
          "border-blue-300 bg-white px-4 py-3 text-center hover:bg-blue-50/40",
        )}
      >
        <UploadCloud className="mb-1 h-6 w-6 text-blue-700" />
        <span className="text-xs text-slate-600">Clique para anexar arquivos ou arraste para cá</span>
        <span className="text-[11px] text-slate-500">PNG, JPG, PDF (máx. 10MB)</span>
        <input
          type="file"
          multiple
          className="hidden"
          accept="image/png,image/jpeg,application/pdf"
          onChange={(e) => {
            const novos = Array.from(e.target.files ?? []).filter((f) => f.size <= 10485760);
            setArquivos([...arquivos, ...novos]);
            e.target.value = "";
          }}
        />
      </label>
      {arquivos.map((arquivo, indice) => (
        <div
          key={`${arquivo.name}-${indice}`}
          className="flex items-center justify-between rounded border px-2.5 py-1 text-xs"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="truncate">{arquivo.name}</span>
          </span>
          <button type="button" onClick={() => setArquivos(arquivos.filter((_, i) => i !== indice))}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function CartaoMetrica({
  icone,
  valor,
  titulo,
  detalhe,
  tom = "azul",
}: {
  icone: ReactNode;
  valor: ReactNode;
  titulo: string;
  detalhe?: ReactNode;
  tom?: "azul" | "ambar" | "verde";
}) {
  const tons = {
    azul: "bg-blue-50 text-blue-600",
    ambar: "bg-amber-50 text-amber-600",
    verde: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div
      className={cn(
        "flex min-h-[82px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3",
        tom === "ambar" && "bg-amber-50/50",
      )}
    >
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tons[tom])}>{icone}</span>
      <div>
        <div className="text-2xl font-extrabold text-[#07194b]">{valor}</div>
        <div className="text-xs font-medium text-slate-600">{titulo}</div>
        {detalhe && <div className="mt-1 text-[11px]">{detalhe}</div>}
      </div>
    </div>
  );
}

/**
 * Caixa verde do formulário. Mostra só a hora extra — o que passou da
 * jornada da escala —, com o total trabalhado embaixo para o usuário
 * conferir de onde saiu a conta.
 */
export function TotalHoras({ minutos, trabalhado }: { minutos: number; trabalhado?: number }) {
  return (
    <div className="flex h-full min-h-[92px] flex-col justify-center rounded-lg bg-emerald-50 px-5">
      <span className="text-xs font-semibold text-emerald-700">Total de hora extra</span>
      <strong className="mt-1 text-2xl text-emerald-800">{formatarDuracao(minutos)}</strong>
      {trabalhado != null && (
        <span className="mt-1 text-[11px] text-emerald-700">Trabalhado no dia: {formatarDuracao(trabalhado, true)}</span>
      )}
    </div>
  );
}

export function PaginacaoHoraExtra({
  pagina,
  total,
  porPagina,
  aoMudarPagina,
  aoMudarPorPagina,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  aoMudarPagina: (pagina: number) => void;
  aoMudarPorPagina: (quantidade: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total ? (pagina - 1) * porPagina + 1 : 0;
  const fim = Math.min(total, pagina * porPagina);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-slate-200",
        "px-3 py-4 text-xs text-slate-500",
      )}
    >
      <span>
        Mostrando {inicio} a {fim} de {total} registros
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={pagina === 1}
          onClick={() => aoMudarPagina(pagina - 1)}
          className="h-8 rounded border px-3 disabled:opacity-40"
        >
          ‹
        </button>
        {Array.from({ length: Math.min(paginas, 5) }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => aoMudarPagina(p)}
            className={cn("h-8 min-w-8 rounded border", p === pagina && "border-orange-500 bg-orange-500 text-white")}
          >
            {p}
          </button>
        ))}
        {paginas > 5 && <span className="px-1">… {paginas}</span>}
        <button
          disabled={pagina === paginas}
          onClick={() => aoMudarPagina(pagina + 1)}
          className="h-8 rounded border px-3 disabled:opacity-40"
        >
          ›
        </button>
      </div>
      <label className="flex items-center gap-2">
        Registros por página
        <select
          value={porPagina}
          onChange={(e) => aoMudarPorPagina(Number(e.target.value))}
          className="h-8 rounded border bg-white px-2"
        >
          <option>10</option>
          <option>25</option>
          <option>50</option>
        </select>
      </label>
    </div>
  );
}
