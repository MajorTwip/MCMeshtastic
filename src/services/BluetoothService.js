'use strict';

/**
 * BluetoothService.js
 *
 * Manages BLE communication with a Meshtastic node using @abandonware/noble.
 *
 * Meshtastic BLE UUIDs:
 *   Service  : 6ba4b610-bbe7-4eda-8ba9-b73a0d3f5276
 *   toRadio  : f75c76d2-129e-4dad-a1dd-7866124401e7  (write)
 *   fromRadio: 2c55cbb9-c30f-4a23-a22f-fd4d5e065ec5  (read)
 *   fromNum  : ed9da18c-a800-4f66-a670-aa7547b3e1e9  (notify)
 *
 * Flow:
 *   1. scan() – find devices advertising the Meshtastic service UUID
 *   2. connect(deviceId) – connect, discover characteristics, subscribe to fromNum
 *   3. When fromNum notifies → read fromRadio → call onPacketReceived
 *   4. sendPacket(bytes) – write bytes to toRadio characteristic
 */

const noble = require('@abandonware/noble');

// ── Meshtastic UUIDs (lowercase, no dashes – noble's normalised form) ─────────

const MESHTASTIC_SERVICE_UUID = '6ba4b610-bbe7-4eda-8ba9-b73a0d3f5276';
const CHAR_TO_RADIO = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const CHAR_FROM_RADIO = '2c55cbb9-c30f-4a23-a22f-fd4d5e065ec5';
const CHAR_FROM_NUM = 'ed9da18c-a800-4f66-a670-aa7547b3e1e9';

// Noble uses lowercase UUIDs without dashes for internal matching
const NOBLE_SERVICE_UUID = MESHTASTIC_SERVICE_UUID.replace(/-/g, '').toLowerCase();
const NOBLE_TO_RADIO = CHAR_TO_RADIO.replace(/-/g, '').toLowerCase();
const NOBLE_FROM_RADIO = CHAR_FROM_RADIO.replace(/-/g, '').toLowerCase();
const NOBLE_FROM_NUM = CHAR_FROM_NUM.replace(/-/g, '').toLowerCase();

class BluetoothService {
  /**
   * @param {(msg: string, level?: 'info'|'warn'|'error') => void} [onLog]
   */
  constructor(onLog) {
    this._onLog = onLog || (() => {});
    this._peripheral = null;
    this._toRadioChar = null;
    this._fromRadioChar = null;
    this._fromNumChar = null;
    this._onPacketReceived = null;
    /** @type {Map<string, object>} */
    this._discoveredPeripherals = new Map();
  }

  // ── BLE state ─────────────────────────────────────────────────────────────

  /**
   * Resolves to true when the BLE adapter is powered on.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  waitForBleReady(timeoutMs = 10_000) {
    return new Promise((resolve) => {
      if (noble.state === 'poweredOn') {
        resolve(true);
        return;
      }

      const timeout = setTimeout(() => {
        noble.removeListener('stateChange', onStateChange);
        resolve(false);
      }, timeoutMs);

      const onStateChange = (state) => {
        if (state === 'poweredOn') {
          clearTimeout(timeout);
          noble.removeListener('stateChange', onStateChange);
          resolve(true);
        }
      };

      noble.on('stateChange', onStateChange);
    });
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  /**
   * Scan for Meshtastic devices.
   * @param {(device: {id: string, name: string|null, rssi: number|null}) => void} onDeviceFound
   * @param {number} [durationMs]
   */
  scan(onDeviceFound, durationMs = 10_000) {
    const seen = new Set();
    this._onLog('Starting BLE scan…');

    const onDiscover = (peripheral) => {
      if (seen.has(peripheral.id)) {
        return;
      }
      seen.add(peripheral.id);
      this._discoveredPeripherals.set(peripheral.id, peripheral);

      const name = peripheral.advertisement?.localName || null;
      const rssi = peripheral.rssi || null;
      this._onLog(`Found device: ${name || 'Unknown'} (${peripheral.id})`);
      onDeviceFound({ id: peripheral.id, name, rssi });
    };

    noble.on('discover', onDiscover);
    noble.startScanning([NOBLE_SERVICE_UUID], false);

    setTimeout(() => {
      noble.stopScanning();
      noble.removeListener('discover', onDiscover);
      this._onLog('BLE scan stopped.');
    }, durationMs);
  }

  /** Stop an in-progress scan. */
  stopScan() {
    noble.stopScanning();
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Connect to a device by ID and subscribe to fromNum notifications.
   * The device must have been discovered via scan() first.
   * @param {string} deviceId
   * @param {(bytes: Uint8Array) => void} onPacket
   * @returns {Promise<void>}
   */
  async connect(deviceId, onPacket) {
    this._onPacketReceived = onPacket;
    this._onLog(`Connecting to ${deviceId}…`);

    const peripheral = this._discoveredPeripherals.get(deviceId);
    if (!peripheral) {
      throw new Error(`Device ${deviceId} not found. Run scan() first.`);
    }

    await peripheral.connectAsync();
    this._peripheral = peripheral;
    this._onLog(`Connected to ${peripheral.advertisement?.localName || deviceId}`);

    const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
    this._onLog('Services discovered.');

    for (const char of characteristics) {
      const uuid = char.uuid.toLowerCase().replace(/-/g, '');
      if (uuid === NOBLE_TO_RADIO) {
        this._toRadioChar = char;
      } else if (uuid === NOBLE_FROM_RADIO) {
        this._fromRadioChar = char;
      } else if (uuid === NOBLE_FROM_NUM) {
        this._fromNumChar = char;
      }
    }

    if (!this._toRadioChar || !this._fromRadioChar || !this._fromNumChar) {
      throw new Error('Required Meshtastic BLE characteristics not found');
    }

    await this._subscribeFromNum();
  }

  /**
   * Disconnect and clean up subscriptions.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._fromNumChar) {
      try {
        await this._fromNumChar.unsubscribeAsync();
      } catch {
        // Best-effort
      }
      this._fromNumChar = null;
    }

    if (this._peripheral) {
      try {
        await this._peripheral.disconnectAsync();
      } catch {
        // Best-effort
      }
      this._onLog(
        `Disconnected from ${this._peripheral.advertisement?.localName || this._peripheral.id}`,
      );
      this._peripheral = null;
    }

    this._toRadioChar = null;
    this._fromRadioChar = null;
    this._onPacketReceived = null;
  }

  get isConnected() {
    return this._peripheral !== null;
  }

  get connectedDeviceInfo() {
    if (!this._peripheral) {
      return null;
    }
    return {
      id: this._peripheral.id,
      name: this._peripheral.advertisement?.localName || null,
    };
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  /**
   * Write bytes to the toRadio characteristic.
   * @param {Uint8Array} bytes
   * @returns {Promise<void>}
   */
  async sendPacket(bytes) {
    if (!this._toRadioChar) {
      throw new Error('Not connected to any BLE device');
    }
    const buf = Buffer.from(bytes);
    // withoutResponse = true matches Meshtastic firmware behaviour
    await this._toRadioChar.writeAsync(buf, true);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Subscribe to fromNum notifications; on change, read fromRadio. */
  async _subscribeFromNum() {
    this._onLog('Subscribing to fromNum notifications…');

    this._fromNumChar.on('data', () => {
      this._readFromRadio().catch((err) => {
        this._onLog(`Error reading fromRadio: ${err.message}`, 'error');
      });
    });

    await this._fromNumChar.subscribeAsync();
    this._onLog('Subscribed to fromNum.');
  }

  async _readFromRadio() {
    if (!this._fromRadioChar) {
      return;
    }
    const data = await this._fromRadioChar.readAsync();
    if (!data || data.length === 0) {
      return;
    }
    this._onPacketReceived?.(new Uint8Array(data));
  }

  /** Clean up (call on process exit). */
  destroy() {
    this._peripheral = null;
    this._toRadioChar = null;
    this._fromRadioChar = null;
    this._fromNumChar = null;
  }
}

module.exports = {
  BluetoothService,
  MESHTASTIC_SERVICE_UUID,
  CHAR_TO_RADIO,
  CHAR_FROM_RADIO,
  CHAR_FROM_NUM,
};
