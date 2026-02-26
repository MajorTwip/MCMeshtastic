/**
 * BridgeService.ts
 *
 * Orchestrates BluetoothService and MulticastService, routing data between them:
 *
 *   UDP multicast → encode as MeshPacket → write to BLE toRadio
 *   BLE fromRadio → decode MeshPacket payload → send to UDP multicast
 */

import {BluetoothService} from './BluetoothService';
import {MulticastService} from './MulticastService';
import {encodeMeshPacket, decodeMeshPacket, PORTNUM_DATA_APP} from './MeshtasticProtocol';

export type BridgeLogCallback = (
  msg: string,
  level?: 'info' | 'warn' | 'error',
) => void;

export type PacketCountCallback = (direction: 'ble' | 'udp') => void;

export interface BridgeConfig {
  multicastGroup: string;
  multicastPort: number;
  deviceId: string;
}

export class BridgeService {
  private bleService: BluetoothService;
  private multicastService: MulticastService | null = null;
  private onLog: BridgeLogCallback;
  private onPacketCount: PacketCountCallback;
  private running = false;

  constructor(
    bleService: BluetoothService,
    onLog: BridgeLogCallback = () => {},
    onPacketCount: PacketCountCallback = () => {},
  ) {
    this.bleService = bleService;
    this.onLog = onLog;
    this.onPacketCount = onPacketCount;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Start ─────────────────────────────────────────────────────────────────────

  /**
   * Connect to BLE device and start multicast listener.
   * Both must succeed for the bridge to become active.
   */
  async start(config: BridgeConfig): Promise<void> {
    if (this.running) {
      this.onLog('Bridge already running.', 'warn');
      return;
    }

    this.onLog(`Starting bridge: BLE device=${config.deviceId}, multicast=${config.multicastGroup}:${config.multicastPort}`);

    // 1. Set up multicast
    this.multicastService = new MulticastService(
      config.multicastGroup,
      config.multicastPort,
      this._handleUdpMessage.bind(this),
      this.onLog,
    );

    try {
      await this.multicastService.start();
    } catch (e) {
      const err = e as Error;
      this.onLog(`Failed to start multicast: ${err.message}`, 'error');
      throw err;
    }

    // 2. Connect BLE and subscribe
    try {
      await this.bleService.connect(
        config.deviceId,
        this._handleBlePacket.bind(this),
      );
    } catch (e) {
      const err = e as Error;
      this.onLog(`Failed to connect BLE: ${err.message}`, 'error');
      this.multicastService.stop();
      throw err;
    }

    this.running = true;
    this.onLog('Bridge started successfully.');
  }

  // ── Stop ──────────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.onLog('Stopping bridge…');

    try {
      await this.bleService.disconnect();
    } catch (e) {
      const err = e as Error;
      this.onLog(`BLE disconnect error: ${err.message}`, 'warn');
    }

    this.multicastService?.stop();
    this.multicastService = null;

    this.running = false;
    this.onLog('Bridge stopped.');
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────

  /**
   * Received a UDP multicast datagram → wrap in MeshPacket → send over BLE.
   */
  private _handleUdpMessage(
    data: Uint8Array,
    rinfo: {address: string; port: number},
  ): void {
    this.onLog(`UDP → BLE: ${data.length} bytes from ${rinfo.address}:${rinfo.port}`);

    let encoded: Uint8Array;
    try {
      encoded = encodeMeshPacket(data);
    } catch (e) {
      const err = e as Error;
      this.onLog(`Failed to encode MeshPacket: ${err.message}`, 'error');
      return;
    }

    this.bleService.sendPacket(encoded).catch(err => {
      this.onLog(`BLE send error: ${(err as Error).message}`, 'error');
    });

    this.onPacketCount('udp');
  }

  /**
   * Received a BLE fromRadio packet → decode MeshPacket → send to multicast.
   */
  private _handleBlePacket(bytes: Uint8Array): void {
    this.onLog(`BLE → UDP: ${bytes.length} bytes`);

    let decoded;
    try {
      decoded = decodeMeshPacket(bytes);
    } catch (e) {
      const err = e as Error;
      this.onLog(`Failed to decode MeshPacket: ${err.message}`, 'error');
      return;
    }

    if (!decoded) {
      this.onLog('Received BLE packet with no decoded payload, skipping.', 'warn');
      return;
    }

    if (decoded.portnum !== PORTNUM_DATA_APP) {
      // Silently ignore non-data packets (admin, telemetry, etc.)
      return;
    }

    if (!this.multicastService) {
      return;
    }

    this.multicastService.send(decoded.payload).catch(err => {
      this.onLog(`UDP send error: ${(err as Error).message}`, 'error');
    });

    this.onPacketCount('ble');
  }
}
