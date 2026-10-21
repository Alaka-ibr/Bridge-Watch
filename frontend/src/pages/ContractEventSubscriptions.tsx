import React, { useState, useEffect } from "react";

interface FilterRule {
  field: string;
  operator: string;
  value: any;
}

interface ContractEventSubscription {
  id: string;
  name: string;
  description?: string | null;
  contract_address: string;
  network: string;
  event_topics: string[];
  filter_rules: {
    operator?: "AND" | "OR";
    rules?: FilterRule[];
  };
  delivery_target: string;
  delivery_config: Record<string, any>;
  status: "active" | "paused" | "disabled" | "errored";
  rate_limit_per_min: number;
  retry_limit: number;
  batch_size: number;
  delivered_count: number;
  failed_count: number;
  last_delivered_at?: string | null;
  last_failure_reason?: string | null;
  created_at: string;
}

interface DeliveryLog {
  id: string;
  subscription_id: string;
  event_id: string;
  contract_address: string;
  topic: string;
  payload: Record<string, any>;
  delivery_status: string;
  status_code?: number | null;
  latency_ms?: number | null;
  error_message?: string | null;
  attempt: number;
  created_at: string;
}

export const ContractEventSubscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<ContractEventSubscription[]>([]);
  const [stats, setStats] = useState({
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    pausedSubscriptions: 0,
    erroredSubscriptions: 0,
    totalDeliveries: 0,
    averageLatencyMs: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [selectedSub, setSelectedSub] = useState<ContractEventSubscription | null>(null);
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLog[]>([]);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    contract_address: "",
    network: "stellar-mainnet",
    event_topics: "deposit,withdraw",
    delivery_target: "webhook",
    webhookUrl: "https://example.com/webhooks/contract-events",
    rate_limit_per_min: 60,
    retry_limit: 3,
  });

  // Test Event State
  const [testPayload, setTestPayload] = useState(
    JSON.stringify({ amount: 5000, asset: "USDC", sender: "GBZXN7PIRZGNMHGA7MUUUF4" }, null, 2)
  );
  const [testTopic, setTestTopic] = useState("deposit");
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    fetchSubscriptions();
    fetchStats();
  }, [search, statusFilter, networkFilter]);

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (networkFilter !== "all") params.append("network", networkFilter);

      const res = await fetch(`/api/v1/contract-subscriptions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data.subscriptions || []);
      } else {
        // Fallback for standalone/mock testing
        setSubscriptions([
          {
            id: "sub_demo_1",
            name: "USDC Bridge Escrow Subscriptions",
            description: "Tracks Soroban lock and mint cross-chain events",
            contract_address: "CA3D5KRYMCMV244BH7AVWDTNOY4HDICWKQ5RGYDYP6K2C",
            network: "stellar-mainnet",
            event_topics: ["deposit", "mint", "lock"],
            filter_rules: { operator: "AND", rules: [{ field: "amount", operator: "gt", value: 1000 }] },
            delivery_target: "webhook",
            delivery_config: { webhookUrl: "https://api.bridge-ops.internal/events" },
            status: "active",
            rate_limit_per_min: 120,
            retry_limit: 3,
            batch_size: 1,
            delivered_count: 14820,
            failed_count: 12,
            last_delivered_at: new Date().toISOString(),
            last_failure_reason: null,
            created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
          },
          {
            id: "sub_demo_2",
            name: "EVM Custody Transfer Stream",
            description: "Monitors withdrawal burns from secondary settlement contract",
            contract_address: "CBZZ76543KRYMCMV244BH7AVWDTNOY4HDICWKQ5RGYDYP6K",
            network: "stellar-testnet",
            event_topics: ["withdraw", "burn"],
            filter_rules: {},
            delivery_target: "websocket",
            delivery_config: {},
            status: "paused",
            rate_limit_per_min: 60,
            retry_limit: 3,
            batch_size: 1,
            delivered_count: 3200,
            failed_count: 0,
            last_delivered_at: new Date(Date.now() - 3600000).toISOString(),
            last_failure_reason: null,
            created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.error("Failed to load subscriptions", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/v1/contract-subscriptions/stats/summary");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      } else {
        setStats({
          totalSubscriptions: 2,
          activeSubscriptions: 1,
          pausedSubscriptions: 1,
          erroredSubscriptions: 0,
          totalDeliveries: 18020,
          averageLatencyMs: 38,
        });
      }
    } catch {
      setStats({
        totalSubscriptions: 2,
        activeSubscriptions: 1,
        pausedSubscriptions: 1,
        erroredSubscriptions: 0,
        totalDeliveries: 18020,
        averageLatencyMs: 38,
      });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const topics = formData.event_topics.split(",").map((t) => t.trim()).filter(Boolean);
    const body = {
      name: formData.name,
      description: formData.description,
      contract_address: formData.contract_address,
      network: formData.network,
      event_topics: topics,
      delivery_target: formData.delivery_target,
      delivery_config: formData.delivery_target === "webhook" ? { webhookUrl: formData.webhookUrl } : {},
      rate_limit_per_min: Number(formData.rate_limit_per_min),
      retry_limit: Number(formData.retry_limit),
    };

    try {
      const res = await fetch("/api/v1/contract-subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCreateModal(false);
        fetchSubscriptions();
        fetchStats();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const togglePause = async (sub: ContractEventSubscription) => {
    const endpoint = sub.status === "active" ? "pause" : "resume";
    try {
      await fetch(`/api/v1/contract-subscriptions/${sub.id}/${endpoint}`, { method: "POST" });
      fetchSubscriptions();
      fetchStats();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this subscription?")) return;
    try {
      await fetch(`/api/v1/contract-subscriptions/${id}`, { method: "DELETE" });
      fetchSubscriptions();
      fetchStats();
    } catch (err) {
      console.error(err);
    }
  };

  const openTestModal = (sub: ContractEventSubscription) => {
    setSelectedSub(sub);
    setTestTopic(sub.event_topics[0] || "deposit");
    setTestResult(null);
    setShowTestModal(true);
  };

  const runTest = async () => {
    if (!selectedSub) return;
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(testPayload);
      } catch {
        alert("Invalid JSON payload");
        return;
      }

      const res = await fetch(`/api/v1/contract-subscriptions/${selectedSub.id}/test-event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `test_evt_${Date.now()}`,
          contract_address: selectedSub.contract_address,
          network: selectedSub.network,
          topic: testTopic,
          data: parsed,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openLogsModal = async (sub: ContractEventSubscription) => {
    setSelectedSub(sub);
    setShowLogsModal(true);
    try {
      const res = await fetch(`/api/v1/contract-subscriptions/${sub.id}/deliveries?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setDeliveryLogs(data.logs || []);
      } else {
        setDeliveryLogs([
          {
            id: "del_sample_1",
            subscription_id: sub.id,
            event_id: "evt_991823",
            contract_address: sub.contract_address,
            topic: sub.event_topics[0] || "deposit",
            payload: { amount: 2500, asset: "USDC", sender: "GAAA..." },
            delivery_status: "delivered",
            status_code: 200,
            latency_ms: 28,
            error_message: null,
            attempt: 1,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Contract Event Subscription Registry
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Configure, filter, and dispatch real-time smart contract events across Stellar and cross-chain bridges
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
        >
          + Register Subscription
        </button>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Subscriptions</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">{stats.totalSubscriptions}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-xs font-medium text-green-600 dark:text-green-400">Active</div>
          <div className="text-xl font-bold text-green-600 dark:text-green-400 mt-1">{stats.activeSubscriptions}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Paused</div>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.pausedSubscriptions}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-xs font-medium text-red-600 dark:text-red-400">Errored</div>
          <div className="text-xl font-bold text-red-600 dark:text-red-400 mt-1">{stats.erroredSubscriptions}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Deliveries</div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
            {stats.totalDeliveries.toLocaleString()}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Avg Latency</div>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">{stats.averageLatencyMs}ms</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by subscription name or contract address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="errored">Errored</option>
          </select>
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            <option value="all">All Networks</option>
            <option value="stellar-mainnet">Stellar Mainnet</option>
            <option value="stellar-testnet">Stellar Testnet</option>
          </select>
        </div>
      </div>

      {/* Subscriptions List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading subscriptions...</div>
        ) : subscriptions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No event subscriptions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 font-medium">
                <tr>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">Contract & Network</th>
                  <th className="px-4 py-3">Topics</th>
                  <th className="px-4 py-3">Delivery Target</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Delivered</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-750">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900 dark:text-white">{sub.name}</div>
                      {sub.description && (
                        <div className="text-xs text-gray-500 truncate max-w-xs">{sub.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-blue-600 dark:text-blue-400">
                        {sub.contract_address.substring(0, 8)}...{sub.contract_address.substring(sub.contract_address.length - 6)}
                      </div>
                      <span className="text-xs text-gray-400">{sub.network}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {sub.event_topics.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 text-xs rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 font-mono">
                        {sub.delivery_target}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 text-xs rounded-full font-medium ${
                          sub.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : sub.status === "paused"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        }`}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {sub.delivered_count.toLocaleString()}
                      </div>
                      {sub.failed_count > 0 && (
                        <div className="text-xs text-red-500">{sub.failed_count} failed</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => openTestModal(sub)}
                        className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                      >
                        Dry Run
                      </button>
                      <button
                        onClick={() => openLogsModal(sub)}
                        className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                      >
                        Logs
                      </button>
                      <button
                        onClick={() => togglePause(sub)}
                        className="px-2 py-1 text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 rounded transition-colors"
                      >
                        {sub.status === "active" ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => handleDelete(sub.id)}
                        className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Register Event Subscription</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. USDC Lock Events"
                  className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Contract Address</label>
                <input
                  type="text"
                  required
                  value={formData.contract_address}
                  onChange={(e) => setFormData({ ...formData, contract_address: e.target.value })}
                  placeholder="e.g. CA3D5KRYMCMV244BH7AVWDTNO..."
                  className="w-full mt-1 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Network</label>
                  <select
                    value={formData.network}
                    onChange={(e) => setFormData({ ...formData, network: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="stellar-mainnet">Stellar Mainnet</option>
                    <option value="stellar-testnet">Stellar Testnet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Delivery Target</label>
                  <select
                    value={formData.delivery_target}
                    onChange={(e) => setFormData({ ...formData, delivery_target: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
                  >
                    <option value="webhook">Webhook HTTP/HTTPS</option>
                    <option value="websocket">WebSocket Stream</option>
                    <option value="queue">Internal SQS/Queue</option>
                    <option value="kafka">Kafka Topic</option>
                  </select>
                </div>
              </div>
              {formData.delivery_target === "webhook" && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Webhook URL</label>
                  <input
                    type="url"
                    required
                    value={formData.webhookUrl}
                    onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Event Topics (comma separated)
                </label>
                <input
                  type="text"
                  required
                  value={formData.event_topics}
                  onChange={(e) => setFormData({ ...formData, event_topics: e.target.value })}
                  placeholder="deposit, withdraw, mint, burn"
                  className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
                >
                  Create Subscription
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dry Run Test Modal */}
      {showTestModal && selectedSub && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Dry Run Test Event</h2>
            <p className="text-xs text-gray-500">Test incoming event payload against subscription rules</p>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Topic</label>
              <input
                type="text"
                value={testTopic}
                onChange={(e) => setTestTopic(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">JSON Payload</label>
              <textarea
                rows={4}
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg"
              />
            </div>
            <button
              onClick={runTest}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium text-sm rounded-lg"
            >
              Evaluate Match
            </button>
            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs ${
                  testResult.matches
                    ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                    : "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300"
                }`}
              >
                <div className="font-bold">Match Result: {testResult.matches ? "MATCHED" : "REJECTED"}</div>
                <div>{testResult.reason}</div>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Drawer/Modal */}
      {showLogsModal && selectedSub && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-xl border border-gray-200 dark:border-gray-700 max-h-[80vh] flex flex-col">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Delivery Logs: {selectedSub.name}</h2>
            <div className="flex-1 overflow-y-auto space-y-2">
              {deliveryLogs.length === 0 ? (
                <div className="text-gray-500 text-sm text-center py-4">No recent deliveries recorded</div>
              ) : (
                deliveryLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 text-xs flex justify-between items-center"
                  >
                    <div>
                      <div className="font-mono text-gray-700 dark:text-gray-300 font-semibold">{log.topic}</div>
                      <div className="text-gray-400 text-[10px]">{new Date(log.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-gray-500">{log.latency_ms}ms</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          log.delivery_status === "delivered"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {log.delivery_status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowLogsModal(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractEventSubscriptions;
