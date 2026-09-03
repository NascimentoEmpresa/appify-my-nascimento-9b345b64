import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase, Building2, ChevronRight, FolderOpen, GitBranch, Loader2, Search,
  ShieldCheck, UserCog, UserRound, Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  agruparPorPosto, ehEncarregado, ehSupervisor, useArvoreContratos,
  useBuscaColaboradores, useColaboradoresDoContrato,
  type ColaboradorLinha, type NoContrato,
} from "@/hooks/useEspacoColaborador";

// =====================================================================
// ESPAÇO DO COLABORADOR — a árvore
//
// Abre a operação inteira em dois desenhos da MESMA estrutura:
//
//   • Fluxograma — cartões encadeados, para entender a hierarquia;
//   • Árvore de pastas — recuo e linha-guia, como um explorador de arquivos,
//     para varrer muitos nós rápido.
//
// Os dois renderizadores leem o mesmo modelo de dados e o mesmo estado de
// expansão. Trocar de modo não perde o que já estava aberto — o modo é
// aparência, não navegação, e recolher tudo a cada clique no botão seria
// punir quem só queria olhar de outro jeito.
//
// A HIERARQUIA REAL versus A DESENHADA
//
//   O processo é Contrato → Supervisor → Posto → Encarregado → Função →
//   Colaborador. No banco, Supervisor e Encarregado não são níveis: são
//   CARGOS em EMPREGADOS. A árvore então separa as duas chefias num ramo
//   próprio do contrato (derivado do cargo, ver `ehSupervisor`) e agrupa o
//   resto por Posto → Função. É o mais perto do organograma que os dados
//   permitem sem inventar vínculo.
//
// CARGA SOB DEMANDA
//
//   A estrutura de contratos vem inteira (poucos KB). As PESSOAS vêm só
//   quando o contrato é expandido: são 2.4 mil na ativa, e trazer todas para
//   mostrar as 40 de um contrato é o que trava a tela.
// =====================================================================

type Modo = "fluxograma" | "pastas";

const ROTA_FICHA = "/app/central-servicos/espaco-colaborador";

/** O link da pessoa usa a MATRÍCULA quando existe — é o mesmo identificador
 *  que o QR Code do crachá carrega, então URL colada de um lado abre igual
 *  do outro. Cai no id só para quem ainda não tem matrícula (admissão). */
const linkDaPessoa = (c: { empregado_id: number; matricula: string | null }) =>
  `${ROTA_FICHA}/${encodeURIComponent(c.matricula || String(c.empregado_id))}`;

export default function EspacoColaborador() {
  return (
    <AcessoGate
      menu="central_servicos_espaco_colaborador"
      acao="visualizar"
      fallback={
        <div className="p-6">
          <PageHeader
            title="Espaço do Colaborador"
            module="Central de Serviços"
            breadcrumb={["Espaço do Colaborador"]}
          />
          <Card className="p-6 text-sm text-muted-foreground">
            Você não tem acesso ao Espaço do Colaborador. Peça a liberação em
            Administração → Acesso por Usuário.
          </Card>
        </div>
      }
    >
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [modo, setModo] = useState<Modo>("fluxograma");
  const [termo, setTermo] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const { data: contratos = [], isLoading, error } = useArvoreContratos();
  const { data: achados = [], isFetching: buscando } = useBuscaColaboradores(termo);

  const buscaAtiva = termo.trim().length >= 2;

  const alternar = (chave: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });

  return (
    <div className="p-6">
      <PageHeader
        title="Espaço do Colaborador"
        subtitle="A operação de ponta a ponta: contrato, posto, função e as pessoas."
        module="Central de Serviços"
        breadcrumb={["Espaço do Colaborador"]}
        actions={
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            <BotaoModo atual={modo} valor="fluxograma" onClick={setModo} icone={GitBranch}>
              Fluxograma
            </BotaoModo>
            <BotaoModo atual={modo} valor="pastas" onClick={setModo} icone={FolderOpen}>
              Árvore de pastas
            </BotaoModo>
          </div>
        }
      />

      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar colaborador pelo nome (2 letras ou mais)…"
          className="pl-9"
        />
        {buscando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {buscaAtiva ? (
        <ResultadoBusca termo={termo} pessoas={achados} carregando={buscando} />
      ) : isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando a árvore…
        </Card>
      ) : error ? (
        <Card className="p-6 text-sm text-destructive">
          Não foi possível carregar a árvore: {(error as Error).message}
        </Card>
      ) : contratos.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum contrato ativo para mostrar.
        </Card>
      ) : (
        <div className={cn(modo === "fluxograma" ? "space-y-4" : "space-y-1")}>
          {contratos.map((c) => (
            <NoDeContrato
              key={c.id}
              contrato={c}
              modo={modo}
              aberto={abertos.has(c.id)}
              abertos={abertos}
              onAlternar={alternar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BotaoModo({
  atual, valor, onClick, icone: Icone, children,
}: {
  atual: Modo; valor: Modo; onClick: (m: Modo) => void;
  icone: typeof GitBranch; children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={atual === valor ? "default" : "ghost"}
      className="h-8 gap-1.5 px-3"
      onClick={() => onClick(valor)}
    >
      <Icone className="h-3.5 w-3.5" />
      {children}
    </Button>
  );
}

// ── Contrato ─────────────────────────────────────────────────────────

function NoDeContrato({
  contrato, modo, aberto, abertos, onAlternar,
}: {
  contrato: NoContrato; modo: Modo; aberto: boolean;
  abertos: Set<string>; onAlternar: (chave: string) => void;
}) {
  // `aberto` é o gatilho da consulta: as pessoas do contrato só saem do banco
  // depois do primeiro clique. React Query guarda o resultado, então recolher
  // e reabrir não vai ao banco de novo.
  const { data: pessoas = [], isFetching } = useColaboradoresDoContrato(contrato.id, aberto);

  const { supervisores, encarregados, postos } = useMemo(() => {
    const supervisores = pessoas.filter((p) => ehSupervisor(p.cargo));
    const encarregados = pessoas.filter((p) => ehEncarregado(p.cargo));
    // Chefia sai do agrupamento por posto para não aparecer duas vezes na
    // mesma árvore — quem lê contaria a mesma pessoa em dois lugares.
    const chefia = new Set([...supervisores, ...encarregados].map((p) => p.empregado_id));
    return {
      supervisores,
      encarregados,
      postos: agruparPorPosto(pessoas.filter((p) => !chefia.has(p.empregado_id))),
    };
  }, [pessoas]);

  const funcoesContratadas = contrato.postos.reduce((s, p) => s + p.funcoes.length, 0);

  const cabecalho = (
    <button
      type="button"
      onClick={() => onAlternar(contrato.id)}
      className="flex w-full items-center gap-2 text-left"
    >
      <ChevronRight
        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          aberto && "rotate-90")}
      />
      <Building2 className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate font-semibold">{contrato.nome}</span>
      {contrato.cliente && (
        <span className="hidden truncate text-xs text-muted-foreground sm:block">
          {contrato.cliente}
        </span>
      )}
      <Badge variant="secondary" className="shrink-0 gap-1">
        <Users className="h-3 w-3" />
        {contrato.colaboradores}
      </Badge>
      {contrato.postos.length > 0 && (
        <Badge variant="outline" className="hidden shrink-0 md:inline-flex">
          {contrato.postos.length} postos · {funcoesContratadas} funções
        </Badge>
      )}
      {isFetching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </button>
  );

  const corpo = aberto && (
    <div className={cn(modo === "fluxograma" ? "mt-3 space-y-3" : "mt-1")}>
      {isFetching && pessoas.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Carregando colaboradores…</p>
      ) : pessoas.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          Nenhum colaborador ativo casado com este contrato. O vínculo é feito por
          “Nome Filial”; divergências de grafia são resolvidas no de-para do RH.
        </p>
      ) : (
        <>
          <RamoDeChefia
            titulo="Supervisores"
            icone={ShieldCheck}
            pessoas={supervisores}
            modo={modo}
            vazio="Nenhum cargo de supervisão neste contrato."
          />
          <RamoDeChefia
            titulo="Encarregados"
            icone={UserCog}
            pessoas={encarregados}
            modo={modo}
            vazio="Nenhum cargo de encarregado neste contrato."
          />
          {postos.map((g) => {
            const chave = `${contrato.id}:${g.posto}`;
            return (
              <NoDePosto
                key={chave}
                chave={chave}
                grupo={g}
                modo={modo}
                abertos={abertos}
                onAlternar={onAlternar}
              />
            );
          })}
        </>
      )}
    </div>
  );

  if (modo === "pastas") {
    return (
      <div className="text-sm">
        <div className="rounded px-2 py-1.5 hover:bg-muted/50">{cabecalho}</div>
        {corpo && <div className="ml-4 border-l pl-3">{corpo}</div>}
      </div>
    );
  }

  return (
    <Card className="p-4">
      {cabecalho}
      {corpo}
    </Card>
  );
}

// ── Supervisores / Encarregados ──────────────────────────────────────

function RamoDeChefia({
  titulo, icone: Icone, pessoas, modo, vazio,
}: {
  titulo: string; icone: typeof ShieldCheck; pessoas: ColaboradorLinha[];
  modo: Modo; vazio: string;
}) {
  return (
    <div className={cn(modo === "fluxograma" && "rounded-lg border bg-muted/30 p-3")}>
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        {titulo}
        <Badge variant="outline" className="ml-1 h-4 px-1.5 text-[10px]">
          {pessoas.length}
        </Badge>
      </div>
      {pessoas.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <div className={cn(modo === "fluxograma" ? "flex flex-wrap gap-2 px-2 pt-1" : "ml-4 border-l pl-3")}>
          {pessoas.map((p) => (
            <PessoaLink key={p.empregado_id} pessoa={p} modo={modo} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Posto → Função → Pessoas ─────────────────────────────────────────

function NoDePosto({
  chave, grupo, modo, abertos, onAlternar,
}: {
  chave: string;
  grupo: ReturnType<typeof agruparPorPosto>[number];
  modo: Modo;
  abertos: Set<string>;
  onAlternar: (chave: string) => void;
}) {
  const aberto = abertos.has(chave);

  return (
    <div className={cn(modo === "fluxograma" && "rounded-lg border p-3")}>
      <button
        type="button"
        onClick={() => onAlternar(chave)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            aberto && "rotate-90")}
        />
        <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{grupo.posto}</span>
        <Badge variant="secondary" className="shrink-0 h-5 px-1.5 text-[10px]">
          {grupo.total}
        </Badge>
      </button>

      {aberto && (
        <div className={cn(modo === "fluxograma" ? "mt-2 space-y-2 pl-6" : "ml-4 border-l pl-3")}>
          {grupo.funcoes.map((f) => (
            <div key={f.funcao}>
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <span className="truncate font-medium">{f.funcao}</span>
                <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
                  {f.pessoas.length}
                </Badge>
              </div>
              <div className={cn(modo === "fluxograma" ? "flex flex-wrap gap-2 px-2" : "ml-4 border-l pl-3")}>
                {f.pessoas.map((p) => (
                  <PessoaLink key={p.empregado_id} pessoa={p} modo={modo} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── A folha da árvore: a pessoa ──────────────────────────────────────

function PessoaLink({ pessoa, modo }: { pessoa: ColaboradorLinha; modo: Modo }) {
  if (modo === "pastas") {
    return (
      <Link
        to={linkDaPessoa(pessoa)}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60 hover:underline"
      >
        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{pessoa.nome}</span>
        {pessoa.matricula && (
          <span className="shrink-0 text-[11px] text-muted-foreground">#{pessoa.matricula}</span>
        )}
      </Link>
    );
  }

  return (
    <Link
      to={linkDaPessoa(pessoa)}
      className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs transition-colors hover:border-primary hover:bg-primary/5"
    >
      <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{pessoa.nome}</span>
      {pessoa.matricula && (
        <span className="shrink-0 text-[10px] text-muted-foreground">#{pessoa.matricula}</span>
      )}
    </Link>
  );
}

// ── Busca ────────────────────────────────────────────────────────────

function ResultadoBusca({
  termo, pessoas, carregando,
}: {
  termo: string; pessoas: ColaboradorLinha[]; carregando: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-muted-foreground">
        {carregando
          ? "Buscando…"
          : `${pessoas.length} resultado(s) para “${termo.trim()}”`}
      </p>
      {pessoas.length === 0 && !carregando ? (
        <p className="text-sm text-muted-foreground">Ninguém encontrado com esse nome.</p>
      ) : (
        <div className="divide-y">
          {pessoas.map((p) => (
            <Link
              key={p.empregado_id}
              to={linkDaPessoa(p)}
              className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-muted/50"
            >
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
                {p.cargo ?? "—"}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
                {p.filial ?? "—"}
              </span>
              {p.matricula && (
                <Badge variant="outline" className="shrink-0">#{p.matricula}</Badge>
              )}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
