import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

function ShellBlock({ className }: Readonly<{ className?: string }>) {
  return <div className={cn("animate-pulse rounded-md bg-muted/55", className)} />;
}

function TableSurface({
  showExpandAction = true,
}: Readonly<{
  showExpandAction?: boolean;
}>) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <ShellBlock className="h-6 w-36" />
          {showExpandAction ? <ShellBlock className="h-10 w-28" /> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-6 pb-6">
          <div className="w-full rounded-md border border-border bg-card">
            <div className="border-b-2 border-border px-4 py-3">
              <div className="flex min-h-12 items-center gap-3">
                <ShellBlock className="h-5 w-[5.5rem]" />
                <ShellBlock className="h-5 w-[4.5rem]" />
                <ShellBlock className="h-5 w-24" />
                <ShellBlock className="h-5 w-16" />
                <ShellBlock className="ml-auto h-5 w-[4.5rem]" />
              </div>
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="flex min-h-14 items-center gap-3 px-4 py-3"
                >
                  <ShellBlock className="h-4 w-28" />
                  <ShellBlock className="h-4 w-[5.5rem]" />
                  <ShellBlock className="h-4 w-[4.5rem]" />
                  <ShellBlock className="h-4 w-24" />
                  <ShellBlock className="ml-auto h-8 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FiltersShell() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <ShellBlock className="h-10 flex-1 rounded-xl" />
      <div className="flex flex-wrap gap-2">
        <ShellBlock className="h-10 w-24" />
        <ShellBlock className="h-10 w-24" />
        <ShellBlock className="h-10 w-24" />
      </div>
    </div>
  );
}

function DashboardStatCard({
  active = false,
}: Readonly<{
  active?: boolean;
}>) {
  return (
    <Card
      className={cn(
        "transition-all",
        active && "border bg-accent/70 dark:border-primary",
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <ShellBlock className="h-5 w-20" />
        <ShellBlock className="h-4 w-4 rounded-full" />
      </CardHeader>
      <CardContent>
        <div className="flex h-8 items-center">
          <ShellBlock className="h-7 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardAuthShell() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ShellBlock className="h-9 w-32" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardStatCard active />
        <DashboardStatCard />
        <DashboardStatCard />
        <DashboardStatCard />
      </div>

      <div className="space-y-6">
        <FiltersShell />
        <TableSurface />
      </div>
    </div>
  );
}

function TablePageAuthShell() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ShellBlock className="h-9 w-36" />
        <div className="flex flex-wrap gap-2">
          <ShellBlock className="h-10 w-28" />
          <ShellBlock className="h-10 w-24" />
        </div>
      </div>

      <FiltersShell />
      <TableSurface />
    </div>
  );
}

function ImportPageAuthShell() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ShellBlock className="h-9 w-40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <ShellBlock className="h-6 w-24" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <ShellBlock className="h-5 w-52" />
                <ShellBlock className="h-10 w-28" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <ShellBlock className="mt-1 h-3 w-3 rounded-full" />
                    <ShellBlock className="h-4 w-24" />
                    <ShellBlock className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <ShellBlock className="h-5 w-18" />
              <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/15 p-6 text-center">
                <ShellBlock className="mb-4 h-10 w-10 rounded-full" />
                <ShellBlock className="h-5 w-44" />
                <ShellBlock className="mt-3 h-4 w-36" />
              </div>
            </div>

            <ShellBlock className="h-11 w-full rounded-xl" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <ShellBlock className="h-6 w-24" />
          </CardHeader>
          <CardContent className="mt-4">
            <div className="flex min-h-[32rem] flex-col items-center justify-center text-center text-muted-foreground">
              <ShellBlock className="mb-4 h-12 w-12 rounded-full" />
              <ShellBlock className="h-4 w-40" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AuthDeferredShell({
  pathname,
}: Readonly<{ pathname: string }>) {
  if (pathname === "/") {
    return <DashboardAuthShell />;
  }

  if (pathname === "/import") {
    return <ImportPageAuthShell />;
  }

  return <TablePageAuthShell />;
}
