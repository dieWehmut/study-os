import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  id?: string
  ariaLabel?: string
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function Select({
  id,
  ariaLabel,
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  className,
  disabled = false,
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next ?? "")}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 w-fit min-w-28 items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:border-ring data-[popup-open]:ring-2 data-[popup-open]:ring-ring",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        {/*
          The popup is unmounted while closed, so the primitive cannot look up the
          selected item's label on its own and falls back to printing the raw
          value. That only shows when a value differs from its label -- the
          语音合成 preset picker rendered "local" instead of「本地服务」-- so map it
          back here. Supplying children overrides the placeholder, hence the
          explicit empty case.
        */}
        <SelectPrimitive.Value className="truncate">
          {(selected: string | null) => {
            if (selected === null || selected === "") {
              return placeholder
            }
            return options.find((option) => option.value === selected)?.label ?? selected
          }}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="shrink-0 text-primary">
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} align="start" className="z-50">
          <SelectPrimitive.Popup className="max-h-64 w-(--anchor-width) min-w-40 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg shadow-black/5 dark:shadow-black/25">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-default select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm text-popover-foreground outline-none data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary data-[selected]:font-medium"
              >
                <SelectPrimitive.ItemText className="truncate">{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="text-primary">
                  <Check aria-hidden="true" className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
