import { getMerkleTree, findWhatWeNeed, findWhatRemoteNeeds, type MerkleNode } from './merkleTree.js';

// --- Efficient Merkle Sync Protocol ---

export interface SubtreeRequest {
  // Progressive sync - request specific subtree hashes
  requestSubtreeHashes?: {
    path: string; // Path to subtree (e.g., "left.right")
    depth: number; // How deep to go
  };
  
  // Response with subtree hashes at requested depth
  subtreeHashes?: {
    path: string;
    hash: string;
    uuids: string[];
    hasChildren: boolean;
  }[];
  
  // Final request for specific records
  requestRecords?: string[];
  
  // Legacy support
  requestRoot?: boolean;
  tree?: MerkleNode;
  requestUUIDs?: string[];
}

/**
 * Efficient Merkle tree synchronization that only sends differing subtrees
 */
export class EfficientMerkleSync {
  
  /**
   * Start sync by comparing root hashes, then progressively narrow down differences
   */
  static async startSync(
    localHashes: Record<string, string>,
    remoteRootHash: string,
    sendSubtree: (data: SubtreeRequest, peerId: string) => void,
    peerId: string
  ): Promise<void> {
    const localTree = await getMerkleTree(localHashes);
    
    if (localTree.hash === remoteRootHash) {
      console.log(`[EfficientSync] Trees match with ${peerId}, no sync needed`);
      return;
    }
    
    console.log(`[EfficientSync] Root differs with ${peerId}, requesting top-level subtrees`);
    
    // Request top-level subtree hashes
    sendSubtree({
      requestSubtreeHashes: {
        path: "", // Root level
        depth: 1   // Just immediate children
      }
    }, peerId);
  }
  
  /**
   * Handle subtree hash request - send only requested subtree hashes
   */
  static async handleSubtreeHashRequest(
    request: SubtreeRequest,
    localHashes: Record<string, string>,
    sendSubtree: (data: SubtreeRequest, peerId: string) => void,
    peerId: string
  ): Promise<void> {
    if (!request.requestSubtreeHashes) return;
    
    const localTree = await getMerkleTree(localHashes);
    const { path, depth } = request.requestSubtreeHashes;
    
    // Navigate to requested subtree
    const subtree = this.getSubtreeAtPath(localTree, path);
    if (!subtree) {
      sendSubtree({ subtreeHashes: [] }, peerId);
      return;
    }
    
    // Extract hashes at requested depth
    const subtreeHashes = this.extractSubtreeHashes(subtree, path, depth);
    
    console.log(`[EfficientSync] Sending ${subtreeHashes.length} subtree hashes to ${peerId}`);
    sendSubtree({ subtreeHashes }, peerId);
  }
  
  // Batching system for record requests
  private static pendingRequests: Record<string, {
    records: Set<string>;
    timeout: NodeJS.Timeout;
    sendSubtree: (data: SubtreeRequest, peerId: string) => void;
  }> = {};
  
  private static readonly BATCH_DELAY = 100; // 100ms batching window
  private static readonly MAX_BATCH_SIZE = 50; // Max records per batch

  /**
   * Handle received subtree hashes - compare and request deeper or records
   */
  static async handleSubtreeHashes(
    request: SubtreeRequest,
    localHashes: Record<string, string>,
    sendSubtree: (data: SubtreeRequest, peerId: string) => void,
    peerId: string
  ): Promise<string[]> {
    if (!request.subtreeHashes) return [];
    
    const localTree = await getMerkleTree(localHashes);
    const neededRecords: string[] = [];
    
    for (const remoteSubtree of request.subtreeHashes) {
      const localSubtree = this.getSubtreeAtPath(localTree, remoteSubtree.path);
      
      if (!localSubtree || localSubtree.hash !== remoteSubtree.hash) {
        if (remoteSubtree.hasChildren) {
          // Recurse deeper
          console.log(`[EfficientSync] Requesting deeper subtrees at ${remoteSubtree.path}`);
          sendSubtree({
            requestSubtreeHashes: {
              path: remoteSubtree.path,
              depth: 1
            }
          }, peerId);
        } else {
          // Leaf level - batch record requests
          console.log(`[EfficientSync] Need records from leaf: ${remoteSubtree.uuids.join(', ')}`);
          neededRecords.push(...remoteSubtree.uuids);
        }
      }
    }
    
    // Batch record requests instead of sending immediately
    if (neededRecords.length > 0) {
      this.batchRecordRequest(neededRecords, peerId, sendSubtree);
    }
    
    return neededRecords;
  }
  
  /**
   * Batch multiple record requests together to reduce network overhead
   */
  private static batchRecordRequest(
    records: string[],
    peerId: string,
    sendSubtree: (data: SubtreeRequest, peerId: string) => void
  ): void {
    // Initialize pending requests for this peer if needed
    if (!this.pendingRequests[peerId]) {
      this.pendingRequests[peerId] = {
        records: new Set(),
        timeout: null as any,
        sendSubtree
      };
    }
    
    const pending = this.pendingRequests[peerId];
    
    // Add new records to batch
    records.forEach(record => pending.records.add(record));
    
    // Clear existing timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    
    // Send immediately if batch is large enough
    if (pending.records.size >= this.MAX_BATCH_SIZE) {
      this.flushRecordBatch(peerId);
      return;
    }
    
    // Otherwise, set timeout to send after delay
    pending.timeout = setTimeout(() => {
      this.flushRecordBatch(peerId);
    }, this.BATCH_DELAY);
  }
  
  /**
   * Send batched record requests
   */
  private static flushRecordBatch(peerId: string): void {
    const pending = this.pendingRequests[peerId];
    if (!pending || pending.records.size === 0) return;
    
    const recordsArray = Array.from(pending.records);
    console.log(`[EfficientSync] Requesting ${recordsArray.length} batched records from ${peerId}`);
    
    pending.sendSubtree({ requestRecords: recordsArray }, peerId);
    
    // Clear the batch
    pending.records.clear();
    if (pending.timeout) {
      clearTimeout(pending.timeout);
      pending.timeout = null as any;
    }
  }
  
  /**
   * Clean up pending batches for a peer (called on timeout/disconnect)
   */
  static cleanupPeerBatches(peerId: string): void {
    const pending = this.pendingRequests[peerId];
    if (pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      delete this.pendingRequests[peerId];
      console.log(`[EfficientSync] Cleaned up pending batches for ${peerId}`);
    }
  }
  
  /**
   * Navigate to subtree at given path (e.g., "left.right.left")
   */
  private static getSubtreeAtPath(tree: MerkleNode, path: string): MerkleNode | null {
    if (!path) return tree;
    
    let current = tree;
    const parts = path.split('.').filter(p => p);
    
    for (const part of parts) {
      if (part === 'left' && current.left) {
        current = current.left;
      } else if (part === 'right' && current.right) {
        current = current.right;
      } else {
        return null;
      }
    }
    
    return current;
  }
  
  /**
   * Extract subtree hashes at specified depth
   */
  private static extractSubtreeHashes(
    node: MerkleNode,
    basePath: string,
    depth: number
  ): Array<{ path: string; hash: string; uuids: string[]; hasChildren: boolean }> {
    if (depth === 0) {
      return [{
        path: basePath,
        hash: node.hash,
        uuids: node.uuids,
        hasChildren: !node.isLeaf && (!!node.left || !!node.right)
      }];
    }
    
    const results: Array<{ path: string; hash: string; uuids: string[]; hasChildren: boolean }> = [];
    
    if (node.left) {
      const leftPath = basePath ? `${basePath}.left` : 'left';
      results.push(...this.extractSubtreeHashes(node.left, leftPath, depth - 1));
    }
    
    if (node.right) {
      const rightPath = basePath ? `${basePath}.right` : 'right';
      results.push(...this.extractSubtreeHashes(node.right, rightPath, depth - 1));
    }
    
    // If no children, return this node
    if (!node.left && !node.right) {
      results.push({
        path: basePath,
        hash: node.hash,
        uuids: node.uuids,
        hasChildren: false
      });
    }
    
    return results;
  }
}
