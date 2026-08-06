import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface PlaceholderMaloteProps {
  title: string;
}

export function PlaceholderMalote({ title }: PlaceholderMaloteProps) {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={title}
        subtitle="Esta tela do módulo Malote ainda está em construção."
        module="Malote"
        breadcrumb={["Malote", title]}
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
          <Construction className="h-10 w-10" />
          <p className="text-sm font-medium">Em construção</p>
          <p className="max-w-sm text-xs">
            Essa funcionalidade do módulo Malote ainda está sendo desenvolvida. Volte em breve.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
