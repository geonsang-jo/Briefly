import React from "react"

import { cn } from "@/lib/utils"

type ProgressiveBlurPosition = "top" | "bottom" | "both" | "left" | "right" | "both-x"

export interface ProgressiveBlurProps {
  className?: string
  height?: string
  width?: string
  position?: ProgressiveBlurPosition
  blurLevels?: number[]
  children?: React.ReactNode
}

export function ProgressiveBlur({
  className,
  height = "30%",
  width = "14%",
  position = "bottom",
  blurLevels = [0.5, 1, 2, 4, 8, 16, 32, 64],
}: ProgressiveBlurProps) {
  // Create array with length equal to blurLevels.length - 2 (for before/after pseudo elements)
  const divElements = Array(blurLevels.length - 2).fill(null)
  const isVertical = position === "top" || position === "bottom" || position === "both"

  const getWrapperPositionClass = () => {
    if (position === "top") return "top-0 inset-x-0"
    if (position === "bottom") return "bottom-0 inset-x-0"
    if (position === "both") return "inset-0"
    if (position === "left") return "left-0 inset-y-0"
    if (position === "right") return "right-0 inset-y-0"
    return "inset-0"
  }

  const getEdgeDirection = () => {
    if (position === "bottom") return "to bottom"
    if (position === "top") return "to top"
    if (position === "left") return "to right"
    if (position === "right") return "to left"
    if (position === "both-x") return "to right"
    return "to bottom"
  }

  const getMiddleMask = (startPercent: number, midPercent: number, endPercent: number) => {
    if (position === "both" || position === "both-x") {
      if (position === "both-x") {
        return `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
      }
      return `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
    }
    const direction = getEdgeDirection()
    return `linear-gradient(${direction}, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
  }

  return (
    <div
      className={cn(
        "gradient-blur pointer-events-none absolute z-10",
        className,
        getWrapperPositionClass()
      )}
      style={{
        height: isVertical ? (position === "both" ? "100%" : height) : "100%",
        width: isVertical ? "100%" : position === "both-x" ? "100%" : width,
      }}
    >
      {/* First blur layer (pseudo element) */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: 1,
          backdropFilter: `blur(${blurLevels[0]}px)`,
          WebkitBackdropFilter: `blur(${blurLevels[0]}px)`,
          maskImage:
            position === "both"
              ? `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
              : position === "both-x"
                ? `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
                : `linear-gradient(${getEdgeDirection()}, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)`,
          WebkitMaskImage:
            position === "both"
              ? `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
              : position === "both-x"
                ? `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
                : `linear-gradient(${getEdgeDirection()}, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)`,
        }}
      />

      {/* Middle blur layers */}
      {divElements.map((_, index) => {
        const blurIndex = index + 1
        const startPercent = blurIndex * 12.5
        const midPercent = (blurIndex + 1) * 12.5
        const endPercent = (blurIndex + 2) * 12.5

        const maskGradient = getMiddleMask(startPercent, midPercent, endPercent)

        return (
          <div
            key={`blur-${index}`}
            className="absolute inset-0"
            style={{
              zIndex: index + 2,
              backdropFilter: `blur(${blurLevels[blurIndex]}px)`,
              WebkitBackdropFilter: `blur(${blurLevels[blurIndex]}px)`,
              maskImage: maskGradient,
              WebkitMaskImage: maskGradient,
            }}
          />
        )
      })}

      {/* Last blur layer (pseudo element) */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: blurLevels.length,
          backdropFilter: `blur(${blurLevels[blurLevels.length - 1]}px)`,
          WebkitBackdropFilter: `blur(${blurLevels[blurLevels.length - 1]}px)`,
          maskImage:
            position === "both"
              ? `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
              : position === "both-x"
                ? `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
                : `linear-gradient(${getEdgeDirection()}, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)`,
          WebkitMaskImage:
            position === "both"
              ? `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
              : position === "both-x"
                ? `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`
                : `linear-gradient(${getEdgeDirection()}, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)`,
        }}
      />
    </div>
  )
}
