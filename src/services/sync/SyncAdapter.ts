import { SyncEnvelope } from './SyncEnvelope';

export interface BroadcastResult {
  success: boolean;
  packetId: string;
  error?: string;
}

export interface CatchUpResult {
  envelopes: SyncEnvelope[];
  cutoffTimestamp: number;
}

export interface SyncAdapter {
  readonly name: string;
  broadcast(envelope: SyncEnvelope): Promise<BroadcastResult>;
  onReceive(handler: (envelope: SyncEnvelope) => void): () => void;  // returns unsubscribe
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  requestCatchUp(sinceTimestamp: number): Promise<CatchUpResult>;
  drainOfflineQueue(): Promise<void>;
}
