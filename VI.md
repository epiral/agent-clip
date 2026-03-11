# Pinix Visual Identity (VI) Specification

Version: 1.0.0  
Status: Canonical Specification for the Pinix Ecosystem  

This document defines the visual and functional design language for the Pinix ecosystem of "Clips." All clips—including `clip-todo`, `agent-clip`, and future iterations—must adhere to these specifications to ensure a unified, premium, and archival user experience within the Clip Dock.

---

## 1. Design Philosophy
The Pinix design system is a manifesto of **"Utility as Beauty."** It rejects the soft, rounded, and shaded trends of modern web interfaces in favor of a brutalist, editorial aesthetic inspired by high-end broadsheet newspapers and custom-bound notebooks. We believe that precision in typography and geometric discipline creates a "permanent" feel that respects the user's focus. We prioritize information density over whitespace and semantic clarity over decorative flair.

## 2. Design Principles
1.  **Geometric Absolute:** Everything is a rectangle. Rounded corners are a distraction from the structural integrity of the information.
2.  **Flat Hierarchy:** Depth is created through borders, color blocks, and typographic scale—never through shadows or gradients.
3.  **Typographic Anchorage:** Large, elegant serifs anchor the page, while functional sans-serifs and monospaced metadata handle the work.
4.  **Semantic Intent:** Color is a tool for communication (priority, status, context), not a decorative choice.
5.  **Archival Density:** Interfaces should feel like a well-organized ledger, maximizing information without sacrificing scannability.
6.  **Tactile Digitalism:** Digital interfaces should evoke the high-contrast clarity of ink on premium paper.

## 3. Color System
Pinix uses the **OKLCH** color space for perceptually uniform lightness and chroma.

### 3.1 Base Palette (Light Mode)
| Role | OKLCH Value | Description |
| :--- | :--- | :--- |
| **Paper (Background)** | `oklch(0.98 0.004 90)` | Warm, off-white "book" paper. |
| **Ink (Foreground)** | `oklch(0.15 0 0)` | Deep, matte black for text and primary lines. |
| **Surface** | `oklch(1 0 0)` | Pure white for high-contrast UI elements. |
| **Border** | `oklch(0.88 0 0)` | Subtle grey for structural grid lines. |

### 3.2 Semantic Colors
Color is used exclusively to denote state or category.
- **Urgent (P0/Danger):** `oklch(0.55 0.18 25)` (Terracotta)
- **Active/Sprint:** `oklch(0.60 0.22 40)` (Amber)
- **Success/Context A:** `oklch(0.55 0.15 145)` (Sage)
- **Info/Context B:** `oklch(0.60 0.10 265)` (Slate Blue)

### 3.3 Accent Color
The default ecosystem accent is **Ink (Foreground)**. Individual clips may choose one primary semantic color from the palette above for their "brand" (e.g., Todo uses Sprint/Amber), but must maintain the monochromatic base.

## 4. Typography
Typography is the core of the Pinix identity.

### 4.1 Font Stack
- **Serif (Headings):** `Playfair Display`, serif. (Weights: 700)
- **Sans (Body/UI):** `Inter`, system-ui, sans-serif. (Weights: 400, 500, 600)
- **Mono (Metadata):** `JetBrains Mono`, monospace. (Weights: 400)

### 4.2 Typographic Roles
- **H1 (Page Title):** `text-4xl`, `font-bold`, `tracking-tight`. Anchors the top of every clip.
- **H2/H3 (Section):** `text-3xl`/`text-xl`, `font-bold`.
- **Body Text:** `text-sm`, `leading-tight` or `leading-relaxed`.
- **Metadata:** `text-[10px]`, `font-mono`, `uppercase`.
- **The Signature Label:** `text-[9px]` or `text-[10px]`, `font-bold`, `uppercase`, `tracking-[0.2em]`. Used for all UI labels (tabs, headers, buttons).

## 5. Spacing & Layout
### 5.1 Mobile-First Constraint
Clips are designed for high-density viewing in a viewport constrained between **400px and 600px**.

### 5.2 Information Density
- **Vertical Rhythm:** Predominantly 1px borders (`border-b`).
- **Standard Padding:** `px-4 py-2.5` for list items; `p-6` for detail views.
- **Gap System:** Use `gap-0` with borders for grouped elements (like inputs + buttons) to create a unified block feel.

## 6. Component Vocabulary
### 6.1 Geometric Rules
- **Corner Radius:** `0px`. Always. No exceptions for buttons, cards, or inputs.
- **Shadows:** `none`. Depth is strictly 2D.
- **Borders:** `1px` solid `var(--color-border)`. Page-level containers or active modals use `border-t-4` in solid black.

### 6.2 Swimlane Indicators
Crucial for scannability in high-density lists.
- A vertical bar of **1px to 4px** on the far left of a card.
- Used to indicate **Priority**, **Project Color**, or **Active State**.

### 6.3 Interactions
- **Buttons:** Solid black background with white text, or 1px border with no background. Invert on hover.
- **Inputs:** No background, 1px border bottom or full border. Placeholder text: `text-muted/50`.
- **Tabs:** Bottom-fixed. Active tab has a `4px` top border and a background shift to `surface-hover`.

## 7. Motion & Transitions
Pinix is a "low-motion" environment.
- **Animates:** Color changes (`bg`, `text`, `border`), subtle opacity shifts, and simple vertical slide-ups for modals.
- **Does Not Animate:** Scaling, bouncing, or complex 3D transforms.
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` (Standard easing) at `150ms`.

## 8. Dark Mode
Dark mode is a direct transformation of the light palette, maintaining the "Ink and Paper" feel.

| Role | OKLCH Value |
| :--- | :--- |
| **Paper (Background)** | `oklch(0.12 0 0)` (Charcoal, not pure black) |
| **Ink (Foreground)** | `oklch(0.92 0 0)` (Soft off-white) |
| **Surface** | `oklch(0.16 0 0)` |
| **Border** | `oklch(0.22 0 0)` |

Semantic colors (P0, Sprint, etc.) are slightly adjusted in dark mode to maintain perceived brightness (typically increasing L by ~0.1).

## 9. Iconography & Decoration
- **Icons:** Use `lucide-react`. Size: `16px` for UI actions, `18px` for tabs, `10-12px` for inline metadata. Stroke width: `1.5` for inactive, `2.5` for active.
- **Decoration:** Zero. No illustrations, no patterns, no non-functional imagery.
- **Photography:** If used, should be high-contrast or treated with a monochrome/duotone filter to match the ecosystem palette.

## 10. Cross-Product Consistency
### 10.1 Mandatory (Non-Negotiable)
- **Radius 0:** All products must have zero rounded corners.
- **Typography:** Use the Serif-Sans-Mono stack as defined.
- **Base Colors:** All products must use the same `Paper` and `Ink` OKLCH values.

### 10.2 Variable (Clip-Specific)
- **Primary Accent:** Each clip can choose one semantic color as its identity (e.g., Todo is Amber, Agent might be Slate Blue).
- **Layout:** While the spacing system is fixed, the internal layout (chat list vs. task list) is determined by the clip's function.

---

*This specification is the source of truth. When in doubt, refer to the "Ink on Paper" metaphor.*
