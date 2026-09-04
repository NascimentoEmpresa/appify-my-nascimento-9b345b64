import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, MapPin, Pencil, Search, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TiAtivo, TiPlanta } from "@/hooks/useTiMapa";
import { STATUS_ATIVO, TIPOS_ATIVO, statusAtivo, tipoAtivo } from "./catalogo";

/**
 * Inventário — a mesma base do mapa, vista como lista.
 *
 * Existe porque mapa responde "onde está" e lista responde "quantos, de que
 * tipo, de quem, com qual IP". Quem faz o inventário anual precisa da
 * segunda pergunta, e ler isso arrastando o zoom num desenho seria cruel.
 */

interface Props {
  ativos: TiAtivo[];
  plantas: TiPlanta[];
  onAbrir: (id: string) => void;
  onIrParaMapa: (a: TiAtivo) => void;
}

type Ordenacao = "codigo" | "nome" | "tipo" | "status" | "responsavel" | "atualizado";

export function Inventario({ ativos, plantas, onAbrir, onIrParaMapa }: Props) {
  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("todos");
  const [fStatus, setFStatus] = useState("todos");
  const [fPlanta, setFPlanta] = useState("todas");
  const [ordem, setOrdem] = useState<Ordenacao>("codigo");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = ativos.filter((a) => {
      if (fTipo !== "todos" && a.tipo !== fTipo) return false;
      if (fStatus !== "todos" && a.status !== fStatus) return false;
      if (fPlanta === "sem_planta" && a.planta_id) return false;
      if (fPlanta !== "todas" && fPlanta !== "sem_planta" && a.planta_id !== fPlanta) return false;
      if (!termo) return true;
      return [a.nome, a.codigo, a.patrimonio, a.ip, a.hostname, a.responsavel_nome, a.setor, a.marca, a.modelo, a.numero_serie]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });

    const chave = (a: TiAtivo) => {
      switch (ordem) {
        case "nome": return a.nome ?? "";
        case "tipo": return tipoAtivo(a.tipo).label;
        case "status": return a.status ?? "";
        case "responsavel": return a.responsavel_nome ?? "zzz";
        case "atualizado": return a.updated_at ?? "";
        default: return a.codigo ?? "";
      }
    };
    return [...lista].sort((x, y) =>
      ordem === "atualizado" ? chave(y).localeCompare(chave(x)) : chave(x).localeCompare(chave(y)),
    );
  }, [ativos, busca, fTipo, fStatus, fPlanta, ordem]);

  const exportar = () => {
    const linhas = filtrados.map((a) => ({
      Código: a.codigo ?? "",
      Patrimônio: a.patrimonio ?? "",
      Nome: a.nome,
      Tipo: tipoAtivo(a.tipo).label,
      Status: statusAtivo(a.status).label,
      Marca: a.marca ?? "",
      Modelo: a.modelo ?? "",
      "Nº de série": a.numero_serie ?? "",
      Processador: a.cpu ?? "",
      "Memória (GB)": a.ram_gb ?? "",
      "Disco (GB)": a.armazenamento_gb ?? "",
      "Sistema operacional": a.sistema_operacional ?? "",
      IP: a.ip ?? "",
      "IP tipo": a.ip_tipo ?? "",
      MAC: a.mac ?? "",
      Responsável: a.responsavel_nome ?? "",
      Setor: a.setor ?? "",
      Planta: plantas.find((p) => p.id === a.planta_id)?.nome ?? "",
      "Aquisição": a.data_aquisicao ?? "",
      "Valor (R$)": a.valor_aquisicao ?? "",
      "Garantia até": a.garantia_ate ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventário T.I");
    XLSX.writeFile(wb, `inventario_ti_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, código, IP, patrimônio, responsável…"
            className="pl-8"
          />
        </div>
        <Select value={fTipo} onValueChange={setFTipo}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {TIPOS_ATIVO.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {STATUS_ATIVO.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fPlanta} onValueChange={setFPlanta}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as plantas</SelectItem>
            <SelectItem value="sem_planta">Fora do mapa</SelectItem>
            {plantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportar}>
          <Download className="mr-1.5 h-4 w-4" /> Excel
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtrados.length} de {ativos.length} equipamentos
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <Cabecalho label="Código" campo="codigo" ordem={ordem} setOrdem={setOrdem} />
              <Cabecalho label="Equipamento" campo="nome" ordem={ordem} setOrdem={setOrdem} />
              <Cabecalho label="Tipo" campo="tipo" ordem={ordem} setOrdem={setOrdem} />
              <Cabecalho label="Status" campo="status" ordem={ordem} setOrdem={setOrdem} />
              <TableHead>Configuração</TableHead>
              <TableHead>Rede</TableHead>
              <Cabecalho label="Responsável" campo="responsavel" ordem={ordem} setOrdem={setOrdem} />
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map((a) => {
              const def = tipoAtivo(a.tipo);
              const st = statusAtivo(a.status);
              const Icone = def.icone;
              return (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => onAbrir(a.id)}>
                  <TableCell className="font-mono text-xs">{a.codigo ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white"
                        style={{ background: a.cor || def.cor }}
                      >
                        <Icone className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.nome}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {[a.marca, a.modelo].filter(Boolean).join(" ") || a.patrimonio || "—"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{def.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-0 text-white" style={{ background: st.cor }}>
                      {st.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                    <span className="block truncate">
                      {[a.cpu, a.ram_gb ? `${a.ram_gb} GB` : null, a.armazenamento_gb ? `${a.armazenamento_gb} GB ${a.armazenamento_tipo ?? ""}`.trim() : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                    <span className="block truncate">{a.sistema_operacional ?? ""}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.ip ? (
                      <span className="flex items-center gap-1 font-mono">
                        <Wifi className="h-3 w-3 text-emerald-500" /> {a.ip}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <WifiOff className="h-3 w-3" /> sem IP
                      </span>
                    )}
                    {a.ip_tipo && <span className="text-[11px] text-muted-foreground">{a.ip_tipo}</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block truncate">{a.responsavel_nome ?? "—"}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{a.setor ?? ""}</span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={a.planta_id ? "Ver no mapa" : "Ainda não está no mapa"}
                        disabled={!a.planta_id}
                        onClick={() => onIrParaMapa(a)}
                      >
                        <MapPin className={cn("h-4 w-4", !a.planta_id && "opacity-40")} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onAbrir(a.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                  Nenhum equipamento com esses filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Cabecalho({
  label,
  campo,
  ordem,
  setOrdem,
}: {
  label: string;
  campo: Ordenacao;
  ordem: Ordenacao;
  setOrdem: (o: Ordenacao) => void;
}) {
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => setOrdem(campo)}
        className={cn("font-medium hover:text-foreground", ordem === campo ? "text-foreground" : "text-muted-foreground")}
      >
        {label}
      </button>
    </TableHead>
  );
}
