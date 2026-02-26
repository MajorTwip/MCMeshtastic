/**
 * BluetoothService.ts
 *
 * Manages BLE communication with a Meshtastic node using react-native-ble-plx.
 *
 * Meshtastic BLE UUIDs:
 *   Service  : 6ba4b610-bbe7-4eda-8ba9-b73a0d3f5276
 *   toRadio  : f75c76d2-129e-4dad-a1dd-7866124401e7  (write)
 *   fromRadio: 2c55cbb9-c30f-4a23-a22f-fd4d5e065ec5  (read)
 *   fromNum  : ed9da18c-a800-4f66-a670-aa7547b3e1e9  (notify)
 *
 * Flow:
 *   1. scan() – find devices advertising the Meshtastic service UUID
 *   2. connect(deviceId) – connect, discover services, subscribe to fromNum
 *   3. When fromNum notifies → read fromRadio → call onPacketReceived
 *   4. sendPacket(bytes) – base64-encode and write to toRadio
 */

import {BleManager, Device, Characteristic, State} from 'react-native-ble-plx';
import {Buffer} from 'buffer';

// ── Meshtastic UUIDs ───────────────────────────────────────────────────────────

export const MESHTASTIC_SERVICE_UUID = '6ba4b610-bbe7-4eda-8ba9-b73a0d3f5276';
export const CHAR_TO_RADIO = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
export const CHAR_FROM_RADIO = '2c55cbb9-c30f-4a23-a22f-fd4d5e065ec5';
export const CHAR_FROM_NUM = 'ed9da18c-a800-4f66-a670-aa7547b3e1e9';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export type PacketCallback = (bytes: Uint8Array) => void;
export type LogCallback = (msg: string, level?: 'info' | 'warn' | 'error') => void;

// ── Service ────────────────────────────────────────────────────────────────────

export class BluetoothService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private fromNumSubscription: {remove: () => void} | null = null;
  private onPacketReceived: PacketCallback | null = null;
  private onLog: LogCallback;

  constructor(onLog: LogCallback = () => {}) {
    this.manager = new BleManager();
    this.onLog = onLog;
  }

  // ── BLE state ────────────────────────────────────────────────────────────────

  /** Resolves to true when BLE adapter is powered on. */
  async waitForBleReady(timeoutMs = 10_000): Promise<boolean> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        subscription.remove();
        resolve(false);
      }, timeoutMs);

      const subscription = this.manager.onStateChange(state => {
        if (state === State.PoweredOn) {
          clearTimeout(timeout);
          subscription.remove();
          resolve(true);
        }
      }, true);
    });
  }

  // ── Scanning ─────────────────────────────────────────────────────────────────

  /**
   * Scan for Meshtastic devices.
   * @param onDeviceFound  Called for each unique device found.
   * @param durationMs     How long to scan (default 10 s).
   */
  scan(
    onDeviceFound: (device: ScannedDevice) => void,
    durationMs = 10_000,
  ): void {
    const seen = new Set<string>();

    this.onLog('Starting BLE scan…');

    this.manager.startDeviceScan(
      [MESHTASTIC_SERVICE_UUID],
      {allowDuplicates: false},
      (error, device) => {
        if (error) {
          this.onLog(`Scan error: ${error.message}`, 'error');
          return;
        }
        if (!device) {return;}
        if (seen.has(device.id)) {return;}
        seen.add(device.id);

        this.onLog(`Found device: ${device.name ?? 'Unknown'} (${device.id})`);
        onDeviceFound({id: device.id, name: device.name, rssi: device.rssi});
      },
    );

    // Auto-stop after durationMs
    setTimeout(() => {
      this.manager.stopDeviceScan();
      this.onLog('BLE scan stopped.');
    }, durationMs);
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  // ── Connection ────────────────────────────────────────────────────────────────

  /**
   * Connect to a device by ID and subscribe to fromNum notifications.
   * @param deviceId        Device ID from scan.
   * @param onPacket        Called whenever a new fromRadio packet arrives.
   */
  async connect(deviceId: string, onPacket: PacketCallback): Promise<void> {
    this.onPacketReceived = onPacket;
    this.onLog(`Connecting to ${deviceId}…`);

    const device = await this.manager.connectToDevice(deviceId, {
      requestMTU: 512,
    });
    this.connectedDevice = device;
    this.onLog(`Connected to ${device.name ?? deviceId}`);

    await device.discoverAllServicesAndCharacteristics();
    this.onLog('Services discovered.');

    await this._subscribeFromNum(device);
  }

  /** Disconnect and clean up subscriptions. */
  async disconnect(): Promise<void> {
    this.fromNumSubscription?.remove();
    this.fromNumSubscription = null;

    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection();
      } catch {
        // Best-effort disconnect
      }
      this.onLog(`Disconnected from ${this.connectedDevice.name ?? this.connectedDevice.id}`);
      this.connectedDevice = null;
    }

    this.onPacketReceived = null;
  }

  get isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  get connectedDeviceInfo(): {id: string; name: string | null} | null {
    if (!this.connectedDevice) {return null;}
    return {id: this.connectedDevice.id, name: this.connectedDevice.name};
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  /**
   * Write bytes to the toRadio characteristic.
   */
  async sendPacket(bytes: Uint8Array): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('Not connected to any BLE device');
    }

    const b64 = Buffer.from(bytes).toString('base64');

    await this.connectedDevice.writeCharacteristicWithoutResponseForService(
      MESHTASTIC_SERVICE_UUID,
      CHAR_TO_RADIO,
      b64,
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Subscribe to fromNum notifications. When the value changes, read fromRadio.
   */
  private async _subscribeFromNum(device: Device): Promise<void> {
    this.onLog('Subscribing to fromNum notifications…');

    this.fromNumSubscription = device.monitorCharacteristicForService(
      MESHTASTIC_SERVICE_UUID,
      CHAR_FROM_NUM,
      (_error: Error | null, _characteristic: Characteristic | null) => {
        // fromNum changed – read the actual packet from fromRadio
        this._readFromRadio(device).catch(err => {
          this.onLog(`Error reading fromRadio: ${err.message}`, 'error');
        });
      },
    );

    this.onLog('Subscribed to fromNum.');
  }

  private async _readFromRadio(device: Device): Promise<void> {
    const char = await device.readCharacteristicForService(
      MESHTASTIC_SERVICE_UUID,
      CHAR_FROM_RADIO,
    );

    if (!char.value) {return;}

    const bytes = Uint8Array.from(Buffer.from(char.value, 'base64'));

    if (bytes.length === 0) {return;}

    this.onPacketReceived?.(bytes);
  }

  /** Clean up the BleManager (call on app unmount). */
  destroy(): void {
    this.fromNumSubscription?.remove();
    this.manager.destroy();
  }
}
