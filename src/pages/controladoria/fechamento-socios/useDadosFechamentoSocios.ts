import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { agruparFaturamento, custosPorContratoMes, ehContratoAdministrativo, mesDaDespesaNaBase, totalCustos, ehDespesaDeSocio, type BaseDespesa, type CustosPorRubrica, type LinhaFluxoCusto } from "../faturamento/regras";
import { codigosDoFiltro } from "../faturamento/FiltroCodigoNota";
import { useBaseFaturamento } from "../faturamento/useBaseFaturamento";
import { useCustosContratoAno, useDespesasAdmAno, useEntradasAdmAno } from "../faturamento/useCustosContratoMes";
import { tratamentoEfetivo, type TratamentoContrato } from "../faturamento/tratamentoContrato";
import { useTratamentosContrato } from "../faturamento/useTratamentosContrato";
import { useLigacoesRubrica } from "../faturamento/useLigacoesRubrica";
import { useAjustesAdmClassificacao, useAjustesReceitaExtra, useContratosAdmTirados } from "../fechamento/useAjustesAdm";
import {
  admPorMesRubrica, despesasDosSocios, ligacoesDoFechamento, montarFechamento, receitasExtrasPorMes, ROTULO_INVESTIMENTOS, ROTULO_OBRAS_ADM, socioDoContrato, tributosPorMes, type LinhaFechamento,
} from "../fechamento/regras";
import type { EntradaMes, LancamentoRetirada, LinhaIntegrante, SocioConfig, TipoRetirada } from "./regras";
import { donoDaLinha } from "./regras";

// SIS-2026-0872: lê do Fechamento da Empresa (mesma conta, empresa "todas" e contrato "todos") o que o Fechamento dos Sócios precisa: o resultado e os
// tributos de cada mês, a coluna de cada sócio e as linhas de Investimentos/Obras Adm com o INTEGRANTE de cada lançamento.
// A montagem das 12 linhas repete a de FechamentoEmpresa.tsx (linhasDoRecorte) para empresa/contrato "todos": se aquela conta mudar, mudar aqui também —
// por isso a tela confere as colunas Investimentos e Obras Adm (somadas por integrante) contra as do Fechamento da Empresa e avisa se divergirem.

const TODOS = "todos";
const r2 = (n: number) => Math.round(n * 100) / 100;

// Mesmas fontes que a leitura de custos do ano usa, com o integrante do lançamento.
// `integrante: false` = a view não tem (nem terá) o campo: cartão e aplicações não têm integrante; as linhas delas entram como "sem integrante" sem aviso.
const FONTES: { view: string; ordem: string[]; integrante: boolean }[] = [
  { view: "v_malote_pagamento_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"], integrante: true },
  { view: "v_debito_automatico_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"], integrante: true },
  { view: "v_cartao_fatura_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"], integrante: false },
  { view: "v_aplicacao_financeira_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"], integrante: false },
  { view: "v_aplicacao_financeira_resgate_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"], integrante: false },
  { view: "v_fluxo_caixa_importado_fluxo_caixa", ordem: ["despesa_id", "linha_id"], integrante: true },
];
const TAMANHO_PAGINA = 1000;
const TAMANHO_LOTE_CONTRATOS = 40; // o gateway limita a URL (~4 KB): os ids vão em lotes

type LinhaComIntegrante = LinhaFluxoCusto & { integrante_empregado_id?: number | null };
type Cliente = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const proximoMes = (anoMes: string) => { const [a, m] = anoMes.split("-").map(Number); return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`; };

async function lerView(view: string, ordem: string[], ids: string[], ano: number, base: BaseDespesa, comIntegrante: boolean): Promise<LinhaComIntegrante[]> {
  const de = `${ano}-01-01`;
  const ate = proximoMes(`${ano}-12`);
  const colunas = `tipo, data_pagamento, competencia, contrato_id, empresa_id, classificacao_id, classificacao_nome, valor, id_malote, descricao${comIntegrante ? ", integrante_empregado_id" : ""}`;
  const out: LinhaComIntegrante[] = [];
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE_CONTRATOS) {
    const lote = ids.slice(i, i + TAMANHO_LOTE_CONTRATOS);
    for (let pagina = 0; ; pagina++) {
      let q = (supabase as unknown as Cliente).from(view).select(colunas).eq("tipo", "saida").in("contrato_id", lote)
        .or(base === "pagamento"
          ? `and(data_pagamento.gte.${de},data_pagamento.lt.${ate})`
          : `and(competencia.gte.${de},competencia.lt.${ate}),and(competencia.is.null,data_pagamento.gte.${de},data_pagamento.lt.${ate})`);
      for (const col of ordem) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
      if (error) throw error;
      out.push(...((data ?? []) as LinhaComIntegrante[]).map((l) => ({ ...l, mes_base: mesDaDespesaNaBase(l, base) })));
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
  }
  return out;
}

/** Saídas dos contratos Investimentos/Obras Adm do ano com o integrante. View sem a coluna de integrante: as linhas vêm sem integrante (e a tela avisa). */
async function lerLinhasIntegrante(ids: string[], ano: number, base: BaseDespesa): Promise<{ linhas: LinhaComIntegrante[]; viewsSemIntegrante: string[] }> {
  if (ids.length === 0) return { linhas: [], viewsSemIntegrante: [] };
  const viewsSemIntegrante: string[] = [];
  const partes = await Promise.all(FONTES.map(async (f) => {
    const tenta = (ordem: string[], comIntegrante: boolean) => lerView(f.view, ordem, ids, ano, base, comIntegrante);
    try {
      return await tenta(f.ordem, f.integrante);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "PGRST205" || code === "42P01") return [] as LinhaComIntegrante[]; // view ainda não existe neste ambiente
      if (code === "42703") {
        // coluna ausente: ou é o integrante (view sem a coluna) ou o linha_id da importação; tenta sem o integrante e, se preciso, sem o linha_id
        viewsSemIntegrante.push(f.view);
        try {
          return await tenta(f.ordem, false);
        } catch (e2) {
          if ((e2 as { code?: string })?.code === "42703") return await tenta(["despesa_id"], false);
          throw e2;
        }
      }
      throw e;
    }
  }));
  return { linhas: partes.flat(), viewsSemIntegrante };
}

export interface DadosFechamentoSocios {
  entradas: EntradaMes[];
  projetadoPorMes: Map<string, boolean>;
  nomesSocios: string[]; // as colunas de sócio detectadas no Fechamento da Empresa
  linhasIntegrante: LinhaIntegrante[];
  /** as linhas de Investimentos/Obras Adm com o dado bruto, para o detalhado */
  linhasBrutasIntegrante: (LinhaComIntegrante & { tipo_retirada: TipoRetirada })[];
  /** as despesas dos contratos ADMINISTRATIVO <sócio> (a coluna de cada sócio) */
  linhasColunaSocio: { linha: LinhaFluxoCusto; socio: string }[];
  contratoNomePorId: Map<string, string>;
  /** meses em que Investimentos/Obras Adm somados por integrante não batem com a coluna do Fechamento da Empresa */
  divergencias: { mes: string; tipo: TipoRetirada; porIntegrante: number; fechamento: number }[];
  viewsSemIntegrante: string[];
  carregando: boolean;
  erro: unknown;
}

export function useDadosFechamentoSocios(ano: number, base: BaseDespesa, codigoNota: string): DadosFechamentoSocios {
  const codigos = useMemo(() => codigosDoFiltro(codigoNota), [codigoNota]);
  const { contratos, nfs, contratoPorId, executavelDoContrato, carregando: carregandoBase } = useBaseFaturamento(codigos);

  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`), [ano]);

  const { data: custosAno = [], isLoading: c1, error: e1 } = useCustosContratoAno(ano, true, base, { manterInvestimentos: true, manterAdministrativos: true });
  const { data: admAno = [], isLoading: c2, error: e2 } = useDespesasAdmAno(ano, base);
  const { data: ligacoes } = useLigacoesRubrica();
  const { data: entradasAno = [] } = useEntradasAdmAno(ano, base);
  const { data: ajustesReceita } = useAjustesReceitaExtra();
  const { data: ajustesAdmClassificacao } = useAjustesAdmClassificacao();
  const { data: contratosAdmTirados } = useContratosAdmTirados();
  const ligacoesAdm = useMemo(() => ligacoesDoFechamento(ligacoes, ajustesAdmClassificacao), [ligacoes, ajustesAdmClassificacao]);
  const tiradosAdm = useMemo(() => contratosAdmTirados ?? new Set<string>(), [contratosAdmTirados]);
  const { data: tratamentosBrutos } = useTratamentosContrato();
  const tratamentos = useMemo(() => tratamentosBrutos ?? new Map<string, TratamentoContrato>(), [tratamentosBrutos]);

  const execGrade = useMemo(() => {
    const g = new Map<string, Map<string, number>>();
    for (const c of contratos) {
      const m = new Map<string, number>();
      for (const mes of meses) m.set(mes, executavelDoContrato(c, mes));
      g.set(c.id, m);
    }
    return g;
  }, [contratos, meses, executavelDoContrato]);
  const nfsDoAno = useMemo(() => nfs.filter((n) => n.competencia.startsWith(`${ano}-`)), [nfs, ano]);
  const custosContratoPorMesContrato = useMemo(() => custosPorContratoMes(custosAno, ligacoes), [custosAno, ligacoes]);

  const socioPorContrato = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contratos) {
      const t = tratamentoEfetivo(c.nome, tratamentos.get(c.id));
      const s = socioDoContrato(c.nome) ?? (t === "investimento" ? ROTULO_INVESTIMENTOS : t === "obra_administrativa" ? ROTULO_OBRAS_ADM : null);
      if (s) m.set(c.id, s);
    }
    return m;
  }, [contratos, tratamentos]);
  const idsAdministrativos = useMemo(() => new Set(contratos.filter((c) => ehContratoAdministrativo(c.nome)).map((c) => c.id)), [contratos]);
  const admDeContratos = useMemo(
    () => custosAno.filter((l) => !!l.contrato_id && idsAdministrativos.has(l.contrato_id) && !socioPorContrato.has(l.contrato_id) && !tiradosAdm.has(l.contrato_id)).map((l) => ({ ...l, contrato_id: null })),
    [custosAno, idsAdministrativos, socioPorContrato, tiradosAdm],
  );
  const entradasAdm = useMemo(
    () => entradasAno.filter((l) => !l.contrato_id || (idsAdministrativos.has(l.contrato_id) && !socioPorContrato.has(l.contrato_id) && !tiradosAdm.has(l.contrato_id))),
    [entradasAno, idsAdministrativos, socioPorContrato, tiradosAdm],
  );
  const admTodas = useMemo(() => [...admAno, ...admDeContratos], [admAno, admDeContratos]);

  // empresa "todas" e contrato "todos" (a mesma conta de linhasDoRecorte em FechamentoEmpresa.tsx)
  const linhasAno: LinhaFechamento[] = useMemo(() => {
    const passa = (id: string) => !!contratoPorId.get(id);
    const liquidoPorMes = new Map<string, number>();
    for (const [mes, t] of agruparFaturamento(nfsDoAno.filter((n) => passa(n.contrato_id)), (n) => n.competencia.slice(0, 7))) liquidoPorMes.set(mes, t.liquido);
    const executavelPorMes = new Map<string, number>();
    for (const c of contratos) for (const [mes, v] of execGrade.get(c.id) ?? []) executavelPorMes.set(mes, (executavelPorMes.get(mes) ?? 0) + v);
    const custosContratoPorMes = new Map<string, number>();
    for (const [chave, c] of custosContratoPorMesContrato) {
      const [id, mes] = chave.split("|");
      if (passa(id) && !socioPorContrato.has(id) && !idsAdministrativos.has(id)) custosContratoPorMes.set(mes, (custosContratoPorMes.get(mes) ?? 0) + totalCustos(c));
    }
    const sociosPorMes = despesasDosSocios(custosAno.filter((l) => !!l.contrato_id && passa(l.contrato_id)), socioPorContrato, ligacoes);
    const admPorMes: Map<string, CustosPorRubrica> = admPorMesRubrica(admTodas, ligacoesAdm, null);
    const tributos = tributosPorMes(admTodas, ligacoes, null);
    const receitasExtras = receitasExtrasPorMes(entradasAdm, ligacoes, ajustesReceita, null);
    return montarFechamento({ meses, mesAtual, liquidoPorMes, executavelPorMes, custosContratoPorMes, admPorMes, sociosPorMes, tributosPorMes: tributos, receitasExtrasPorMes: receitasExtras });
  }, [contratoPorId, nfsDoAno, contratos, execGrade, custosContratoPorMesContrato, socioPorContrato, idsAdministrativos, custosAno, ligacoes, admTodas, ligacoesAdm, entradasAdm, ajustesReceita, meses, mesAtual]);

  const ROTULOS_NAO_SOCIO = useMemo(() => new Set([ROTULO_INVESTIMENTOS, ROTULO_OBRAS_ADM]), []);
  const nomesSocios = useMemo(() => {
    const s = new Set<string>();
    for (const nome of socioPorContrato.values()) if (!ROTULOS_NAO_SOCIO.has(nome)) s.add(nome);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [socioPorContrato, ROTULOS_NAO_SOCIO]);

  const entradas: EntradaMes[] = useMemo(() => linhasAno.map((l) => {
    const colunaSocios: Record<string, number> = {};
    for (const [nome, v] of Object.entries(l.socios)) if (!ROTULOS_NAO_SOCIO.has(nome)) colunaSocios[nome] = v;
    return { mes: l.mes, resultadoAposOutrasReceitas: l.resultadoAposOutrasReceitas, tributos: l.tributos, colunaSocios };
  }), [linhasAno, ROTULOS_NAO_SOCIO]);
  const projetadoPorMes = useMemo(() => new Map(linhasAno.map((l) => [l.mes, l.projetado])), [linhasAno]);

  // Integrante dos lançamentos de Investimentos e Obras Adm
  const idsRetirada = useMemo(() => {
    const m = new Map<string, TipoRetirada>();
    for (const [id, rot] of socioPorContrato) {
      if (rot === ROTULO_INVESTIMENTOS) m.set(id, "investimentos");
      else if (rot === ROTULO_OBRAS_ADM) m.set(id, "obras");
    }
    return m;
  }, [socioPorContrato]);
  const chaveIds = useMemo(() => [...idsRetirada.keys()].sort().join(","), [idsRetirada]);
  const { data: integrante, isLoading: c3, error: e3 } = useQuery({
    queryKey: ["fechamento_socios_integrante", ano, base, chaveIds],
    staleTime: 120_000,
    enabled: idsRetirada.size > 0,
    queryFn: () => lerLinhasIntegrante([...idsRetirada.keys()], ano, base),
  });

  const linhasBrutasIntegrante = useMemo(
    () => (integrante?.linhas ?? []).filter((l) => ehDespesaDeSocio(l, ligacoes) && !!l.contrato_id && idsRetirada.has(l.contrato_id)).map((l) => ({ ...l, tipo_retirada: idsRetirada.get(l.contrato_id as string) as TipoRetirada })),
    [integrante, idsRetirada, ligacoes],
  );
  const linhasIntegrante: LinhaIntegrante[] = useMemo(() => linhasBrutasIntegrante.flatMap((l) => {
    const mes = l.mes_base ?? null;
    return mes ? [{ mes, tipo: l.tipo_retirada, integranteId: l.integrante_empregado_id ?? null, valor: l.valor || 0 }] : [];
  }), [linhasBrutasIntegrante]);

  const divergencias = useMemo(() => {
    const out: DadosFechamentoSocios["divergencias"] = [];
    const soma = new Map<string, number>();
    for (const l of linhasIntegrante) soma.set(`${l.mes}|${l.tipo}`, (soma.get(`${l.mes}|${l.tipo}`) ?? 0) + l.valor);
    for (const l of linhasAno) {
      for (const [tipo, rotulo] of [["investimentos", ROTULO_INVESTIMENTOS], ["obras", ROTULO_OBRAS_ADM]] as const) {
        const fech = r2(l.socios[rotulo] ?? 0);
        const proprio = r2(soma.get(`${l.mes}|${tipo}`) ?? 0);
        // mês projetado do Fechamento pode usar a média dos meses anteriores: só confere o que já aconteceu
        if (!l.projetado && Math.abs(fech - proprio) > 0.01) out.push({ mes: l.mes, tipo, porIntegrante: proprio, fechamento: fech });
      }
    }
    return out;
  }, [linhasIntegrante, linhasAno]);

  const linhasColunaSocio = useMemo(
    () => custosAno.flatMap((l) => {
      const socio = l.contrato_id ? socioPorContrato.get(l.contrato_id) : undefined;
      return socio && !ROTULOS_NAO_SOCIO.has(socio) && ehDespesaDeSocio(l, ligacoes) ? [{ linha: l, socio }] : [];
    }),
    [custosAno, socioPorContrato, ligacoes, ROTULOS_NAO_SOCIO],
  );
  const contratoNomePorId = useMemo(() => new Map(contratos.map((c) => [c.id, c.nome])), [contratos]);

  return {
    entradas, projetadoPorMes, nomesSocios, linhasIntegrante, linhasBrutasIntegrante, linhasColunaSocio, contratoNomePorId, divergencias,
    viewsSemIntegrante: integrante?.viewsSemIntegrante ?? [],
    carregando: carregandoBase || c1 || c2 || (idsRetirada.size > 0 && c3),
    erro: e1 ?? e2 ?? e3 ?? null,
  };
}

/** Os lançamentos que formam as retiradas de cada sócio no período (para a aba Retiradas Antecipadas — Detalhado). */
export function lancamentosDeRetirada(dados: Pick<DadosFechamentoSocios, "linhasBrutasIntegrante" | "linhasColunaSocio" | "contratoNomePorId">, socios: SocioConfig[], meses: Set<string>): LancamentoRetirada[] {
  const out: LancamentoRetirada[] = [];
  const mesDe = (l: LinhaFluxoCusto) => l.mes_base ?? (l.competencia || l.data_pagamento || "").slice(0, 7);
  const porNome = new Map(socios.map((s) => [s.nome.toLowerCase(), s]));
  for (const { linha, socio } of dados.linhasColunaSocio) {
    const s = porNome.get(socio.toLowerCase());
    const mes = mesDe(linha);
    if (!s || !s.ativo || !meses.has(mes)) continue;
    out.push({
      data: linha.data_pagamento, mes, socioId: s.id, socioNome: s.nome, tipo: "coluna_socio", descricao: linha.descricao ?? "", origem: dados.contratoNomePorId.get(linha.contrato_id ?? "") ?? "",
      classificacao: linha.classificacao_nome ?? "", valor: linha.valor || 0,
    });
  }
  for (const l of dados.linhasBrutasIntegrante) {
    const dono = donoDaLinha(l.integrante_empregado_id ?? null, socios.filter((s) => s.ativo));
    const mes = mesDe(l);
    if (dono.tipo !== "socio" || !meses.has(mes)) continue;
    const s = socios.find((x) => x.id === dono.socioId)!;
    out.push({
      data: l.data_pagamento, mes, socioId: s.id, socioNome: s.nome, tipo: l.tipo_retirada, descricao: l.descricao ?? "", origem: dados.contratoNomePorId.get(l.contrato_id ?? "") ?? "",
      classificacao: l.classificacao_nome ?? "", valor: l.valor || 0,
    });
  }
  return out.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
}

/** O que a Empresa consumiu do lucro (integrante "Empresa") e o que está sem integrante, em Investimentos e Obras Adm — para a tela mostrar de onde vem o "consumo da Empresa". */
export function lancamentosConsumoEmpresa(dados: Pick<DadosFechamentoSocios, "linhasBrutasIntegrante" | "contratoNomePorId">, socios: SocioConfig[], meses: Set<string>): LancamentoRetirada[] {
  const out: LancamentoRetirada[] = [];
  for (const l of dados.linhasBrutasIntegrante) {
    const dono = donoDaLinha(l.integrante_empregado_id ?? null, socios.filter((s) => s.ativo));
    const mes = l.mes_base ?? (l.competencia || l.data_pagamento || "").slice(0, 7);
    if (dono.tipo === "socio" || !meses.has(mes)) continue;
    out.push({
      data: l.data_pagamento, mes, socioId: dono.tipo === "empresa" ? "empresa" : "sem_integrante", socioNome: dono.tipo === "empresa" ? "Empresa" : "Sem integrante", tipo: l.tipo_retirada,
      descricao: l.descricao ?? "", origem: dados.contratoNomePorId.get(l.contrato_id ?? "") ?? "", classificacao: l.classificacao_nome ?? "", valor: l.valor || 0,
    });
  }
  return out.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
}
