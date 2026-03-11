import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xl border border-border/40 bg-card/50 px-4 py-3 text-[15px] font-medium leading-relaxed transition-all outline-none placeholder:text-muted-foreground/30 focus:border-primary/40 focus:ring-4 focus:ring-primary/5 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/10 dark:bg-card/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
