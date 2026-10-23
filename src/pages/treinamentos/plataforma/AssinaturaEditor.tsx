import { useState } from "react";
import { PenLine, Type } from "lucide-react";
import { QuadroAssinatura } from "@/components/assinatura/QuadroAssinatura";
import { Input } from "@/components/ui/input";
import type { Assinatura, AssinaturaCertificado } from "./tipos";
import { Slider } from "@/components/ui/slider";
import {
  AssinaturaTraco, BlocoAssinatura, FONTES_ASSINATURA, GRUPOS_FONTE, TAMANHO_MAX, TAMANHO_MIN, assinaturaValeParaPublicar, useFontesAssinatura,
} from "./assinaturaFolha";

// =====================================================================
// TREINAMENTOS — editor de assinatura (mig 20261005000003).
// Usado na tela Cursos › Assinaturas e no "Criar assinatura" do Editar
// curso. Nome completo + cargo e registro (obrigatórios desde 06/10/2026,
// mig 20261006000001), e a assinatura em si: DESENHADA no quadro
// (mouse, caneta ou dedo) ou ESCRITA numa fonte cursiva. A prévia mostra
// o bloco exatamente como sai no certificado.
// =====================================================================

export type RascunhoAssinatura = Partial<Assinatura> & { tipo: Assinatura["tipo"] };

export function AssinaturaEditor({ valor, onChange }: { valor: RascunhoAssinatura; onChange: (v: RascunhoAssinatura) => void }) {
  useFontesAssinatura();
  const set = (p: Partial<RascunhoAssinatura>) => onChange({ ...valor, ...p });
  const [grupo, setGrupo] = useState<(typeof GRUPOS_FONTE)[number]>("Todas");
  const fontesVisiveis = FONTES_ASSINATURA.filter((f) => grupo === "Todas" || f.grupo === grupo);
  const tamanho = Math.min(TAMANHO_MAX, Math.max(TAMANHO_MIN, Number(valor.tamanho) || 1));
  const mudarTamanho = (d: number) => set({ tamanho: Math.round(Math.min(TAMANHO_MAX, Math.max(TAMANHO_MIN, tamanho + d)) * 100) / 100 });
  const previa: AssinaturaCertificado = {
    nome_completo: valor.nome_completo?.trim() || "Nome do treinador", cargo: valor.cargo?.trim() || null, registro: valor.registro?.trim() || null,
    tipo: valor.tipo, imagem: valor.imagem ?? null,
    texto: valor.texto?.trim() || valor.nome_completo?.trim() || "Assinatura", fonte: valor.fonte ?? FONTES_ASSINATURA[0].id,
    tamanho: valor.tamanho ?? 1,
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="campo">
          <label>Nome completo do treinador *</label>
          <Input value={valor.nome_completo ?? ""} onChange={(e) => set({ nome_completo: e.target.value })} placeholder="Como sai no certificado" />
        </div>
        <div className="campo">
          <label>Cargo *</label>
          <Input list="trn-cargos-assinatura" value={valor.cargo ?? ""} onChange={(e) => set({ cargo: e.target.value })} placeholder="ex.: Técnica em Segurança do Trabalho" />
          <datalist id="trn-cargos-assinatura">
            <option value="Técnica em Segurança do Trabalho" />
            <option value="Técnico em Segurança do Trabalho" />
          </datalist>
        </div>
        <div className="campo sm:col-span-2">
          <label>Registro *</label>
          <Input value={valor.registro ?? ""} onChange={(e) => set({ registro: e.target.value })} placeholder="ex.: 0031036 (registro profissional / MTE)" />
          {/* Mig 20261006000001: curso com assinatura só publica se ela for de Técnico(a) em Segurança. */}
          <div className="ajuda">
            {assinaturaValeParaPublicar(valor)
              ? "✓ Vale para publicar cursos (Técnico(a) em Segurança com registro)."
              : "Para ir num curso publicado, a assinatura tem que ser de Técnico(a) em Segurança, com o registro."}
          </div>
        </div>
      </div>

      <div className="campo">
        <label>Assinatura *</label>
        <div className="mb-2 inline-flex rounded-lg border p-0.5">
          {([["desenho", "Desenhar", PenLine], ["texto", "Escrever", Type]] as const).map(([t, rot, Ic]) => (
            <button key={t} type="button" onClick={() => set({ tipo: t })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${valor.tipo === t ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              <Ic className="h-3.5 w-3.5" /> {rot}
            </button>
          ))}
        </div>

        {valor.tipo === "desenho" ? (
          <QuadroAssinatura imagem={valor.imagem ?? null} onChange={(imagem) => set({ imagem })} />
        ) : (
          <div className="grid gap-2">
            <Input value={valor.texto ?? ""} onChange={(e) => set({ texto: e.target.value })}
              placeholder={valor.nome_completo?.trim() || "Escreva a assinatura"} />
            <div className="flex flex-wrap items-center gap-1">
              {GRUPOS_FONTE.map((g) => (
                <button key={g} type="button" onClick={() => setGrupo(g)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${grupo === g ? "border-orange-500 bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-slate-100"}`}>{g}</button>
              ))}
              <span className="ml-auto text-[11px] text-slate-400">{fontesVisiveis.length} letras</span>
            </div>
            <div className="grid max-h-72 auto-rows-max grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {fontesVisiveis.map((f) => (
                <button key={f.id} type="button" onClick={() => set({ fonte: f.id, texto: valor.texto?.trim() ? valor.texto : valor.nome_completo ?? "" })}
                  className={`overflow-hidden rounded-lg border-2 bg-white px-2 pb-1 pt-2 text-left transition ${valor.fonte === f.id ? "border-orange-500 ring-2 ring-orange-200" : "border-slate-200 hover:border-slate-400"}`}>
                  <AssinaturaTraco a={{ ...previa, tipo: "texto", fonte: f.id, tamanho: 1 }} altura="34px" />
                  <span className="mt-1 block truncate text-[10px] text-slate-500">{f.nome}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold text-slate-600">Tamanho da letra</span>
              <button type="button" className="text-xs font-bold text-slate-500" onClick={() => mudarTamanho(-0.1)} aria-label="Diminuir">A−</button>
              <Slider className="flex-1" min={TAMANHO_MIN} max={TAMANHO_MAX} step={0.05} value={[tamanho]} onValueChange={([v]) => set({ tamanho: v })} />
              <button type="button" className="text-sm font-bold text-slate-500" onClick={() => mudarTamanho(0.1)} aria-label="Aumentar">A+</button>
              <span className="w-10 text-right text-xs tabular-nums text-slate-500">{Math.round(tamanho * 100)}%</span>
            </div>
            <div className="ajuda">Nome comprido ou letra larga encolhe sozinho para caber na linha do certificado.</div>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Como sai no certificado</p>
        {/* O bloco é medido em cqw da folha; fora dela, escala 2,5 dá o tamanho de leitura. */}
        <div className="flex justify-center rounded-lg border bg-white py-5" style={{ containerType: "inline-size" }}>
          <BlocoAssinatura a={previa} escala={2.5} />
        </div>
      </div>
    </div>
  );
}
