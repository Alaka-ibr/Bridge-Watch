import { Link } from "react-router-dom";
import { useRef, useState } from "react";
import { useWatchlist } from "../../hooks/useWatchlist";
import EmptyState from "../EmptyState";

export default function Watchlist() {
  const {
    watchlists,
    activeListId,
    activeWatchlist,
    setActiveWatchlist,
    createWatchlist,
    deleteWatchlist,
    renameWatchlist,
    clearActiveWatchlist,
    reorderAsset,
    removeAsset,
    exportWatchlists,
    importWatchlists,
  } = useWatchlist();

  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-4 rounded-lg border border-stellar-border bg-stellar-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">Watchlists</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeListId}
            onChange={(event) => setActiveWatchlist(event.target.value)}
            className="rounded-md border border-stellar-border bg-stellar-dark px-3 py-2 text-sm text-white"
            aria-label="Select active watchlist"
          >
            {watchlists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              const name = window.prompt("Watchlist name");
              if (name) {
                createWatchlist(name);
              }
            }}
            className="rounded border border-stellar-border px-3 py-2 text-xs text-stellar-text-secondary hover:text-white"
          >
            New list
          </button>

          <button
            type="button"
            onClick={() => {
              if (!activeWatchlist) {
                return;
              }

              const next = window.prompt("Rename watchlist", activeWatchlist.name);
              if (next) {
                renameWatchlist(activeWatchlist.id, next);
              }
            }}
            className="rounded border border-stellar-border px-3 py-2 text-xs text-stellar-text-secondary hover:text-white"
          >
            Rename
          </button>

          <button
            type="button"
            onClick={() => {
              if (!activeWatchlist) {
                return;
              }

              const shouldDelete = window.confirm(
                `Delete watchlist "${activeWatchlist.name}"?`
              );

              if (shouldDelete) {
                deleteWatchlist(activeWatchlist.id);
              }
            }}
            className="rounded border border-stellar-border px-3 py-2 text-xs text-red-300 hover:text-red-200"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const data = exportWatchlists();
            const blob = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "bridgewatch-watchlists.json";
            anchor.click();
            URL.revokeObjectURL(url);
          }}
          className="rounded border border-stellar-border px-3 py-1.5 text-xs text-stellar-text-secondary hover:text-white"
        >
          Export
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-stellar-border px-3 py-1.5 text-xs text-stellar-text-secondary hover:text-white"
        >
          Import
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }

            const text = await file.text();
            const imported = importWatchlists(text);
            setImportError(imported ? null : "Unable to import watchlist file");
            event.currentTarget.value = "";
          }}
          className="hidden"
        />

        <button
          type="button"
          onClick={clearActiveWatchlist}
          className="rounded border border-stellar-border px-3 py-1.5 text-xs text-stellar-text-secondary hover:text-white"
        >
          Clear list
        </button>
      </div>

      {importError ? <p className="text-xs text-red-400">{importError}</p> : null}

      {!activeWatchlist || activeWatchlist.assets.length === 0 ? (
        <EmptyState
          compact
          title="No assets in this watchlist yet"
          description="Open an asset page and add it to this watchlist to see it here."
        />
      ) : (
        <ul className="space-y-2">
          {activeWatchlist.assets.map((symbol) => (
            <li
              key={symbol}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-stellar-border px-3 py-2"
            >
              <Link to={`/assets/${symbol}`} className="text-sm font-medium text-white hover:underline">
                {symbol}
              </Link>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => reorderAsset(symbol, "up")}
                  className="rounded border border-stellar-border px-2 py-1 text-xs text-stellar-text-secondary hover:text-white"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => reorderAsset(symbol, "down")}
                  className="rounded border border-stellar-border px-2 py-1 text-xs text-stellar-text-secondary hover:text-white"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeAsset(symbol)}
                  className="rounded border border-stellar-border px-2 py-1 text-xs text-red-300 hover:text-red-200"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
