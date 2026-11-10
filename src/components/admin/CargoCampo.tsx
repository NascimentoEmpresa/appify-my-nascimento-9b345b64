import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Plus } from "lucide-react";
import {
  NIVEIS_CARGO, limparNomeCargo, rotuloNivelCargo, sugerirNivelPorCargo, type NivelCargo,
} from "@/lib/acessoPorSetorCargo";

// "CARGO_CATALOGO" é de 10/11/2026 (SIS-2026-0851) — o types.ts não a conhece.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface CargoCatalogo { nome: string; nivel: NivelCargo }

/**
 * Catálogo de cargos (Configurações do ERP › Cargos). `disponivel = false`
 * quando a tabela ainda não existe no banco — a tela nova pode entrar no ar
 * antes de a migration aplicar (ou ela pode ficar pendente por lock), e o
 * cadastro de usuário não pode parar por isso: o campo volta a ser texto.
 */
export function useCargoCatalogo() {
  const q = useQuery({
    queryKey: ["cargo_catalogo"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.from("CARGO_CATALOGO").select("nome,nivel").order("nome");
      if (error) throw error;
      return (data ?? []) as CargoCatalogo[];
    },
  });
  return { cargos: q.data ?? [], disponivel: !q.isError, carregando: q.isLoading };
}

// <select> nativo de propósito, como em PosicaoCampos: abre dentro do modal
// sem portal, e o navegador já pula para o cargo ao digitar a primeira letra.
const CLASSE_SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/**
 * Campo Cargo do cadastro de usuário (SIS-2026-0851): escolhe da lista, nunca
 * digita. Quem pode gerenciar cadastra um cargo novo ali mesmo (nome + nível).
 * Um valor que não está na lista (ex.: o título que veio do cadastro da
 * Senior) aparece com aviso e o atalho para cadastrá-lo.
 */
export function CargoCampo({ value, onChange, podeCriar }: {
  value: string;
  onChange: (cargo: string) => void;
  podeCriar: boolean;
}) {
  const qc = useQueryClient();
  const { cargos, disponivel, carregando } = useCargoCatalogo();
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoNivel, setNovoNivel] = useState<NivelCargo>("adm");
  const [salvando, setSalvando] = useState(false);

  const limpo = limparNomeCargo(value);
  const naLista = !!limpo && cargos.some((c) => c.nome === limpo);
  const atual = cargos.find((c) => c.nome === limpo);

  // O valor vindo de fora em grafia diferente (ex.: "Encarregado
  // Administrativa" do cadastro do RH) casa com o cargo limpo da lista.
  useEffect(() => {
    if (limpo && naLista && limpo !== value) onChange(limpo);
  }, [limpo, naLista, value, onChange]);

  const abrirNovo = (nome: string) => {
    const n = limparNomeCargo(nome) ?? "";
    setNovoNome(n);
    setNovoNivel(sugerirNivelPorCargo(n));
    setCriando(true);
  };

  const cadastrar = async () => {
    const nome = limparNomeCargo(novoNome);
    if (!nome) return;
    setSalvando(true);
    try {
      const { error } = await sb.from("CARGO_CATALOGO").insert({ nome, nivel: novoNivel });
      if (error && error.code !== "23505") throw error;
      await qc.invalidateQueries({ queryKey: ["cargo_catalogo"] });
      onChange(nome);
      setCriando(false);
      toast({ title: error ? "Esse cargo já existia — selecionado" : "Cargo cadastrado" });
    } catch (e) {
      toast({ title: "Erro ao cadastrar o cargo", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  if (!disponivel) {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ex.: Analista Financeiro II" />;
  }

  return (
    <div className="space-y-1.5">
      <select
        className={CLASSE_SELECT}
        value={naLista ? limpo! : ""}
        disabled={carregando}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{carregando ? "Carregando cargos…" : "Escolha o cargo…"}</option>
        {cargos.map((c) => (
          <option key={c.nome} value={c.nome}>{c.nome} — {rotuloNivelCargo(c.nivel)}</option>
        ))}
      </select>

      {atual && (
        <p className="text-[11px] text-muted-foreground">
          Nível: <span className="font-medium text-foreground">{rotuloNivelCargo(atual.nivel)}</span> — usado para liberar acesso em massa por Setor / Cargo.
        </p>
      )}

      {!!limpo && !naLista && !carregando && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
          <span>
            “{value}” não está na lista de cargos. Escolha um cargo acima{podeCriar ? " ou " : "."}
            {podeCriar && (
              <button type="button" className="font-semibold underline" onClick={() => abrirNovo(value)}>cadastre “{limpo}”</button>
            )}
            {podeCriar && "."}
          </span>
        </p>
      )}

      {podeCriar && !criando && (
        <button type="button" onClick={() => abrirNovo("")} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
          <Plus className="h-3 w-3" /> Cadastrar novo cargo
        </button>
      )}

      {podeCriar && criando && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          <p className="text-xs font-semibold">Novo cargo</p>
          <Input value={novoNome} onChange={(e) => { setNovoNome(e.target.value); setNovoNivel(sugerirNivelPorCargo(e.target.value)); }} placeholder="Ex.: ANALISTA FINANCEIRO II" />
          <label className="block space-y-1 text-[11px] text-muted-foreground">
            Nível
            <select className={CLASSE_SELECT} value={novoNivel} onChange={(e) => setNovoNivel(e.target.value as NivelCargo)}>
              {NIVEIS_CARGO.map((n) => <option key={n.codigo} value={n.codigo}>{n.rotulo}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setCriando(false)} disabled={salvando}>Cancelar</Button>
            <Button type="button" size="sm" onClick={cadastrar} disabled={salvando || !limparNomeCargo(novoNome)}>
              {salvando ? "Salvando…" : "Cadastrar e usar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
