import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface FABAction {
  icon: string;
  label: string;
  onClick: () => void;
}

export default function FAB({ actions }: { actions: FABAction[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* FAB container — absolute inside the max-w-[430px] parent */}
      <div className="pointer-events-none fixed bottom-0 left-1/2 z-40 flex w-full max-w-[430px] -translate-x-1/2 flex-col items-end content-pb">
        {/* Menu items */}
        <div className="flex flex-col items-end gap-2 px-4 pb-2">
          <AnimatePresence>
            {open &&
              actions.map((action, i) => (
                <motion.button
                  key={action.label}
                  initial={{ opacity: 0, y: 20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.8 }}
                  transition={{ duration: 0.15, delay: (actions.length - 1 - i) * 0.05 }}
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                  className="pointer-events-auto flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm text-white shadow-lg ring-1 ring-neutral-700"
                >
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </motion.button>
              ))}
          </AnimatePresence>
        </div>

        {/* FAB button */}
        <div className="px-4 pb-3">
          <motion.button
            className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg"
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ duration: 0.2 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setOpen(!open)}
            aria-label={open ? "Закрыть меню" : "Быстрые действия"}
          >
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </motion.button>
        </div>
      </div>
    </>
  );
}
