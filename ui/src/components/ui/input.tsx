import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border border-border/40 bg-card/50 px-4 py-2 text-[14px] font-medium transition-all outline-none placeholder:text-muted-foreground/30 focus:border-primary/40 focus:ring-4 focus:ring-primary/5 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/10 dark:bg-card/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
