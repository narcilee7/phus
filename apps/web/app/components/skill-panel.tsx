"use client";

import { RefreshCw } from "lucide-react";
import {
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
import type { SkillItem } from "@/hooks/use-phus";

interface SkillPanelProps {
  skills: SkillItem[];
  isLoading?: boolean;
  onRefresh: () => void;
  onActivate?: (name: string) => void;
}

export function SkillPanel({ skills, isLoading, onRefresh, onActivate }: SkillPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Skills</h2>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh skills</TooltipContent>
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
          ) : skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills discovered.</p>
          ) : (
            skills.map((skill) => (
              <Card
                key={skill.name}
                className="cursor-pointer transition-colors hover:bg-accent"
                onClick={() => onActivate?.(skill.name)}
              >
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-sm">{skill.name}</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <CardDescription className="line-clamp-2 text-xs">
                    {skill.description}
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
