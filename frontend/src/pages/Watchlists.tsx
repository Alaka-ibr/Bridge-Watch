import Watchlist from "../components/watchlist/Watchlist";
import EmptyState from "../components/EmptyState";
import { useWatchlist } from "../hooks/useWatchlist";

export default function WatchlistsPage() {
  const { watchlists, createWatchlist } = useWatchlist();

  const handleCreate = () => {
    const name = window.prompt("Watchlist name");
    if (name) {
      createWatchlist(name);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Watchlists</h1>
        <p className="mt-2 text-stellar-text-secondary">
          Track favorite assets, organize multiple watchlists, and focus updates.
        </p>
      </div>

      {watchlists.length === 0 ? (
        <EmptyState
          title="No watchlists yet"
          description="Create a watchlist to start tracking your favorite assets in one place."
          actionLabel="Create one"
          onAction={handleCreate}
        />
      ) : (
        <Watchlist />
      )}
    </div>
  );
}
