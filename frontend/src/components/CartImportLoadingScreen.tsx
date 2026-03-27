import { Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/Card";

export function CartImportLoadingScreen() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center px-4">
      <Card className="w-full max-w-3xl">
        <CardContent className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          正在进入导入页...
        </CardContent>
      </Card>
    </div>
  );
}
