import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CommandAction, actionsRegistry } from "../utils/commandRegistry";

const STORAGE_KEY = "bridgewatch:recent_actions";

function fuzzyScore(q: string, text: string) {
  if (!q) return 1;
  q = q.toLowerCase();
  text = text.toLowerCase();
  if (text.includes(q)) return 1 + q.length / text.length;
  const tokens = text.split(/\s+/);
  return tokens.reduce((acc, t) => acc + (t.startsWith(q) ? 0.5 : 0), 0);
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const items = useMemo(() => {
    const q = query.trim();
    const pool = [...actionsRegistry];
    pool.sort((a, b) => {
      const sa = fuzzyScore(q, `${a.title} ${(a.keywords || []).join(" ")}`);
      const sb = fuzzyScore(q, `${b.title} ${(b.keywords || []).join(" ")}`);
      return sb - sa;
    });
    return pool.slice(0, 20);
  }, [query]);

  function addRecent(id: string) {
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, 10);
    setRecent(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures in private browsing or quota-limited contexts.
    }
  }

  function execute(action: CommandAction) {
    addRecent(action.id);
    setOpen(false);
    if (action.onExecute) action.onExecute();
    else if (action.href) navigate(action.href);
  }

  if (!open) return null;

  const visibleItems =
    query.trim() === ""
      ? recent
          .map((id) => actionsRegistry.find((action) => action.id === id))
          .filter((action): action is CommandAction => Boolean(action))
      : items;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="relative w-full max-w-xl bg-stellar-card border border-stellar-border rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3">
          <label htmlFor="command-palette-input" className="sr-only">Type a command or search</label>
          <input id="command-palette-input" role="combobox" aria-expanded="true" aria-controls="command-palette-listbox" aria-autocomplete="list" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a command or search..." className="w-full bg-transparent text-white py-2 outline-none" />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {recent.length > 0 && query.trim() === "" && (
            <div className="px-3 py-2 text-xs text-stellar-text-secondary" id="command-palette-recent">Recent</div>
          )}
          <ul role="listbox" id="command-palette-listbox" aria-label="Available commands">
            {visibleItems.map((a) => (
              <li key={a.id} role="option" aria-selected="false" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); execute(a); } }} className="px-3 py-2 hover:bg-stellar-border/60 cursor-pointer focus:outline-none focus:bg-stellar-border/60" onClick={() => execute(a)}>
                <div className="text-sm text-stellar-text-primary">{a.title}</div>
                <div className="text-xs text-stellar-text-secondary">{a.href}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
