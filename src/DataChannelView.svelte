<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { terminalLogger, type LogMessage } from './terminalLogger.js';
  
  const dispatch = createEventDispatcher();
  
  // Props
  export let currentMerkleRoot: string = '';
  export let p2pMessageData: Record<string, Array<{
    timestamp: string;
    type: 'sent' | 'received';
    channel: 'rootHash' | 'records' | 'subtree';
    data: any;
    size: number;
  }>> = {};
  
  // Local state for client's comprehensive log
  let clientMessages: LogMessage[] = [];
  
  // Terminal window state
  let isMinimized = false;
  let isMaximized = false;
  let expandedMessages: Set<number> = new Set();
  
  // Subscribe to terminal logger updates
  onMount(() => {
    const unsubscribe = terminalLogger.subscribe((messages) => {
      clientMessages = messages;
    });
    
    return unsubscribe;
  });
  
  // Function to toggle terminal window state
  function toggleMinimize() {
    isMinimized = !isMinimized;
  }
  
  function toggleMaximize() {
    isMaximized = !isMaximized;
  }
  
  // Function to clear messages
  function clearMessages() {
    terminalLogger.clear();
  }

  // Function to toggle message expansion
  function toggleMessageExpansion(index: number) {
    if (expandedMessages.has(index)) {
      expandedMessages.delete(index);
    } else {
      expandedMessages.add(index);
    }
    expandedMessages = expandedMessages; // Trigger reactivity
  }
  
  // Function to format message for display
  function formatMessage(message: any): string {
    const peerInfo = message.peerId ? `[${message.peerId.substring(0, 8)}] ` : '';
    
    if (message.channel === 'rootHash') {
      if (message.data.merkleRoot) {
        return `${peerInfo}Root Hash: ${message.data.merkleRoot}`;
      }
      return `${peerInfo}Root Hash: ${JSON.stringify(message.data)}`;
    } else if (message.channel === 'records') {
      const recordCount = Object.keys(message.data).length;
      const recordIds = Object.keys(message.data).slice(0, 3);
      const recordDetails = recordIds.map(id => {
        const record = message.data[id];
        return `${id.substring(0, 8)}:${record.integrity?.hash?.substring(0, 8) || 'no-hash'}`;
      }).join(', ');
      return `${peerInfo}Records (${recordCount}): ${recordDetails}${recordCount > 3 ? '...' : ''}`;
    } else if (message.channel === 'subtree') {
      if (message.data.requestSubtreeHashes) {
        return `${peerInfo}Subtree Request: path="${message.data.requestSubtreeHashes.path || 'root'}" depth=${message.data.requestSubtreeHashes.depth}`;
      } else if (message.data.subtreeHashes) {
        const hashDetails = message.data.subtreeHashes.map(subtree => 
          `${subtree.path}:${subtree.hash.substring(0, 8)}(${subtree.uuids.length}uuids)`
        ).join(', ');
        return `${peerInfo}Subtree Response (${message.data.subtreeHashes.length}): ${hashDetails}`;
      } else if (message.data.requestRecords) {
        const recordIds = message.data.requestRecords.slice(0, 5).map(id => id.substring(0, 8)).join(', ');
        return `${peerInfo}Record Request (${message.data.requestRecords.length}): ${recordIds}${message.data.requestRecords.length > 5 ? '...' : ''}`;
      }
      return `${peerInfo}Subtree: ${JSON.stringify(message.data)}`;
    } else if (message.channel === 'connection') {
      return `${peerInfo}${message.data}`;
    } else if (message.channel === 'sync') {
      return `${peerInfo}${message.data}`;
    } else if (message.channel === 'moderation') {
      return `${peerInfo}Moderation: ${message.data}`;
    } else if (message.channel === 'database') {
      return `${peerInfo}Database: ${message.data}`;
    } else if (message.channel === 'merkle') {
      return `${peerInfo}Merkle: ${message.data}`;
    } else if (message.channel === 'internal') {
      return `${peerInfo}Internal: ${message.data}`;
    }
    return `${peerInfo}Data (${message.size} bytes)`;
  }
  
  // Watch for P2P message data changes to log them
  $: if (p2pMessageData) {
    for (const [peerId, messages] of Object.entries(p2pMessageData)) {
      if (messages && messages.length > 0) {
        // Log each P2P message to the terminal logger
        for (const msg of messages) {
          terminalLogger.logP2PMessage(msg.type, msg.channel, msg.data, peerId);
        }
      }
    }
  }
  
  // Expose functions for external use
  export function logMessage(
    type: 'sent' | 'received' | 'system' | 'error' | 'debug', 
    channel: 'rootHash' | 'records' | 'subtree' | 'connection' | 'sync' | 'moderation' | 'database' | 'merkle' | 'internal', 
    data: any, 
    peerId?: string,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info'
  ) {
    terminalLogger.log(type, channel, data, peerId, level);
  }
</script>

<div class="datachannel-view">
  <div class="header">
    <h3>{currentMerkleRoot ? currentMerkleRoot.substring(0, 16) + '...' : 'Loading...'}</h3>
    <div class="controls">
      <button on:click={clearMessages} class="btn-small">
        Clear Log
      </button>
    </div>
  </div>
  
  <div class="terminal-container">
    <div class="terminal-window" class:minimized={isMinimized} class:maximized={isMaximized}>
      <div class="terminal-header">
        <div class="terminal-title">
          <span class="client-label">Client Terminal</span>
          <span class="message-count">({clientMessages.length} messages)</span>
        </div>
        <div class="terminal-controls">
          <button on:click={clearMessages} class="btn-clear" title="Clear messages">×</button>
          <button on:click={toggleMinimize} class="btn-minimize" title="Minimize">
            {isMinimized ? '□' : '−'}
          </button>
          <button on:click={toggleMaximize} class="btn-maximize" title="Maximize">
            {isMaximized ? '⊡' : '⊞'}
          </button>
        </div>
      </div>
      
        {#if !isMinimized}
          <div class="terminal-body">
            <div class="terminal-content">
              {#each clientMessages as message, index}
                <div class="message-block" 
                     class:sent={message.type === 'sent'} 
                     class:received={message.type === 'received'}
                     class:system={message.type === 'system'}
                     class:error={message.type === 'error'}
                     class:debug={message.type === 'debug'}
                     class:level-info={message.level === 'info'}
                     class:level-warn={message.level === 'warn'}
                     class:level-error={message.level === 'error'}
                     class:level-debug={message.level === 'debug'}>
                  <div class="message-header">
                    <span class="timestamp">[{message.timestamp}]</span>
                    <span class="direction">
                      {#if message.type === 'sent'}
                        →
                      {:else if message.type === 'received'}
                        ←
                      {:else if message.type === 'system'}
                        ⚙
                      {:else if message.type === 'error'}
                        ✗
                      {:else if message.type === 'debug'}
                        🔍
                      {/if}
                    </span>
                    <span class="channel">[{message.channel}]</span>
                    {#if message.channel === 'rootHash' || message.channel === 'records' || message.channel === 'subtree'}
                      <button class="expand-btn" on:click={() => toggleMessageExpansion(index)}>
                        {expandedMessages.has(index) ? '▼' : '▶'}
                      </button>
                    {/if}
                  </div>
                  <div class="message-data">{formatMessage(message)}</div>
                  {#if expandedMessages.has(index) && (message.channel === 'rootHash' || message.channel === 'records' || message.channel === 'subtree')}
                    <div class="raw-data">
                      <pre>{JSON.stringify(message.data, null, 2)}</pre>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if clientMessages.length === 0}
                <div class="no-messages">No messages yet...</div>
              {/if}
            </div>
          </div>
        {/if}
    </div>
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
    box-sizing: border-box;
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
  
  .terminal-container {
    padding: 12px;
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
    height: 600px;
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
  
  .client-label {
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
    height: 400px;
    overflow-y: auto;
    background: var(--glass-bg);
  }
  
  /* Responsive adjustments for mobile screens */
  @media (max-width: 480px) {
    .datachannel-view {
      margin: 10px 0;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    
    .header {
      padding: 12px 16px;
    }
    
    .header h3 {
      font-size: 16px;
    }
    
    .terminal-container {
      padding: 8px;
    }
    
    .terminal-body {
      height: 300px;
    }
    
    .terminal-content {
      padding: 8px;
      font-size: 11px;
    }
    
    .message-block {
      padding: 4px 6px;
      margin-bottom: 6px;
    }
    
    .message-header {
      gap: 6px;
      font-size: 10px;
    }
    
    .timestamp {
      font-size: 9px;
    }
    
    .channel {
      font-size: 9px;
    }
  }
  
  @media (max-width: 420px) {
    .datachannel-view {
      margin: 8px 0;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    
    .header {
      padding: 10px 12px;
    }
    
    .header h3 {
      font-size: 14px;
    }
    
    .terminal-container {
      padding: 6px;
    }
    
    .terminal-body {
      height: 250px;
    }
    
    .terminal-content {
      padding: 6px;
      font-size: 10px;
    }
    
    .message-block {
      padding: 3px 5px;
      margin-bottom: 5px;
    }
    
    .message-header {
      gap: 4px;
      font-size: 9px;
    }
    
    .timestamp {
      font-size: 8px;
    }
    
    .channel {
      font-size: 8px;
    }
  }
  
  @media (max-width: 360px) {
    .datachannel-view {
      margin: 6px 0;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    
    .header {
      padding: 8px 10px;
    }
    
    .header h3 {
      font-size: 12px;
    }
    
    .terminal-container {
      padding: 4px;
    }
    
    .terminal-body {
      height: 200px;
    }
    
    .terminal-content {
      padding: 4px;
      font-size: 9px;
    }
    
    .message-block {
      padding: 2px 4px;
      margin-bottom: 4px;
    }
    
    .message-header {
      gap: 3px;
      font-size: 8px;
    }
    
    .timestamp {
      font-size: 7px;
    }
    
    .channel {
      font-size: 7px;
    }
  }
  
  .terminal-content {
    padding: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  
  .message-block {
    margin-bottom: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
    border-left: 3px solid transparent;
    transition: all 0.2s ease;
  }
  
  .message-block:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  .message-block.sent {
    border-left-color: var(--accent-success);
  }
  
  .message-block.received {
    border-left-color: var(--accent-primary);
  }
  
  .message-block.system {
    border-left-color: var(--accent-warning);
  }
  
  .message-block.error {
    color: #ff4444;
    background: rgba(255, 68, 68, 0.1);
    border-left-color: #ff4444;
  }
  
  .message-block.debug {
    color: var(--text-muted);
    opacity: 0.8;
  }
  
  .message-block.level-warn {
    background: rgba(255, 170, 0, 0.1);
    border-left-color: #ffaa00;
  }
  
  .message-block.level-error {
    background: rgba(255, 68, 68, 0.1);
    border-left-color: #ff4444;
  }
  
  .message-block.level-debug {
    opacity: 0.7;
  }
  
  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 11px;
  }
  
  .message-data {
    color: var(--text-primary);
    font-size: 12px;
    line-height: 1.4;
    padding-left: 0;
    word-break: break-word;
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

  .expand-btn {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 3px;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 10px;
    padding: 2px 6px;
    margin-left: 8px;
    transition: all 0.2s ease;
  }

  .expand-btn:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hover);
  }

  .raw-data {
    margin-top: 8px;
    padding: 8px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 4px;
    border-left: 2px solid var(--accent-primary);
  }

  .raw-data pre {
    margin: 0;
    font-size: 10px;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  }
  
  
  .no-messages {
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
    padding: 20px;
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
