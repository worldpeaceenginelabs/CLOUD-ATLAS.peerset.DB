// Comprehensive terminal logging system for P2P operations
export interface LogMessage {
  timestamp: string;
  type: 'sent' | 'received' | 'system' | 'error' | 'debug';
  channel: 'rootHash' | 'records' | 'subtree' | 'connection' | 'sync' | 'moderation' | 'database' | 'merkle' | 'internal';
  data: any;
  size: number;
  peerId?: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

class TerminalLogger {
  private messages: LogMessage[] = [];
  private maxMessages = 1000; // Increased for comprehensive logging
  private listeners: Array<(messages: LogMessage[]) => void> = [];

  // Subscribe to log updates
  subscribe(listener: (messages: LogMessage[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Get all messages
  getMessages(): LogMessage[] {
    return [...this.messages];
  }

  // Add a log message
  log(
    type: 'sent' | 'received' | 'system' | 'error' | 'debug',
    channel: 'rootHash' | 'records' | 'subtree' | 'connection' | 'sync' | 'moderation' | 'database' | 'merkle' | 'internal',
    data: any,
    peerId?: string,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info'
  ) {
    const message: LogMessage = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      channel,
      data,
      size: JSON.stringify(data).length,
      peerId,
      level
    };

    this.messages.push(message);

    // Keep only last maxMessages
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    // Notify listeners
    this.listeners.forEach(listener => listener([...this.messages]));
  }

  // Clear all messages
  clear() {
    this.messages = [];
    this.listeners.forEach(listener => listener([...this.messages]));
  }

  // Convenience methods for different log types
  logConnection(message: string, peerId?: string) {
    this.log('system', 'connection', message, peerId);
  }

  logSync(message: string, peerId?: string) {
    this.log('system', 'sync', message, peerId);
  }

  logModeration(message: string, peerId?: string) {
    this.log('system', 'moderation', message, peerId);
  }

  logDatabase(message: string, peerId?: string) {
    this.log('system', 'database', message, peerId);
  }

  logMerkle(message: string, peerId?: string) {
    this.log('system', 'merkle', message, peerId);
  }

  logInternal(message: string, peerId?: string) {
    this.log('debug', 'internal', message, peerId);
  }

  logError(message: string, error?: any, peerId?: string) {
    this.log('error', 'internal', `${message}${error ? ': ' + error.toString() : ''}`, peerId, 'error');
  }

  logP2PMessage(type: 'sent' | 'received', channel: 'rootHash' | 'records' | 'subtree', data: any, peerId: string) {
    this.log(type, channel, data, peerId);
  }

  // Log bare input/output data to console only
  logInputOutput(type: 'input' | 'output', data: any, peerId?: string) {
    const prefix = peerId ? `[${peerId.substring(0, 8)}] ` : '';
    const direction = type === 'input' ? '←' : '→';
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${prefix}${direction} ${JSON.stringify(data, null, 2)}`);
  }

  // Log detailed P2P data for debugging
  logDetailedP2P(type: 'sent' | 'received', channel: 'rootHash' | 'records' | 'subtree', data: any, peerId: string) {
    const prefix = `[${peerId.substring(0, 8)}] `;
    const direction = type === 'sent' ? '→' : '←';
    
    let details = '';
    if (channel === 'rootHash') {
      details = `Root Hash: ${data.merkleRoot || 'unknown'}`;
    } else if (channel === 'records') {
      const count = Object.keys(data).length;
      const sample = Object.keys(data).slice(0, 2).map(id => {
        const record = data[id];
        return `${id.substring(0, 8)}:${record.integrity?.hash?.substring(0, 8) || 'no-hash'}`;
      }).join(', ');
      details = `Records (${count}): ${sample}${count > 2 ? '...' : ''}`;
    } else if (channel === 'subtree') {
      if (data.requestSubtreeHashes) {
        details = `Subtree Request: path="${data.requestSubtreeHashes.path || 'root'}" depth=${data.requestSubtreeHashes.depth}`;
      } else if (data.subtreeHashes) {
        const hashDetails = data.subtreeHashes.map(subtree => 
          `${subtree.path}:${subtree.hash.substring(0, 8)}(${subtree.uuids.length}uuids)`
        ).join(', ');
        details = `Subtree Response (${data.subtreeHashes.length}): ${hashDetails}`;
      } else if (data.requestRecords) {
        const recordIds = data.requestRecords.slice(0, 3).map(id => id.substring(0, 8)).join(', ');
        details = `Record Request (${data.requestRecords.length}): ${recordIds}${data.requestRecords.length > 3 ? '...' : ''}`;
      } else {
        details = `Subtree: ${JSON.stringify(data)}`;
      }
    }
    
    this.log(type, channel, details, peerId);
  }
}

// Export singleton instance
export const terminalLogger = new TerminalLogger();
