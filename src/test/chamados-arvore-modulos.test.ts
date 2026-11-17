import { describe, expect, it } from "vitest";
import { NAV_MODULOS } from "@/components/layout/Sidebar";
import { montarMenu, estruturaPadrao, type EstruturaMenu } from "@/lib/menuLateral/estrutura";
import {
  alternarTela, atingeModulo, contarPorSetor, ehTela, filtrarArvore, indexarArvore, marcadasPorSetor,
  montarArvoreModulos, PREFIXO_FILTRO_SETOR, rotuloModulo, setorDoModulo, type ModuloMenu,
} from "@/lib/chamados/arvoreModulos";
import { incluirPosicao, normalizarLista, separarModulos, trocarPosicao, analisarImpacto } from "@/lib/chamados/impactoSistemico";
import { rotuloModuloImpactado, rotuloModuloLegado } from "@/pages/chamados/impactados";
import { moduloLabel } from "@/pages/chamados/types";

// SIS-2026-0921 — módulos impactados em árvore Setor → telas da barra lateral.

const LUCRO = "/app/controladoria/lucratividade-contratos";
const AUDITORIA = "/app/controladoria/auditoria";

const MENU: ModuloMenu[] = [
  {
    id: "controladoria_orc", label: "Controladoria",
    groups: [
      { label: "Cadastros Mestres", items: [{ label: "Centros de Custo", to: "/app/controladoria/centros-custo" }] },
      { label: "Ferramentas", items: [
        { label: "Lucratividade de Contratos", to: LUCRO },
        { label: "Auditoria da Controladoria", to: AUDITORIA },
        { label: "Lucratividade (cópia)", to: LUCRO },
      ] },
    ],
  },
  { id: "financeiro", label: "Financeiro", groups: [{ label: "Tesouraria", items: [{ label: "Fluxo de Caixa", to: "/app/financeiro/fluxo-caixa" }] }] },
  { id: "breve", label: "Em breve", status: "soon", groups: [{ label: "x", items: [{ label: "Y", to: "/app/y" }] }] },
  { id: "vazio", label: "Vazio", groups: [] },
  // Cópia da mesma tela em outro setor (Organizar Menu Lateral).
  { id: "diretoria", label: "Diretoria", groups: [{ label: "Atalhos", items: [{ label: "Lucro", to: LUCRO }] }] },
];

describe("Árvore Setor → telas", () => {
  const arvore = montarArvoreModulos(MENU);
  const idx = indexarArvore(arvore);

  it("mostra os setores na ordem do menu, sem 'em breve' nem vazios", () => {
    expect(arvore.map((s) => s.rotulo)).toEqual(["Controladoria", "Financeiro", "Diretoria"]);
  });

  it("ao abrir um setor, as telas dele com a categoria; repetida no setor aparece uma vez", () => {
    const ctrl = arvore[0];
    expect(ctrl.telas.map((t) => t.rotulo)).toEqual(["Centros de Custo", "Lucratividade de Contratos", "Auditoria da Controladoria"]);
    expect(ctrl.telas[1].categoria).toBe("Ferramentas");
  });

  it("rótulo 'Setor › Tela'; tela copiada em outro setor fica com o primeiro", () => {
    expect(rotuloModulo(LUCRO, idx)).toBe("Controladoria › Lucratividade de Contratos");
    expect(setorDoModulo(LUCRO, idx)?.setorId).toBe("controladoria_orc");
  });

  it("compatibilidade: valor amplo antigo usa o rótulo antigo; tela que saiu do menu mostra o endereço", () => {
    expect(rotuloModulo("controladoria", idx, rotuloModuloLegado)).toBe("Controladoria & Orçamento");
    expect(rotuloModulo("sumiu", idx, rotuloModuloLegado)).toBe("sumiu");
    expect(rotuloModulo("/app/tela-removida", idx)).toBe("Tela fora do menu (/app/tela-removida)");
    expect(ehTela("controladoria")).toBe(false);
    expect(ehTela(LUCRO)).toBe(true);
  });

  it("seleção individual, de setores diferentes; a posição não sai", () => {
    let sel: string[] = [];
    sel = alternarTela(sel, LUCRO);
    sel = alternarTela(sel, "/app/financeiro/fluxo-caixa");
    expect(sel).toEqual([LUCRO, "/app/financeiro/fluxo-caixa"]);
    expect(alternarTela(sel, LUCRO)).toEqual(["/app/financeiro/fluxo-caixa"]);
    expect(alternarTela(sel, LUCRO, LUCRO)).toEqual(sel);
    expect(Object.fromEntries(marcadasPorSetor(arvore, sel))).toEqual({ controladoria_orc: 1, financeiro: 1, diretoria: 1 });
  });

  it("busca em setor (inteiro) e em tela/categoria, sem acento", () => {
    expect(filtrarArvore(arvore, "financ").map((s) => s.id)).toEqual(["financeiro"]);
    const r = filtrarArvore(arvore, "auditoria");
    expect(r.map((s) => s.id)).toEqual(["controladoria_orc"]);
    expect(r[0].telas.map((t) => t.rota)).toEqual([AUDITORIA]);
    expect(filtrarArvore(arvore, "tesouraria")[0].telas[0].rotulo).toBe("Fluxo de Caixa");
    expect(filtrarArvore(arvore, "")).toHaveLength(3);
  });

  it("Monitoramento: filtro por tela e por setor inteiro; contagem por setor (um por chamado)", () => {
    expect(atingeModulo([LUCRO], LUCRO, "__t__", idx)).toBe(true);
    expect(atingeModulo([AUDITORIA], `${PREFIXO_FILTRO_SETOR}controladoria_orc`, "__t__", idx)).toBe(true);
    expect(atingeModulo(["/app/financeiro/fluxo-caixa"], `${PREFIXO_FILTRO_SETOR}controladoria_orc`, "__t__", idx)).toBe(false);
    expect(atingeModulo(null, "__t__", "__t__", idx)).toBe(true);
    const c = contarPorSetor([[LUCRO, AUDITORIA], ["/app/financeiro/fluxo-caixa", LUCRO], ["controladoria"]], idx, rotuloModuloLegado);
    // O antigo "controladoria" cai no mesmo setor da barra (revisão do 8d9f1671).
    expect(c).toEqual([
      { valor: `${PREFIXO_FILTRO_SETOR}controladoria_orc`, rotulo: "Controladoria", qtd: 3 },
      { valor: `${PREFIXO_FILTRO_SETOR}financeiro`, rotulo: "Financeiro", qtd: 1 },
    ]);
  });
});

describe("Gravação no chamado (rotas)", () => {
  it("posição (tela) entra nos impactados; módulos de setores diferentes vão juntos", () => {
    const gravado = incluirPosicao(["/app/financeiro/fluxo-caixa", " /app/financeiro/fluxo-caixa ", AUDITORIA], LUCRO);
    expect(gravado).toEqual([LUCRO, "/app/financeiro/fluxo-caixa", AUDITORIA]);
    expect(separarModulos(gravado, LUCRO)).toEqual({ ajustado: LUCRO, demais: ["/app/financeiro/fluxo-caixa", AUDITORIA] });
  });

  it("trocar a posição de tela mantém as demais; 'outro' não entra", () => {
    expect(trocarPosicao([LUCRO, AUDITORIA], LUCRO, "/app/financeiro/fluxo-caixa", true)).toEqual(["/app/financeiro/fluxo-caixa", AUDITORIA]);
    expect(incluirPosicao([AUDITORIA], "outro")).toEqual([AUDITORIA]);
  });

  it("chamado antigo (valores amplos) e novo (telas) convivem nas análises", () => {
    const a = analisarImpacto([
      { id: "1", status: "aberto", modulo_sistema: "controladoria", modulos_impactados: ["financeiro"], setores_impactados: ["RH"] },
      { id: "2", status: "aberto", modulo_sistema: LUCRO, modulos_impactados: [AUDITORIA], setores_impactados: ["RH"] },
    ]);
    expect(a.modulos.map((m) => m.valor).sort()).toEqual([AUDITORIA, LUCRO, "controladoria", "financeiro"].sort());
    expect(normalizarLista([LUCRO, LUCRO])).toEqual([LUCRO]);
  });
});

describe("Amarrado à barra lateral de verdade (NAV_MODULOS)", () => {
  const arvore = montarArvoreModulos(montarMenu(NAV_MODULOS, null));

  it("Controladoria traz as telas do pedido, com rótulo Setor › Tela também fora de componente", () => {
    const ctrl = arvore.find((s) => s.id === "controladoria_orc");
    expect(ctrl).toBeTruthy();
    const nomes = ctrl!.telas.map((t) => t.rotulo);
    for (const n of ["Centros de Custo", "Classificadores & Drivers", "Empresas do Grupo", "Estrutura Organizacional",
      "Auditoria da Controladoria", "Faturamento da Empresa", "Fechamento da Empresa", "Fechamento dos Sócios",
      "Lucratividade de Contratos", "DRE Gerencial"]) expect(nomes).toContain(n);
    // catalogoTelas registra o catálogo ao ser importado (via impactados.ts).
    expect(rotuloModuloImpactado(LUCRO)).toBe(`${ctrl!.rotulo} › Lucratividade de Contratos`);
    expect(moduloLabel({ modulo_sistema: LUCRO, modulo_sistema_outro: null })).toBe(`${ctrl!.rotulo} › Lucratividade de Contratos`);
    expect(moduloLabel({ modulo_sistema: "rh", modulo_sistema_outro: null })).toBe("Recursos Humanos");
  });

  it("todos os setores ativos da barra lateral aparecem", () => {
    const ativos = NAV_MODULOS.filter((m) => m.status === "active" && (m.groups ?? []).some((g) => g.items.length));
    expect(arvore.length).toBe(ativos.length);
  });

  it("organização salva: tela movida/renomeada e setor renomeado refletem; tela nova do catálogo aparece sozinha", () => {
    const padrao = estruturaPadrao(NAV_MODULOS);
    const salva: EstruturaMenu = structuredClone(padrao);
    const ctrl = salva.modulos.find((m) => m.origem === "controladoria_orc")!;
    ctrl.rotulo = "Controladoria (renomeada)";
    // Tira Lucratividade da Controladoria e põe, renomeada, no Financeiro.
    let item;
    for (const c of ctrl.categorias) {
      const i = c.itens.findIndex((x) => x.rota === LUCRO);
      if (i >= 0) item = c.itens.splice(i, 1)[0];
    }
    const fin = salva.modulos.find((m) => m.origem === "financeiro")!;
    fin.categorias[0].itens.push({ ...item!, rotulo: "Lucro por Contrato" });
    // Uma tela "nova" no catálogo: some das rotasConhecidas da versão salva.
    salva.rotasConhecidas = salva.rotasConhecidas.filter((r) => r !== AUDITORIA);
    ctrl.categorias.forEach((c) => { c.itens = c.itens.filter((x) => x.rota !== AUDITORIA); });

    const idx = indexarArvore(montarArvoreModulos(montarMenu(NAV_MODULOS, salva)));
    expect(rotuloModulo(LUCRO, idx)).toBe(`${fin.rotulo} › Lucro por Contrato`);
    expect(idx.get(AUDITORIA)?.setor).toBe("Controladoria (renomeada)");
  });
});

// ---- Revisão do 8d9f1671 -------------------------------------------------

import { NAV_FIXOS, modulosComFixos } from "@/components/layout/Sidebar";
import { assinarIndiceDasTelas, indiceDasTelas, registrarArvoreModulos, SETOR_DO_MODULO_ANTIGO } from "@/lib/chamados/arvoreModulos";
import { fonteSaibaMais } from "../../supabase/functions/_shared/novidade-ia.ts";

describe("Antigo (amplo) e novo (tela) do mesmo setor juntos", () => {
  const arvore = montarArvoreModulos([
    { id: "financeiro", label: "Financeiro", groups: [{ label: "T", items: [{ label: "Fluxo de Caixa", to: "/app/financeiro/fluxo-caixa" }] }] },
    { id: "controladoria_orc", label: "Controladoria", groups: [{ label: "F", items: [{ label: "Lucratividade", to: LUCRO }] }] },
    { id: "plano-acoes", label: "Plano de Ações", groups: [{ label: "P", items: [{ label: "Lista", to: "/app/plano-acoes" }] }] },
    { id: "bi", label: "BI", groups: [{ label: "B", items: [{ label: "Painéis", to: "/app/bi" }] }] },
  ]);
  const idx = indexarArvore(arvore);

  it("valor antigo cai no setor da barra (controladoria→controladoria_orc, plano_acoes→plano-acoes, power_bi→bi); integracao fica sem", () => {
    expect(setorDoModulo("financeiro", idx)?.setorId).toBe("financeiro");
    expect(setorDoModulo("controladoria", idx)?.setorId).toBe("controladoria_orc");
    expect(setorDoModulo("plano_acoes", idx)?.setorId).toBe("plano-acoes");
    expect(setorDoModulo("power_bi", idx)?.setorId).toBe("bi");
    expect(setorDoModulo("integracao", idx)).toBeNull();
    expect(SETOR_DO_MODULO_ANTIGO.integracao).toBeUndefined();
    // Rótulo do antigo continua o de antes.
    expect(rotuloModulo("controladoria", idx, rotuloModuloLegado)).toBe("Controladoria & Orçamento");
  });

  it("filtro setor:financeiro pega chamado antigo e novo", () => {
    expect(atingeModulo(["financeiro"], `${PREFIXO_FILTRO_SETOR}financeiro`, "__t__", idx)).toBe(true);
    expect(atingeModulo(["/app/financeiro/fluxo-caixa"], `${PREFIXO_FILTRO_SETOR}financeiro`, "__t__", idx)).toBe(true);
    expect(atingeModulo(["integracao"], `${PREFIXO_FILTRO_SETOR}financeiro`, "__t__", idx)).toBe(false);
  });

  it("contagem por setor: uma barra Financeiro só; chamado com antigo + tela do mesmo setor conta uma vez", () => {
    const c = contarPorSetor([["financeiro"], ["/app/financeiro/fluxo-caixa"], ["financeiro", "/app/financeiro/fluxo-caixa"], ["integracao"]],
      idx, rotuloModuloLegado);
    expect(c).toEqual([
      { valor: `${PREFIXO_FILTRO_SETOR}financeiro`, rotulo: "Financeiro", qtd: 3 },
      { valor: "integracao", rotulo: "Integração & Migração", qtd: 1 },
    ]);
  });
});

describe("Itens fixos da barra entram na árvore", () => {
  it("Início/Novidades/Aguardando Aprovação no topo e Configurações do ERP no rodapé", () => {
    const arvore = montarArvoreModulos(modulosComFixos(montarMenu(NAV_MODULOS, null)));
    expect(arvore[0].telas.map((t) => t.rota)).toEqual([NAV_FIXOS.inicio.to, NAV_FIXOS.novidades.to, NAV_FIXOS.aprovacoes.to]);
    expect(arvore[arvore.length - 1].rotulo).toBe(NAV_FIXOS.configuracoes.label);
    expect(arvore[arvore.length - 1].telas[0].rota).toBe("/app/administracao");
    expect(rotuloModuloImpactado("/app/novidades")).toBe("Início e atalhos › Novidades do Sistema");
  });
});

describe("Índice global acompanha a organização salva", () => {
  it("registrar de novo avisa quem assina e muda o rótulo; mesma árvore não avisa", () => {
    const antes = indiceDasTelas();
    let avisos = 0;
    const sair = assinarIndiceDasTelas(() => { avisos += 1; });
    const arvore = [{ id: "x", rotulo: "Setor X", telas: [{ rota: "/app/x", rotulo: "Tela X", categoria: "c" }] }];
    registrarArvoreModulos(arvore);
    registrarArvoreModulos(structuredClone(arvore));
    expect(avisos).toBe(1);
    expect(moduloLabel({ modulo_sistema: "/app/x", modulo_sistema_outro: null })).toBe("Setor X › Tela X");
    sair();
    // Devolve o índice do catálogo para os demais testes.
    registrarArvoreModulos([...antes.values()].length ? montarArvoreModulos(modulosComFixos(montarMenu(NAV_MODULOS, null))) : []);
  });
});

describe("Novidade IA — 'Saiba mais' com a posição em rota", () => {
  it("rota usa a própria rota (e sem a query); código antigo busca o módulo; outro/vazio/endereço estranho não", () => {
    expect(fonteSaibaMais(LUCRO)).toEqual({ tipo: "rota", candidatas: [LUCRO] });
    expect(fonteSaibaMais("/app/administracao?tab=modulos")).toEqual({ tipo: "rota", candidatas: ["/app/administracao?tab=modulos", "/app/administracao"] });
    expect(fonteSaibaMais("controladoria")).toEqual({ tipo: "modulo", codigo: "controladoria" });
    expect(fonteSaibaMais("outro")).toBeNull();
    expect(fonteSaibaMais(null)).toBeNull();
    expect(fonteSaibaMais("//evil.com")).toBeNull();
  });
});
