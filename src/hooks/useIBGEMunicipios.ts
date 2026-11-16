import { useState, useEffect } from "react";

export type IBGEMunicipio = { id: string; nome: string; uf: string };

const CACHE_KEY = "ibge:municipios:v3";
let memCache: IBGEMunicipio[] | null = null;
let carregamento: Promise<IBGEMunicipio[]> | null = null;

async function carregarMunicipios(): Promise<IBGEMunicipio[]> {
  if (memCache) return memCache;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (raw?.salvoEm > Date.now() - 7 * 86400_000 && Array.isArray(raw.municipios) && raw.municipios.length &&
      raw.municipios.every((m: IBGEMunicipio) => typeof m.id === "string" && /^[0-9]{7}$/.test(m.id) && typeof m.nome === "string" && UFS.includes(m.uf))) {
      return (memCache = raw.municipios);
    }
  } catch { /* Cache inválido ou armazenamento indisponível: consultar o IBGE. */ }
  if (carregamento) return carregamento;
  carregamento = buscarMunicipios().finally(() => { carregamento = null; });
  return carregamento;
}

async function buscarMunicipios(): Promise<IBGEMunicipio[]> {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), 15000);
  try {
    const res = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
      { signal: controle.signal }
    );
    if (!res.ok) throw new Error("Não foi possível consultar o IBGE.");
    const data: { id: number; nome: string; microrregiao?: { mesorregiao?: { UF?: { sigla: string } } } | null;
      "regiao-imediata"?: { "regiao-intermediaria"?: { UF?: { sigla: string } } } }[] = await res.json();
    const municipios = data.map(m => ({ id: String(m.id), nome: m.nome,
      uf: m.microrregiao?.mesorregiao?.UF?.sigla ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla ?? "" }))
      .filter(m => /^[0-9]{7}$/.test(m.id) && m.nome && UFS.includes(m.uf));
    if (!municipios.length) throw new Error("Lista de municípios indisponível.");
    memCache = municipios;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ salvoEm: Date.now(), municipios }));
    } catch { /* A seleção continua funcionando sem cache persistente. */ }
    return municipios;
  } finally { clearTimeout(prazo); }
}

export const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO",
  "MA","MG","MS","MT","PA","PB","PE","PI","PR",
  "RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

export function useIBGEMunicipios() {
  const [municipios, setMunicipios] = useState<IBGEMunicipio[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    setIsLoading(true); setErro(false);
    carregarMunicipios()
      .then(dados => { if (ativo) setMunicipios(dados); })
      .catch(() => { if (ativo) setErro(true); })
      .finally(() => { if (ativo) setIsLoading(false); });
    return () => { ativo = false; };
  }, [tentativa]);

  function cidadesPorUF(uf: string): string[] {
    return municipios.filter((m) => m.uf === uf).map((m) => m.nome);
  }

  return { municipios, cidadesPorUF, isLoading, erro, recarregar: () => setTentativa(t => t + 1) };
}
