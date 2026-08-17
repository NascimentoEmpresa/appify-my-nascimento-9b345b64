import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { ModalManutencao } from "@/components/suprimentos/ModalManutencao";
import { useBens, type Bem } from "@/hooks/useSupPatrimonio";
import { fmtDataBR } from "@/hooks/useSupPedidos";
import {
  Search, Car, Wrench, Download, ArrowLeft, CheckCircle2, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

/**
 * Painel de Manutenções — o que está parado agora.
 *
 * Diferente da tela de Patrimônio, aqui NÃO há agrupamento (§9.4): é uma
 * grade plana, ordenada por nome, misturando veículos e máquinas. Quem abre
 * esta tela quer ver a lista do que está parado, não navegar por contrato.
 */
export default function PainelManutencoes() {
  const { data: empresaId } = useEmpresaId();
  const { data: bens = [], isLoading, error } = useBens(empresaId ?? null);
  const [busca, setBusca] = useState("");
  const [abrindo, setAbrindo] = useState<Bem | null>(null);

  // Só manutenção de verdade. `em_manutencao` passou a significar
  // INDISPONÍVEL, e bem alocado a contrato entraria aqui sem ter oficina,
  // custo nem previsão de conserto — poluindo justamente o painel que existe
  // para acompanhar conserto. Registro antigo não tem motivo: era manutenção.
  const emManutencao = useMemo(
    () => bens.filter((b) => b.em_manutencao && (b.motivo_indisponivel ?? "manutencao") === "manutencao")
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [bens],
  );

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return emManutencao;
    return emManutencao.filter((b) =>
      [b.nome, b.identificador, b.contrato?.nome, b.posto?.nome, b.lotacao,
       fmtDataBR(b.data_inicio_manutencao), fmtDataBR(b.data_previsao_fim)]
        .filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [emManutencao, busca]);

  const chips = useMemo(() => ({
    veiculos: filtrados.filter((b) => b.categoria === "veiculo").length,
    equipamentos: filtrados.filter((b) => b.categoria === "equipamento").length,
  }), [filtrados]);

  const exportar = () => {
    const linhas = filtrados.map((b) => ({
      Nome: b.nome,
      Identificador: b.identificador ?? "",
      Tipo: b.categoria === "veiculo" ? "Veículos" : "Máquinas/Equipamentos",
      Contrato: b.contrato?.nome ?? "Administrativo / Sede",
      Posto: b.posto?.nome ?? b.lotacao ?? "",
      Status: "Em Manutenção",
      "Data Início": fmtDataBR(b.data_inicio_manutencao),
      "Previsão de Fim": fmtDataBR(b.data_previsao_fim),
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Manutenções");
    const d = new Date();
    const hoje = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    XLSX.writeFile(wb, `painel-manutencoes-${hoje}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel de Manutenções"
        subtitle="Veículos e equipamentos parados neste momento."
        module="Suprimentos"
        breadcrumb={["Patrimônio", "Manutenções"]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/suprimentos/patrimonio">
                <ArrowLeft className="mr-2 h-4 w-4" /> Patrimônio
              </Link>
            </Button>
            <Button variant="outline" onClick={exportar} disabled={filtrados.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Exportar Excel
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[18rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)}
                 placeholder="Pesquisar por nome, identificador, contrato, posto, data…" className="pl-9" />
        </div>
        <Badge variant="outline" className="gap-1 border-orange-400/50 text-orange-700 dark:text-orange-300">
          <Car className="h-3.5 w-3.5" /> {chips.veiculos} veículos
        </Badge>
        <Badge variant="outline" className="gap-1 border-emerald-400/50 text-emerald-700 dark:text-emerald-300">
          <Wrench className="h-3.5 w-3.5" /> {chips.equipamentos} equipamentos
        </Badge>
        <Badge variant="secondary">
          {/* Com busca ativa o total vira "N de M", como no legado. */}
          Total: {busca.trim()
            ? `${filtrados.length} de ${emManutencao.length}`
            : `${emManutencao.length} em manutenção`}
        </Badge>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar o painel.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        /* Dois estados vazios diferentes (§9.4). "Nada em manutenção" é uma
           BOA NOTÍCIA e é apresentada como tal; busca sem resultado é um beco
           sem saída e oferece a saída. */
        busca.trim() ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Search className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-medium">Nenhum resultado para "{busca}"</p>
            <p className="text-sm text-muted-foreground">Tente outro termo de busca.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="font-medium">Nenhum item em manutenção no momento!</p>
            <p className="text-sm text-muted-foreground">
              Todos os veículos e equipamentos estão disponíveis.
            </p>
          </div>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtrados.map((b) => <CardManutencao key={b.id} bem={b} onAbrir={() => setAbrindo(b)} />)}
        </div>
      )}

      <ModalManutencao bem={abrindo} onFechar={() => setAbrindo(null)} />
    </div>
  );
}

function CardManutencao({ bem: b, onAbrir }: { bem: Bem; onAbrir: () => void }) {
  const Icone = b.categoria === "veiculo" ? Car : Wrench;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex flex-col overflow-hidden rounded-lg border text-left transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-2 bg-amber-100/70 px-3 py-2 dark:bg-amber-950/40">
        <Icone className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold">{b.nome}</p>
          {b.identificador && (
            <p className="line-clamp-1 font-mono text-[11px] text-muted-foreground">{b.identificador}</p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 text-center text-xs">
        <span className="text-muted-foreground">
          {b.categoria === "veiculo" ? "Veículos" : "Máquinas/Equipamentos"}
        </span>
        <span className="line-clamp-2 font-medium">
          {b.contrato?.nome ?? "Administrativo / Sede"}
        </span>
        <span className="line-clamp-1 text-muted-foreground">
          {b.posto?.nome ?? b.lotacao ?? "—"}
        </span>
        <Badge variant="outline"
               className={cn("mx-auto mt-1 border-amber-400/60 text-[10px] uppercase text-amber-700 dark:text-amber-300")}>
          em manutenção
        </Badge>
        <span className="mt-1 text-muted-foreground">
          {fmtDataBR(b.data_inicio_manutencao)} — {fmtDataBR(b.data_previsao_fim)}
        </span>
      </div>
    </button>
  );
}
