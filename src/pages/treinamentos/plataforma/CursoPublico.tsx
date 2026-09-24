import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Briefcase, Building2, Globe, Search, UserPlus, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MENU } from "./tipos";

// =====================================================================
// TREINAMENTOS — "Quem vê este curso" (24/09/2026).
//
// Publicar deixou de liberar para todo mundo (mig 20260930000231). O curso
// aparece no Portal do Colaborador para quem casar com UMA destas formas:
//   · Liberado para todos — marcado aqui, explícito;
//   · Regra de CONTRATO e/ou CARGO — dinâmica: quem for admitido depois
//     naquele contrato/cargo já vê, sem cadastrar a pessoa de novo;
//   · Pessoa específica — a matrícula (TRN_MATRICULA).
// Contratos/cargos oferecidos são os de quem está Trabalhando.
// =====================================================================

const sb = supabase as any;

interface Regra { id: string; contrato: string | null; cargo: string | null; ativos: number }
interface Individual { matricula_id: string; aluno_id: string; nome: string; contrato: string | null; cargo: string | null; status: string }
interface Publico { liberado_para_todos: boolean; regras: Regra[]; individuais: Individual[]; alcance: number }
interface Opcao { nome: string; ativos: number }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function ListaEscolha({ titulo, icone: Icone, opcoes, valor, onEscolher }: {
  titulo: string; icone: typeof Building2; opcoes: Opcao[]; valor: string; onEscolher: (v: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const vis = useMemo(() => {
    const b = norm(busca.trim());
    return (b ? opcoes.filter((o) => norm(o.nome).includes(b)) : opcoes).slice(0, 200);
  }, [busca, opcoes]);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-600"><Icone className="h-3.5 w-3.5" /> {titulo}</div>
      {valor ? (
        <div className="flex items-center gap-2 rounded-md border bg-primary/10 px-2 py-1.5 text-xs font-semibold">
          <span className="flex-1">{valor}</span>
          <button type="button" onClick={() => onEscolher("")} aria-label={`Limpar ${titulo}`} className="text-slate-500 hover:text-slate-900"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <>
          <Input className="h-8 text-xs" placeholder={`Buscar ${titulo.toLowerCase()}…`} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border p-1">
            {opcoes.length === 0 && <div className="p-2 text-xs text-muted-foreground">Carregando…</div>}
            {opcoes.length > 0 && vis.length === 0 && <div className="p-2 text-xs text-muted-foreground">Nada encontrado.</div>}
            {vis.map((o) => (
              <button type="button" key={o.nome} onClick={() => { onEscolher(o.nome); setBusca(""); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted">
                <span className="flex-1">{o.nome}</span>
                <span className="text-muted-foreground">{o.ativos} ativo(s)</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function CursoPublico({ cursoId, publicado }: { cursoId: string; publicado: boolean }) {
  const qc = useQueryClient();
  const chave = ["trn-curso-publico", cursoId];
  const { data, isLoading } = useQuery({
    queryKey: chave,
    queryFn: async (): Promise<Publico> => {
      const { data, error } = await sb.rpc("trn_curso_publico", { _curso: cursoId });
      if (error) throw error;
      return data as Publico;
    },
  });
  const [editando, setEditando] = useState(false);
  const { data: opcoes } = useQuery({
    queryKey: ["trn-liberacao-opcoes"],
    enabled: editando,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ contratos: Opcao[]; cargos: Opcao[] }> => {
      const { data, error } = await sb.rpc("trn_liberacao_opcoes");
      if (error) throw error;
      return data;
    },
  });
  const [contrato, setContrato] = useState("");
  const [cargo, setCargo] = useState("");
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: pessoas = [] } = useQuery({
    queryKey: ["trn-busca-aluno", buscaPessoa.trim()],
    enabled: editando && buscaPessoa.trim().length >= 3,
    queryFn: async () => {
      const b = buscaPessoa.trim();
      const dig = b.replace(/\D/g, "");
      let q = sb.from("TRN_ALUNO").select("id, nome, contrato, cargo, status").order("nome").limit(15);
      q = dig.length >= 5 && dig.length === b.replace(/[.\-\s]/g, "").length ? q.ilike("documento", `%${dig}%`) : q.ilike("nome", `%${b}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; contrato: string | null; cargo: string | null; status: string }[];
    },
  });

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: chave });
    qc.invalidateQueries({ queryKey: ["trn-cursos"] });
    qc.invalidateQueries({ queryKey: ["trn-curso", cursoId] });
  };
  const rodar = async (fn: () => Promise<{ error: any }>, ok: string) => {
    setSalvando(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      toast.success(ok);
      recarregar();
    } catch (e: any) {
      toast.error(e?.code === "23505" ? "Essa liberação já existe." : e?.message ?? "Não deu para salvar.");
    } finally { setSalvando(false); }
  };

  const liberarRegra = () => {
    if (!contrato && !cargo) return toast.error("Escolha um contrato, um cargo ou os dois.");
    rodar(() => sb.from("TRN_CURSO_LIBERACAO").insert({ curso_id: cursoId, contrato: contrato || null, cargo: cargo || null }),
      "Liberação adicionada.").then(() => { setContrato(""); setCargo(""); });
  };

  const jaIndividual = new Set((data?.individuais ?? []).map((i) => i.aluno_id));

  return (
    <div className="mt-5 rounded-2xl border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Quem vê este curso</div>
          <div className="text-sm font-bold text-slate-900">
            {isLoading ? "Carregando…" : data?.liberado_para_todos ? "Todos os colaboradores" : `${data?.alcance ?? 0} colaborador(es) veem hoje`}
          </div>
        </div>
        <AcessoGate menu={MENU.cursos} acao="alterar">
          <Button variant="outline" size="sm" onClick={() => setEditando((v) => !v)}>{editando ? "Fechar" : "Gerenciar liberação"}</Button>
        </AcessoGate>
      </div>

      {publicado && data && !data.liberado_para_todos && data.alcance === 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          O curso está publicado, mas ainda não foi liberado para ninguém. Libere por contrato, cargo ou pessoa.
        </div>
      )}
      {!publicado && (
        <div className="mt-3 text-xs text-slate-500">Rascunho: a liberação vale a partir do momento em que o curso for publicado.</div>
      )}

      {data && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.liberado_para_todos && <span className="trn-badge info"><Globe className="mr-1 h-3 w-3" /> Liberado para todos</span>}
          {data.regras.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs">
              {r.contrato && <><Building2 className="h-3 w-3 text-slate-500" /> {r.contrato}</>}
              {r.contrato && r.cargo && <span className="text-slate-400">·</span>}
              {r.cargo && <><Briefcase className="h-3 w-3 text-slate-500" /> {r.cargo}</>}
              <span className="text-slate-400">({r.ativos} ativo{r.ativos === 1 ? "" : "s"})</span>
              {editando && (
                <button type="button" disabled={salvando} aria-label="Remover liberação" className="text-slate-400 hover:text-rose-600"
                  onClick={() => rodar(() => sb.from("TRN_CURSO_LIBERACAO").delete().eq("id", r.id), "Liberação removida.")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
          {data.individuais.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs">
              <Users className="h-3 w-3 text-slate-500" /> {data.individuais.length} pessoa(s) específica(s)
            </span>
          )}
          {!data.liberado_para_todos && data.regras.length === 0 && data.individuais.length === 0 && (
            <span className="text-xs text-slate-500">Nenhuma liberação ainda.</span>
          )}
        </div>
      )}

      {editando && data && (
        <div className="mt-4 space-y-5 border-t pt-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={data.liberado_para_todos} disabled={salvando}
              onCheckedChange={(v) => rodar(() => sb.from("TRN_CURSO").update({ liberado_para_todos: v }).eq("id", cursoId),
                v ? "Curso liberado para todos." : "Liberação geral desligada.")} />
            Liberar para todos os colaboradores
          </label>

          <div>
            <div className="text-xs font-bold text-slate-700">Por contrato e/ou cargo</div>
            <p className="mb-2 text-xs text-slate-500">
              Só contrato = o contrato inteiro. Só cargo = o cargo em qualquer contrato. Os dois = aquele cargo naquele contrato.
              Quem for admitido depois já recebe o curso automaticamente.
            </p>
            <div className="flex flex-col gap-3 md:flex-row">
              <ListaEscolha titulo="Contrato" icone={Building2} opcoes={opcoes?.contratos ?? []} valor={contrato} onEscolher={setContrato} />
              <ListaEscolha titulo="Cargo" icone={Briefcase} opcoes={opcoes?.cargos ?? []} valor={cargo} onEscolher={setCargo} />
            </div>
            <Button className="mt-2" size="sm" disabled={salvando || (!contrato && !cargo)} onClick={liberarRegra}>Adicionar liberação</Button>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-700">Pessoas específicas</div>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <Input className="h-8 pl-8 text-xs" placeholder="Buscar colaborador por nome ou CPF (mín. 3 letras)" value={buscaPessoa} onChange={(e) => setBuscaPessoa(e.target.value)} />
            </div>
            {buscaPessoa.trim().length >= 3 && (
              <div className="mt-1 max-h-44 overflow-y-auto rounded-md border bg-white p-1">
                {pessoas.length === 0 && <div className="p-2 text-xs text-muted-foreground">Ninguém encontrado.</div>}
                {pessoas.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted">
                    <span className="min-w-0 flex-1">
                      <b>{p.nome}</b>
                      <span className="text-muted-foreground"> · {[p.cargo, p.contrato].filter(Boolean).join(" · ") || "sem cargo/contrato"}{p.status !== "ativo" ? " · inativo" : ""}</span>
                    </span>
                    {jaIndividual.has(p.id) ? <span className="text-muted-foreground">já liberado</span> : (
                      <Button size="sm" variant="outline" className="h-7" disabled={salvando}
                        onClick={() => rodar(() => sb.from("TRN_MATRICULA").insert({ aluno_id: p.id, curso_id: cursoId, origem: "manual" }), `${p.nome} liberado(a).`)}>
                        <UserPlus className="mr-1 h-3.5 w-3.5" /> Liberar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {data.individuais.length > 0 && (
              <ul className="mt-2 divide-y rounded-md border bg-white">
                {data.individuais.map((i) => (
                  <li key={i.matricula_id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 flex-1"><b>{i.nome}</b><span className="text-muted-foreground"> · {[i.cargo, i.contrato].filter(Boolean).join(" · ")}</span></span>
                    <button type="button" disabled={salvando} aria-label={`Tirar ${i.nome}`} className="text-slate-400 hover:text-rose-600"
                      onClick={() => rodar(() => sb.from("TRN_MATRICULA").delete().eq("id", i.matricula_id), "Pessoa removida do curso.")}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
