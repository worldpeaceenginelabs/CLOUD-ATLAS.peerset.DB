<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();
  
  // Props
  export let peerTraffic: Record<string, { 
    sent: { rootHashes: number; subtrees: number; records: number }; 
    recv: { rootHashes: number; subtrees: number; records: number } 
  }> = {};
  
  // Local state for message logs per peer
  let peerMessages: Record<string, Array<{
    timestamp: string;
    type: 'sent' | 'received';
    channel: 'rootHash' | 'records' | 'subtree';
    data: any;
    size: number;
  }>> = {};
  
  // Terminal window state
  let terminalWindows: Array<{
    peerId: string;
    isMinimized: boolean;
    isMaximized: boolean;
  }> = [];
  
  // Track previous peer traffic to detect changes
  let previousPeerTraffic = {};
  
  // Function to add a message to a peer's log
  function addMessage(peerId: string, type: 'sent' | 'received', channel: 'rootHash' | 'records' | 'subtree', data: any) {
    if (!peerMessages[peerId]) {
      peerMessages[peerId] = [];
    }
    
    const message = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      channel,
      data,
      size: JSON.stringify(data).length
    };
    
    peerMessages[peerId].push(message);
    
    // Keep only last 100 messages per peer to prevent memory issues
    if (peerMessages[peerId].length > 100) {
      peerMessages[peerId] = peerMessages[peerId].slice(-100);
    }
    
    // Trigger reactivity
    peerMessages = { ...peerMessages };
  }
  
  // Function to create a terminal window for a new peer
  function createTerminalWindow(peerId: string) {
    if (!terminalWindows.find(w => w.peerId === peerId)) {
      terminalWindows.push({
        peerId,
        isMinimized: false,
        isMaximized: false
      });
      terminalWindows = [...terminalWindows];
    }
  }
  
  // Function to remove a terminal window when peer leaves
  function removeTerminalWindow(peerId: string) {
    terminalWindows = terminalWindows.filter(w => w.peerId !== peerId);
    delete peerMessages[peerId];
    peerMessages = { ...peerMessages };
  }
  
  // Function to toggle terminal window state
  function toggleMinimize(peerId: string) {
    const window = terminalWindows.find(w => w.peerId === peerId);
    if (window) {
      window.isMinimized = !window.isMinimized;
      terminalWindows = [...terminalWindows];
    }
  }
  
  function toggleMaximize(peerId: string) {
    const window = terminalWindows.find(w => w.peerId === peerId);
    if (window) {
      window.isMaximized = !window.isMaximized;
      terminalWindows = [...terminalWindows];
    }
  }
  
  // Function to clear messages for a peer
  function clearMessages(peerId: string) {
    if (peerMessages[peerId]) {
      peerMessages[peerId] = [];
      peerMessages = { ...peerMessages };
    }
  }
  
  // Function to get message count for a peer
  function getMessageCount(peerId: string): number {
    return peerMessages[peerId]?.length || 0;
  }
  
  // Function to get recent messages for a peer
  function getRecentMessages(peerId: string, count: number = 20) {
    const messages = peerMessages[peerId] || [];
    return messages.slice(-count);
  }
  
  // Function to format message for display
  function formatMessage(message: any): string {
    if (message.channel === 'rootHash') {
      return `Root Hash: ${message.data.merkleRoot?.substring(0, 16)}...`;
    } else if (message.channel === 'records') {
      if (message.data.count) {
        return `Records (${message.data.count}): ${message.data.records}`;
      } else {
        const recordCount = Object.keys(message.data).length;
        return `Records (${recordCount}): ${Object.keys(message.data).slice(0, 3).join(', ')}${recordCount > 3 ? '...' : ''}`;
      }
    } else if (message.channel === 'subtree') {
      if (message.data.requestSubtreeHashes) {
        return `Subtree Request: ${message.data.requestSubtreeHashes.path || 'root'} (depth: ${message.data.requestSubtreeHashes.depth})`;
      } else if (message.data.subtreeHashes) {
        return `Subtree Response: ${message.data.subtreeHashes.length} hashes`;
      } else if (message.data.requestRecords) {
        return `Record Request: ${message.data.requestRecords.length} records`;
      }
    }
    return `Data (${message.size} bytes)`;
  }
  
  // Watch for peer traffic changes to simulate message logging
  $: if (peerTraffic) {
    // Check for new peers
    const currentPeers = Object.keys(peerTraffic);
    const previousPeers = Object.keys(previousPeerTraffic);
    
    // Add new peers
    for (const peerId of currentPeers) {
      if (!previousPeers.includes(peerId)) {
        createTerminalWindow(peerId);
        addMessage(peerId, 'received', 'rootHash', { merkleRoot: 'connecting...' });
      }
    }
    
    // Remove left peers
    for (const peerId of previousPeers) {
      if (!currentPeers.includes(peerId)) {
        removeTerminalWindow(peerId);
      }
    }
    
    // Check for traffic changes and add messages
    for (const [peerId, traffic] of Object.entries(peerTraffic)) {
      const prevTraffic = previousPeerTraffic[peerId];
      if (prevTraffic) {
        // Check for sent messages
        if (traffic.sent.rootHashes > prevTraffic.sent.rootHashes) {
          addMessage(peerId, 'sent', 'rootHash', { merkleRoot: 'current_root_hash' });
        }
        if (traffic.sent.records > prevTraffic.sent.records) {
          const recordCount = traffic.sent.records - prevTraffic.sent.records;
          addMessage(peerId, 'sent', 'records', { count: recordCount, records: `batch_${Date.now()}` });
        }
        if (traffic.sent.subtrees > prevTraffic.sent.subtrees) {
          addMessage(peerId, 'sent', 'subtree', { requestSubtreeHashes: { path: 'root', depth: 2 } });
        }
        
        // Check for received messages
        if (traffic.recv.rootHashes > prevTraffic.recv.rootHashes) {
          addMessage(peerId, 'received', 'rootHash', { merkleRoot: 'remote_root_hash' });
        }
        if (traffic.recv.records > prevTraffic.recv.records) {
          const recordCount = traffic.recv.records - prevTraffic.recv.records;
          addMessage(peerId, 'received', 'records', { count: recordCount, records: `batch_${Date.now()}` });
        }
        if (traffic.recv.subtrees > prevTraffic.recv.subtrees) {
          addMessage(peerId, 'received', 'subtree', { subtreeHashes: [{ path: 'root', hash: 'abc123...' }] });
        }
      }
    }
    
    previousPeerTraffic = JSON.parse(JSON.stringify(peerTraffic));
  }
  
  // Expose functions for external use
  export function logMessage(peerId: string, type: 'sent' | 'received', channel: 'rootHash' | 'records' | 'subtree', data: any) {
    addMessage(peerId, type, channel, data);
  }
</script>

<div class="datachannel-view">
  <div class="header">
    <h3>Data Channel View - Real-time Peer Communication</h3>
    <div class="controls">
      <button on:click={() => terminalWindows.forEach(w => w.isMinimized = false)} class="btn-small">
        Expand All
      </button>
      <button on:click={() => terminalWindows.forEach(w => w.isMinimized = true)} class="btn-small">
        Minimize All
      </button>
    </div>
  </div>
  
  <div class="terminals-container">
    {#each terminalWindows as window (window.peerId)}
      <div class="terminal-window" class:minimized={window.isMinimized} class:maximized={window.isMaximized}>
        <div class="terminal-header">
          <div class="terminal-title">
            <span class="peer-id">Peer: {window.peerId.substring(0, 8)}...</span>
            <span class="message-count">({getMessageCount(window.peerId)} messages)</span>
          </div>
          <div class="terminal-controls">
            <button on:click={() => clearMessages(window.peerId)} class="btn-clear" title="Clear messages">×</button>
            <button on:click={() => toggleMinimize(window.peerId)} class="btn-minimize" title="Minimize">
              {window.isMinimized ? '□' : '−'}
            </button>
            <button on:click={() => toggleMaximize(window.peerId)} class="btn-maximize" title="Maximize">
              {window.isMaximized ? '⊡' : '⊞'}
            </button>
          </div>
        </div>
        
        {#if !window.isMinimized}
          <div class="terminal-body">
            <div class="terminal-content">
              {#each getRecentMessages(window.peerId, 15) as message}
                <div class="message-line" class:sent={message.type === 'sent'} class:received={message.type === 'received'}>
                  <span class="timestamp">[{message.timestamp}]</span>
                  <span class="direction">{message.type === 'sent' ? '→' : '←'}</span>
                  <span class="channel">[{message.channel}]</span>
                  <span class="message-data">{formatMessage(message)}</span>
                </div>
              {/each}
              {#if getMessageCount(window.peerId) === 0}
                <div class="no-messages">No messages yet...</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
    
    {#if terminalWindows.length === 0}
      <div class="no-peers">
        <div class="no-peers-content">
          <div class="no-peers-icon">📡</div>
          <div class="no-peers-text">No peers connected</div>
          <div class="no-peers-subtext">Terminal windows will appear when peers join</div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .datachannel-view {
    width: 100%;
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    box-shadow: var(--glass-shadow);
    overflow: hidden;
    margin: 20px 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .datachannel-view:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
    box-shadow: var(--glass-shadow-hover);
    transform: translateY(-2px);
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: var(--glass-bg-hover);
    border-bottom: 1px solid var(--glass-border);
  }
  
  .header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 600;
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .controls {
    display: flex;
    gap: 8px;
  }
  
  .btn-small {
    padding: 8px 16px;
    background: var(--glass-bg);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.3s ease;
  }
  
  .btn-small:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
    transform: translateY(-1px);
  }
  
  .terminals-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 12px;
    padding: 12px;
    max-height: 400px;
    overflow-y: auto;
  }
  
  .terminal-window {
    background: var(--glass-bg);
    backdrop-filter: blur(15px);
    -webkit-backdrop-filter: blur(15px);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }
  
  .terminal-window:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }
  
  .terminal-window.minimized {
    height: 40px;
  }
  
  .terminal-window.maximized {
    grid-column: 1 / -1;
    height: 300px;
  }
  
  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--glass-bg-hover);
    border-bottom: 1px solid var(--glass-border);
  }
  
  .terminal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
  }
  
  .peer-id {
    color: var(--accent-success);
    font-weight: 700;
  }
  
  .message-count {
    color: var(--text-secondary);
    font-weight: 500;
  }
  
  .terminal-controls {
    display: flex;
    gap: 4px;
  }
  
  .btn-clear, .btn-minimize, .btn-maximize {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .btn-clear {
    background: #ff4444;
    color: white;
  }
  
  .btn-minimize {
    background: #ffaa00;
    color: white;
  }
  
  .btn-maximize {
    background: #00aa00;
    color: white;
  }
  
  .btn-clear:hover, .btn-minimize:hover, .btn-maximize:hover {
    opacity: 0.8;
  }
  
  .terminal-body {
    height: 200px;
    overflow-y: auto;
    background: var(--glass-bg);
  }
  
  .terminal-content {
    padding: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  
  .message-line {
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .message-line.sent {
    color: var(--accent-success);
  }
  
  .message-line.received {
    color: var(--accent-primary);
  }
  
  .timestamp {
    color: var(--text-muted);
    font-size: 10px;
  }
  
  .direction {
    font-weight: bold;
    font-size: 14px;
  }
  
  .channel {
    color: var(--accent-warning);
    font-weight: bold;
    font-size: 10px;
  }
  
  .message-data {
    color: var(--text-primary);
    flex: 1;
  }
  
  .no-messages {
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
    padding: 20px;
  }
  
  .no-peers {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
  }
  
  .no-peers-content {
    text-align: center;
    color: var(--text-muted);
  }
  
  .no-peers-icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.7;
  }
  
  .no-peers-text {
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 4px;
    color: var(--text-secondary);
  }
  
  .no-peers-subtext {
    font-size: 12px;
    color: var(--text-muted);
  }
  
  /* Scrollbar styling */
  .terminal-body::-webkit-scrollbar {
    width: 6px;
  }
  
  .terminal-body::-webkit-scrollbar-track {
    background: var(--glass-bg);
    border-radius: 3px;
  }
  
  .terminal-body::-webkit-scrollbar-thumb {
    background: var(--glass-border);
    border-radius: 3px;
    transition: background 0.3s ease;
  }
  
  .terminal-body::-webkit-scrollbar-thumb:hover {
    background: var(--glass-border-hover);
  }
</style>
