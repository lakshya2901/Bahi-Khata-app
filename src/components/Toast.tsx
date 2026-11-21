import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'warning';
  message: string;
}

let nextId = 1;
const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

function push(kind: Toast['kind'], message: string) {
  const toast = { id: nextId++, kind, message };
  toasts = [...toasts, toast];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toast.id);
    listeners.forEach((l) => l(toasts));
  }, 4000);
}

export function toastError(message: string) {
  push('error', message);
}
export function toastSuccess(message: string) {
  push('success', message);
}
export function toastWarning(message: string) {
  push('warning', message);
}

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

const colors = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
};

export function ToastContainer() {
  const [items, setItems] = useState<Toast[]>(toasts);
  const onUpdate = useCallback((next: Toast[]) => setItems(next), []);
  useEffect(() => {
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, [onUpdate]);

  return (
    <div className="fixed bottom-24 left-4 right-4 lg:bottom-4 lg:left-auto z-[100] flex flex-col items-stretch lg:items-end gap-2 pointer-events-none">
      {items.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            className={`${colors[t.kind]} pointer-events-auto shadow-lg rounded-xl px-4 py-3 flex items-center gap-2 text-sm font-medium animate-[toastIn_0.2s_ease-out]`}
          >
            <Icon size={16} className="shrink-0" />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
