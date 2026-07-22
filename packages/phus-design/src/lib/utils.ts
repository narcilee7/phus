// src/lib/utils.ts
// The shadcn-style `cn` helper: merge Tailwind class strings with
// proper precedence. Drop-in for shadcn/ui consumers.

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));