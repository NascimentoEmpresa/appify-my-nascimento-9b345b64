import { useMemo } from "react";
import { KeyRound } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { cn } from "@/lib/utils";
import { exigeAcessoModulo, normalizarPessoasAcesso, pessoasDosIds, type PessoaAcesso } from "@/lib/chamados/acessoModulo";
import { useUsuariosAtivos } from "./StatusValidacao";

// =====================================================================
// "QUAIS PESSOAS DEVEM TER ACESSO AO MÓDULO?" (SIS-2026-0934).
// Campo da abertura e leitura no chamado. Regra (quando é obrigatório) em
// lib/chamados/acessoModulo.ts; o banco confere de novo no gatilho da
// mig 20261118100000. A escolha é de logins de verdade (listar_usuarios_ativos,
// a mesma base do "Adicionar participante"), não texto livre: o dev libera
// em Acesso por Usuário procurando por essas pessoas.
// =====================================================================

export function AcessoModuloCampo({ categorias, value, onChange }: {
  categorias: readonly string[];
  value: PessoaAcesso[];
  onChange: (v: PessoaAcesso[]) => void;
}) {
  const { data: usuarios = [], isLoading } = useUsuariosAtivos();
  const obrigatorio = exigeAcessoModulo(categorias);

  const opcoes = useMemo(() => {
    const o = usuarios.map((u) => ({ value: u.id, label: u.display_name, hint: u.setor ?? undefined }));
    // Quem veio de um chamado anterior ("baseado nesse") e não está mais ativo continua aparecendo.
    const conhecidos = new Set(o.map((x) => x.value));
    value.filter((p) => !conhecidos.has(p.id)).forEach((p) => o.push({ value: p.id, label: p.nome || "Sem nome", hint: undefined }));
    return o;
  }, [usuarios, value]);

  const nomesConhecidos = useMemo(
    () => [...usuarios, ...value.map((p) => ({ id: p.id, display_name: p.nome, setor: null }))],
    [usuarios, value],
  );

  return (
    <div id="campo-acesso-modulo" className="scroll-mt-24">
      <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <KeyRound className="h-3.5 w-3.5 text-primary" />
        Quais pessoas devem ter acesso ao módulo?{" "}
        {obrigatorio
          ? <span className="text-destructive">*</span>
          : <span className="font-normal text-muted-foreground">(opcional)</span>}
      </Label>
      <SearchableMultiSelect
        value={value.map((p) => p.id)}
        onChange={(ids) => onChange(pessoasDosIds(ids, nomesConhecidos))}
        options={opcoes}
        placeholder={isLoading ? "Carregando usuários…" : "Selecionar pessoas"}
        searchPlaceholder="Buscar por nome ou setor…"
        emptyLabel="Ninguém encontrado"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        {obrigatorio
          ? "Obrigatório para Novo módulo / tela e Acesso / Permissão: o time de Sistemas libera o acesso a essas pessoas."
          : "Obrigatório só nas categorias Novo módulo / tela e Acesso / Permissão."}
      </p>
    </div>
  );
}

/** Leitura no chamado (Executar / Acompanhar). Some quando não se aplica e ninguém foi informado. */
export function AcessoModuloResumo({ chamado, className }: {
  chamado: { categorias?: string[] | null; acesso_modulo_usuarios?: PessoaAcesso[] | null };
  className?: string;
}) {
  const pessoas = normalizarPessoasAcesso(chamado.acesso_modulo_usuarios);
  if (!pessoas.length && !exigeAcessoModulo(chamado.categorias)) return null;
  return (
    <div className={cn("space-y-2 rounded-lg border border-border p-3", className)}>
      <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
        <KeyRound className="h-3.5 w-3.5 text-primary" /> Pessoas que devem ter acesso ao módulo
        {pessoas.length > 0 && <span className="font-normal text-muted-foreground">({pessoas.length})</span>}
      </p>
      {pessoas.length
        ? (
          <div className="flex flex-wrap gap-1">
            {pessoas.map((p) => (
              <span key={p.id} className="inline-flex items-center rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-foreground">
                {p.nome || "Sem nome"}
              </span>
            ))}
          </div>
        )
        : <span className="text-xs text-muted-foreground">Não informado (chamado aberto antes do campo existir)</span>}
    </div>
  );
}
