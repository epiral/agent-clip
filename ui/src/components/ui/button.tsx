import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent text-sm font-semibold whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border-border text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary border-border text-secondary-foreground hover:bg-accent",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-4 text-sm",
        xs: "h-7 gap-1 px-2 text-xs",
        sm: "h-8 gap-1.5 px-3 text-xs",
        lg: "h-12 gap-2 px-6 text-base",
        icon: "size-10",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
