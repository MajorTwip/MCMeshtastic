'use strict';

/**
 * BridgeService.js
 *
 * Orchestrates BluetoothService and MulticastService, routing data between them:
 *
 *   UDP multicast → encode as MeshPacket → write to BLE toRadio
 *   BLE fromRadio → decode MeshPacket payload → send to UDP multicast
 */

const { MulticastService } = require('./MulticastService');
const { encodeMeshPacket, decodeMeshPacket, PORTNUM_DATA_APP } = require('./MeshtasticProtocol');

class BridgeService {
  /**
   * @param {import('./BluetoothService').BluetoothService} bleService
   * @param {(msg: string, level?: 'info'|'warn'|'error') => void} [onLog]
   * @param {(direction: 'ble'|'udp') => void} [onPacketCount]
   */
  constructor(bleService, onLog, onPacketCount) {
    this._bleService = bleService;
    this._onLog = onLog || (() => {});
    this._onPacketCount = onPacketCount || (() => {});
    this._multicastService = null;
    this._running = false;
  }

  get isRunning() {
    return this._running;
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  /**
   * Connect to the BLE device and start the multicast listener.
   * Both must succeed for the bridge to become active.
   * @param {{ multicastGroup: string, multicastPort: number, deviceId: string }} config
   * @returns {Promise<void>}
   */
  async start(config) {
    if (this._running) {
      this._onLog('Bridge already running.', 'warn');
      return;
    }

    this._onLog(
      `Starting bridge: BLE device=${config.deviceId}, multicast=${config.multicastGroup}:${config.multicastPort}`,
    );

    // 1. Set up multicast
    this._multicastService = new MulticastService(
      config.multicastGroup,
      config.multicastPort,
      this._handleUdpMessage.bind(this),
      this._onLog,
    );

    try {
      await this._multicastService.start();
    } catch (e) {
      this._onLog(`Failed to start multicast: ${e.message}`, 'error');
      throw e;
    }

    // 2. Connect BLE and subscribe
    try {
      await this._bleService.connect(config.deviceId, this._handleBlePacket.bind(this));
    } catch (e) {
      this._onLog(`Failed to connect BLE: ${e.message}`, 'error');
      this._multicastService.stop();
      throw e;
    }

    this._running = true;
    this._onLog('Bridge started successfully.');
  }

  // ── Stop ──────────────────────────────────────────────────────────────────

  /**
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this._running) {
      return;
    }

    this._onLog('Stopping bridge…');

    try {
      await this._bleService.disconnect();
    } catch (e) {
      this._onLog(`BLE disconnect error: ${e.message}`, 'warn');
    }

    this._multicastService?.stop();
    this._multicastService = null;

    this._running = false;
    this._onLog('Bridge stopped.');
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Received a UDP multicast datagram → wrap in MeshPacket → send over BLE.
   * @param {Uint8Array} data
   * @param {{ address: string, port: number }} rinfo
   */
  _handleUdpMessage(data, rinfo) {
    this._onLog(`UDP → BLE: ${data.length} bytes from ${rinfo.address}:${rinfo.port}`);

    let encoded;
    try {
      encoded = encodeMeshPacket(data);
    } catch (e) {
      this._onLog(`Failed to encode MeshPacket: ${e.message}`, 'error');
      return;
    }

    this._bleService.sendPacket(encoded).catch((err) => {
      this._onLog(`BLE send error: ${err.message}`, 'error');
    });

    this._onPacketCount('udp');
  }

  /**
   * Received a BLE fromRadio packet → decode MeshPacket → send to multicast.
   * @param {Uint8Array} bytes
   */
  _handleBlePacket(bytes) {
    this._onLog(`BLE → UDP: ${bytes.length} bytes`);

    let decoded;
    try {
      decoded = decodeMeshPacket(bytes);
    } catch (e) {
      this._onLog(`Failed to decode MeshPacket: ${e.message}`, 'error');
      return;
    }

    if (!decoded) {
      this._onLog('Received BLE packet with no decoded payload, skipping.', 'warn');
      return;
    }

    if (decoded.portnum !== PORTNUM_DATA_APP) {
      // Silently ignore non-data packets (admin, telemetry, etc.)
      return;
    }

    if (!this._multicastService) {
      return;
    }

    this._multicastService.send(decoded.payload).catch((err) => {
      this._onLog(`UDP send error: ${err.message}`, 'error');
    });

    this._onPacketCount('ble');
  }
}

module.exports = { BridgeService };
