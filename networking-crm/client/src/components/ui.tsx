import { forwardRef, ReactNode, ButtonHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getWarmthColor, getInitials } from "../lib/warmth";

// ─── Button ──────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const btnBase = "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none";

const btnVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white active:bg-accent-hover",
  secondary: "bg-card text-neutral-300 ring-1 ring-neutral-700 active:bg-card-hover",
  ghost: "text-neutral-400 active:text-white active:bg-card",
  danger: "bg-red-900/30 text-red-400 active:bg-red-900/50",
};

const btnSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-12 px-6 text-sm rounded-xl",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", children, ...props }, ref) => (
    <button
      ref={ref}
      className={`${btnBase} ${btnVariants[variant]} ${btnSizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
);
Button.displayName = "Button";

// ─── Card ────────────────────────────────────────────────

export function Card({
  children,
  className = "",
  onClick,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-card border border-white/5 ${padded ? "p-4" : ""} ${
        onClick ? "cursor-pointer active:bg-card-hover transition-colors" : ""
      } ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────

export function Badge({
  children,
  color,
  className = "",
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
      style={color ? { backgroundColor: color + "20", color } : undefined}
    >
      {children}
    </span>
  );
}

// ─── Input ───────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-neutral-700 focus:ring-accent focus-visible:ring-2 focus-visible:ring-accent transition-shadow";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input ref={ref} className={`${inputCls} ${className}`} {...props} />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...props }, ref) => (
    <textarea ref={ref} className={`${inputCls} resize-none ${className}`} {...props} />
  )
);
Textarea.displayName = "Textarea";

// ─── BottomSheet ─────────────────────────────────────────

export function BottomSheet({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title?: string;
}) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end justify-center">
        <motion.div
          className="absolute inset-0 bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="relative w-full max-w-[430px] rounded-t-3xl bg-card px-6 pb-8 pt-6 border-t border-white/5"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100) onClose();
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
          {title && (
            <h3 className="mb-4 text-lg font-semibold text-white">{title}</h3>
          )}
          {children}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ─── EmptyState ──────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center px-8 py-12">
      <div className="text-4xl">{icon}</div>
      <div>
        <p className="text-lg font-medium text-white">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-neutral-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────

export function Avatar({
  name,
  warmthStatus,
  size = "md",
}: {
  name: string;
  warmthStatus: string;
  size?: "sm" | "md" | "lg";
}) {
  const color = getWarmthColor(warmthStatus);
  const sizes = {
    sm: "h-9 w-9 text-xs",
    md: "h-11 w-11 text-sm",
    lg: "h-20 w-20 text-2xl",
  };

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ${sizes[size]}`}
      style={{
        backgroundColor: color + "33",
        color,
        boxShadow: `0 0 0 2px ${color}`,
      }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card border border-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ─── Divider ─────────────────────────────────────────────

export function Divider() {
  return (
    <div className="my-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  );
}

// ─── SectionLabel ────────────────────────────────────────

export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {children}
      </h2>
      {action}
    </div>
  );
}
