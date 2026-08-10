import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Trash2, Loader2, Car, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useSalvarFoto, useRemoverFoto, urlDoArquivo, type Bem,
} from "@/hooks/useSupPatrimonio";
import { useQuery } from "@tanstack/react-query";

/**
 * Foto do bem — funciona como foto de perfil: uma só, trocável no lugar.
 *
 * Existe porque boa parte da frota entrou sem número de série ou placa
 * ("sem identificador"): olhar "MONTANA" e "ONIX" numa grade de cards não
 * diz qual carro é. A foto resolve na hora.
 *
 * O bucket é privado, então a imagem abre por URL assinada. Aqui é uma
 * assinatura só (o bem aberto no modal); na grade quem resolve é
 * `useFotosDosBens`, em lote.
 */
export function FotoDoBem({ bem, podeEditar = true }: { bem: Bem; podeEditar?: boolean }) {
  const salvar = useSalvarFoto();
  const remover = useRemoverFoto();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<string | null>(null);

  const { data: url } = useQuery({
    queryKey: ["sup_patrimonio_foto", bem.foto_path],
    enabled: !!bem.foto_path,
    staleTime: 4 * 60_000,
    queryFn: () => urlDoArquivo(bem.foto_path!),
  });

  const Icone = bem.categoria === "veiculo" ? Car : Wrench;
  const ocupado = salvar.isPending || remover.isPending;
  // Enquanto sobe, mostra a prévia local: o usuário vê o resultado na hora,
  // em vez de um vazio até o storage responder.
  const mostrando = previa ?? url ?? null;

  async function escolher(f: File | null) {
    if (!f) return;
    setPrevia(URL.createObjectURL(f));
    try {
      await salvar.mutateAsync({ bem, arquivo: f });
    } finally {
      setPrevia(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className={cn(
        "relative flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40",
        ocupado && "opacity-60",
      )}>
        {mostrando ? (
          <img src={mostrando} alt={`Foto de ${bem.nome}`} className="h-full w-full object-cover" />
        ) : (
          <Icone className="h-8 w-8 text-muted-foreground/50" />
        )}
        {ocupado && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
      </div>

      {podeEditar && (
        <div className="min-w-0 space-y-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => escolher(e.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                  disabled={ocupado} onClick={() => inputRef.current?.click()}>
            <Camera className="mr-1.5 h-3.5 w-3.5" />
            {bem.foto_path ? "Trocar foto" : "Adicionar foto"}
          </Button>

          {bem.foto_path && (
            <Button type="button" variant="ghost" size="sm"
                    className="h-8 text-xs text-destructive hover:text-destructive"
                    disabled={ocupado} onClick={() => remover.mutate(bem)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground">JPG, PNG ou WEBP, até 5 MB.</p>
        </div>
      )}
    </div>
  );
}
