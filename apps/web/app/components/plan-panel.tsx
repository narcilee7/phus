"use client";

import { RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ScrollArea,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@phus/phus-design";
import type { PlanItem } from "@/hooks/use-phus";

interface PlanPanelProps {
  plans: PlanItem[];
  isLoading?: boolean;
  onRefresh: () => void;
}

export function PlanPanel({ plans, isLoading, onRefresh }: PlanPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Plans</h2>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh plans</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans for this session.</p>
          ) : (
            plans.map((plan) => (
              <Card key={plan.id}>
                <CardHeader className="p-3 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate text-sm">{plan.goal}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">
                      {plan.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <CardDescription className="text-xs">
                    {plan.stepCount} steps · {new Date(plan.updatedAt).toLocaleString()}
                  </CardDescription>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
