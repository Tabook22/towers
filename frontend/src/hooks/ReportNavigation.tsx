import { createContext, useContext, useLayoutEffect, useRef, type ReactNode, type SetStateAction } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

type SavedNavigation = { reportId: string; values: Record<string, unknown>; scrollY: number };
type Navigation = {
  values: Record<string, unknown>;
  update: (values: Record<string, unknown>, push?: boolean) => void;
  back: () => void;
  close: (key: string) => void;
};
const Context = createContext<Navigation | null>(null);

export function ReportNavigationProvider({ reportId, fallback, children }: { reportId: string; fallback: string; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const type = useNavigationType();
  const saved = location.state?.reportNavigation as SavedNavigation | undefined;
  const current = saved?.reportId === reportId ? saved : { reportId, values: {}, scrollY: 0 };
  const ref = useRef(current);
  ref.current = current;
  const url = location.pathname + location.search + location.hash;
  const update = (patch: Record<string, unknown>, push = false) => {
    const previous = ref.current;
    const values = { ...previous.values, ...patch };
    if (JSON.stringify(values) === JSON.stringify(previous.values)) return;
    const next = { reportId, values, scrollY: window.scrollY };
    if (push) {
      // Save the outgoing screen before adding the next one, including its scroll position.
      window.history.replaceState({ ...window.history.state, usr: { ...location.state, reportNavigation: { ...previous, scrollY: window.scrollY } } }, '');
    }
    ref.current = next;
    navigate(url, { replace: !push, state: { ...location.state, reportNavigation: next }, preventScrollReset: true });
  };
  const back = () => {
    if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
  const close = (key: string) => {
    // A dialog opened from this report has its own entry; closing returns to its parent.
    if (window.history.state?.idx > 0) back();
    else update({ [key]: null });
  };
  useLayoutEffect(() => {
    if (type !== 'POP' || saved?.reportId !== reportId) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [location.key, reportId, type, saved]);
  return <Context.Provider value={{ values: current.values, update, back, close }}>{children}</Context.Provider>;
}

export function useReportNavigation() {
  const navigation = useContext(Context);
  if (!navigation) throw new Error('Report navigation requires its provider');
  return navigation;
}

export function useReportHistoryState<T>(key: string, initial: T, push = false): [T, (value: SetStateAction<T>) => void] {
  const navigation = useReportNavigation();
  const value = (key in navigation.values ? navigation.values[key] : initial) as T;
  return [value, next => navigation.update({ [key]: typeof next === 'function' ? (next as (previous: T) => T)(value) : next }, push)];
}
