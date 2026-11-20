"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

import * as React from "react"

/** The page's appearance as Mostra sets it on `<html data-appearance>`, else the device's. */
function useAppearance(): ToasterProps["theme"] {
  const read = (): ToasterProps["theme"] => {
    const value = typeof document === "undefined" ? undefined : document.documentElement.dataset["appearance"]
    return value === "light" || value === "dark" ? value : "system"
  }
  const [appearance, setAppearance] = React.useState(read)
  React.useEffect(() => {
    const observer = new MutationObserver(() => setAppearance(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] })
    return () => observer.disconnect()
  }, [])
  return appearance
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppearance()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
