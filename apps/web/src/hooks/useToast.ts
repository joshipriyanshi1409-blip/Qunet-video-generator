import { useToastStore } from '../store/useToastStore';

/** React bindings for the toast store. */
export function useToast() {
  const push = useToastStore((state) => state.push);
  const dismiss = useToastStore((state) => state.dismiss);
  return { push, dismiss };
}
