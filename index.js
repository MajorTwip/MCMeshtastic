#!/usr/bin/env node
'use strict';

/**
 * index.js – MCMeshtastic entry point
 *
 * Starts a Meshtastic <-> UDP Multicast bridge:
 *   1. Wait for BLE adapter to power on
 *   2. Scan for Meshtastic devices (or use --device <id>)
 *   3. Connect to the first discovered device
 *   4. Start UDP multicast listener
 *   5. Bridge packets in both directions until SIGINT/SIGTERM
 */

const { BluetoothService } = require('./src/services/BluetoothService');
const { BridgeService } = require('./src/services/BridgeService');
const { parseConfig } = require('./src/config');

// ── Logger ────────────────────────────────────────────────────────────────────

/**
 * @param {string} msg
 * @param {'info'|'warn'|'error'} [level]
 */
function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? ' [WARN]' : ' [INFO]';
  console.log(`${ts} ${prefix} ${msg}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseConfig();

  log(`MCMeshtastic starting…`);
  log(`Multicast target: ${config.multicastGroup}:${config.multicastPort}`);

  const bleService = new BluetoothService(log);
  const bridge = new BridgeService(
    bleService,
    log,
    (direction) =>
      log(`Packet forwarded: ${direction === 'ble' ? 'BLE -> UDP' : 'UDP -> BLE'}`),
  );

  // ── 1. Wait for BLE adapter ───────────────────────────────────────────────
  log('Waiting for BLE adapter...');
  const bleReady = await bleService.waitForBleReady(15_000);
  if (!bleReady) {
    log('BLE adapter did not become ready within 15 s. Exiting.', 'error');
    process.exit(1);
  }
  log('BLE adapter ready.');

  // ── 2. Resolve device ID (scan if not specified) ──────────────────────────
  let deviceId = config.deviceId;

  if (!deviceId) {
    log(`Scanning for Meshtastic devices (${config.scanDuration} ms)...`);

    deviceId = await new Promise((resolve) => {
      let resolved = false;

      bleService.scan(
        (device) => {
          log(`  Found: ${device.name || 'Unknown'} [${device.id}] RSSI=${device.rssi}`);
          if (!resolved) {
            resolved = true;
            resolve(device.id);
          }
        },
        config.scanDuration,
      );

      // Resolve with null after scan timeout if nothing was found
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, config.scanDuration + 500);
    });

    if (!deviceId) {
      log('No Meshtastic devices found. Exiting.', 'error');
      process.exit(1);
    }

    log(`Auto-selected device: ${deviceId}`);
  }

  // ── 3 & 4. Start bridge ───────────────────────────────────────────────────
  await bridge.start({
    deviceId,
    multicastGroup: config.multicastGroup,
    multicastPort: config.multicastPort,
  });

  log('Bridge is running. Press Ctrl+C to stop.');

  // ── 5. Graceful shutdown ──────────────────────────────────────────────────
  async function shutdown(signal) {
    log(`Received ${signal}. Shutting down...`);
    await bridge.stop();
    bleService.destroy();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
